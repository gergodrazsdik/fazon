// SPDX-License-Identifier: GPL-3.0-or-later
// Reads Claude Code's `--output-format stream-json` output (one JSON event per line): the
// `system`/`init` event (version, model, session, how it's authenticated, tools and MCP servers),
// each assistant message's token usage, and the final `result` event (cost, tokens, how it ended).
import type { ModelPrice } from "../config/types.js";

/** Token counts, as the run record's `$defs.tokens` stores them. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** What the `system`/`init` event says. */
export interface InitEvent {
  readonly claudeCodeVersion?: string;
  readonly model?: string;
  readonly sessionId?: string;
  /** How Claude Code is authenticated: `ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, or `none` for a claude.ai (subscription) login. */
  readonly apiKeySource?: string;
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
  readonly permissionMode?: string;
}

/** What the `result` event says. */
export interface ResultEvent {
  /** `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, … */
  readonly subtype: string;
  readonly isError: boolean;
  readonly sessionId?: string;
  readonly costUsd?: number;
  readonly tokens?: TokenCounts;
  /** The models used, from `modelUsage`. */
  readonly models: readonly string[];
  /** Whether any model's cost came from an unknown price table (`costBasis: "unknown"`). */
  readonly unknownCostBasis: boolean;
  /** The errors an error result lists. */
  readonly errors: readonly string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

function tokensFromUsage(usage: Json): TokenCounts {
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
  };
}

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: (a.cacheRead ?? 0) + (b.cacheRead ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
  };
}

const noTokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function parseInit(event: Json): InitEvent {
  const tools = Array.isArray(event.tools)
    ? event.tools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const servers = Array.isArray(event.mcp_servers)
    ? event.mcp_servers.map((server) => (isObject(server) ? (text(server.name) ?? "?") : String(server)))
    : [];
  return {
    ...optional("claudeCodeVersion", text(event.claude_code_version)),
    ...optional("model", text(event.model)),
    ...optional("sessionId", text(event.session_id)),
    ...optional("apiKeySource", text(event.apiKeySource)),
    tools,
    mcpServers: servers,
    ...optional("permissionMode", text(event.permissionMode)),
  };
}

function parseResult(event: Json): ResultEvent {
  // `modelUsage` covers every model, subagents included; `usage` is the fallback.
  const modelUsage = isObject(event.modelUsage) ? event.modelUsage : {};
  const models = Object.keys(modelUsage);
  let tokens: TokenCounts | undefined;
  let unknownCostBasis = false;
  for (const model of models) {
    const usage = modelUsage[model];
    if (!isObject(usage)) continue;
    tokens = addTokens(tokens ?? noTokens, {
      input: count(usage.inputTokens),
      output: count(usage.outputTokens),
      cacheRead: count(usage.cacheReadInputTokens),
      cacheWrite: count(usage.cacheCreationInputTokens),
    });
    if (usage.costBasis === "unknown") unknownCostBasis = true;
  }
  if (tokens === undefined && isObject(event.usage)) tokens = tokensFromUsage(event.usage);
  const cost = event.total_cost_usd;
  return {
    subtype: text(event.subtype) ?? "unknown",
    isError: event.is_error === true,
    ...optional("sessionId", text(event.session_id)),
    ...optional("costUsd", typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined),
    ...optional("tokens", tokens),
    models,
    unknownCostBasis,
    errors: Array.isArray(event.errors) ? event.errors.map(String) : [],
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
}

/** Reads the stream line by line as it arrives, keeping only what the call's record needs. */
export class StreamJsonReader {
  #buffer = "";
  #init: InitEvent | undefined;
  #result: ResultEvent | undefined;
  /** The last usage of each assistant message, by message ID: a message comes once per content block. */
  readonly #usage = new Map<string, TokenCounts>();
  #malformed = 0;
  #firstMalformed: string | undefined;
  readonly #onInit: ((init: InitEvent) => void) | undefined;

  constructor(onInit?: (init: InitEvent) => void) {
    this.#onInit = onInit;
  }

  /** Feeds a chunk of standard output. */
  push(chunk: string): void {
    const lines = (this.#buffer + chunk).split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#line(line);
  }

  /** Reads the last line, when the output doesn't end with a newline. */
  end(): void {
    if (this.#buffer !== "") this.#line(this.#buffer);
    this.#buffer = "";
  }

  #line(raw: string): void {
    const line = raw.trim();
    if (line === "") return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      event = undefined;
    }
    if (!isObject(event)) {
      this.#malformed++;
      this.#firstMalformed ??= line.slice(0, 200);
      return;
    }
    if (event.type === "system" && event.subtype === "init") {
      this.#init = parseInit(event);
      this.#onInit?.(this.#init);
    } else if (event.type === "assistant" && isObject(event.message)) {
      const { message } = event;
      if (isObject(message.usage)) {
        this.#usage.set(text(message.id) ?? `#${String(this.#usage.size)}`, tokensFromUsage(message.usage));
      }
    } else if (event.type === "result") {
      this.#result = parseResult(event);
    }
  }

  get init(): InitEvent | undefined {
    return this.#init;
  }

  get result(): ResultEvent | undefined {
    return this.#result;
  }

  /** The tokens of the assistant messages seen so far: what a call that ended without a result used, at least. */
  get messageTokens(): TokenCounts {
    let total = noTokens;
    for (const tokens of this.#usage.values()) total = addTokens(total, tokens);
    return total;
  }

  /** Lines that weren't a JSON object, and the first of them (cut to 200 characters). */
  get malformed(): { readonly lines: number; readonly first?: string } {
    return { lines: this.#malformed, ...optional("first", this.#firstMalformed) };
  }
}

/** The cost of `tokens` at `price` (USD per million tokens); cache reads and writes at the input price when the price leaves them out. */
export function tokenCost(tokens: TokenCounts, price: ModelPrice): number {
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  return (
    tokens.input * perToken(price.input) +
    tokens.output * perToken(price.output) +
    (tokens.cacheRead ?? 0) * perToken(price.cacheRead ?? price.input) +
    (tokens.cacheWrite ?? 0) * perToken(price.cacheWrite ?? price.input)
  );
}
