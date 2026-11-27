// SPDX-License-Identifier: GPL-3.0-or-later
// One headless agent call (docs/spec/agent-permissions.md#the-headless-call): `claude -p` with the
// settings the harness writes for it, the call-time cap (docs/spec/loop-and-caps.md#caps), the
// transcript, cost and tokens from Claude Code's output, and the snapshots around the call (PERM-002).
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonSchema, SelfChecks } from "../adapter.js";
import type { EffortLevel, ModelPrice } from "../config/types.js";
import { StreamJsonReader, tokenCost, type InitEvent, type TokenCounts } from "./output.js";
import {
  agentSettings,
  agentTools,
  deniedTools,
  findSecretFiles,
  findWriteDenied,
  readOnlyTools,
  writableDirectories,
  type AgentAccess,
} from "./settings.js";
import { changedFiles, takeSnapshot, violations, type AgentScope, type Snapshot } from "./snapshot.js";
import { claudeCodeJsonSchema } from "./json-schema.js";
import { claudeCodeCommand } from "./version.js";

/** How an agent call ended, as the run record's `call.end` stores it. */
export type AgentCallEnd = "completed" | "call-time" | "budget" | "error";

/** One agent call, as the run record's `$defs.call` stores it (docs/spec/schemas/run-record.schema.json). */
export interface AgentCall {
  /** The model Claude Code reported, or the one asked for when it reported none. */
  readonly model: string;
  readonly effort?: EffortLevel;
  /** UTC, ISO 8601. */
  readonly started: string;
  /** Wall-clock time, as the call-time cap measures it. */
  readonly durationSeconds: number;
  readonly end: AgentCallEnd;
  readonly tokens: TokenCounts;
  readonly costUsd: number;
  /** True when the cost is Claude Code's estimate under a subscription login, or the harness's own estimate. */
  readonly costEstimated?: boolean;
  /** The transcript, relative to the run's directory: `calls/<n>.jsonl`. */
  readonly transcript: string;
  /** Every file that changed during the call, relative to the repository root, sorted; violations included. */
  readonly filesChanged: readonly string[];
}

/** What one agent call did: its record, and what the loop needs besides it. */
export interface AgentCallResult {
  /** The iteration's `call`. */
  readonly call: AgentCall;
  /** The iteration's `violations`: files outside the allowed paths that changed during the call (PERM-002, PERM-003). Not reverted. */
  readonly violations: readonly string[];
  /** The snapshot after the call: compare it with the one before the next call for hand edits (`handEdits`). */
  readonly after: Snapshot;
  /** Claude Code's version, from its output: the run record's `versions.claudeCode`. */
  readonly claudeCodeVersion?: string;
  readonly sessionId?: string;
  /** False when Claude Code reported no cost and no price was given to estimate one: `costUsd` is then 0. */
  readonly costKnown: boolean;
  /** The call was stopped through `signal`, as when the developer interrupts the run. */
  readonly interrupted: boolean;
  /** Why the call ended in `error`, for the report. */
  readonly error?: string;
  /** Claude Code's exit code; `null` when it was killed. */
  readonly exitCode: number | null;
  /** The agent's final message, when the call reported a successful result. */
  readonly finalText?: string;
  /** The call's structured output, when it was given `jsonSchema` and Claude Code reported one. */
  readonly structuredOutput?: unknown;
}

export interface AgentCallOptions {
  /** The repository root, absolute: the call's working directory. */
  readonly repo: string;
  /** The prompt, written to Claude Code's standard input, which is then closed. */
  readonly prompt: string;
  /** The component's directory and the adapter's file patterns. */
  readonly scope: AgentScope;
  /** The adapter's self-check commands for the component. */
  readonly selfChecks: SelfChecks;
  /** `read` for a call that may change no file and run no command, as a propose call; `edit` by default. */
  readonly access?: AgentAccess;
  /** A JSON Schema the final answer must match (`--json-schema`): Claude Code returns it as structured output. */
  readonly jsonSchema?: JsonSchema;
  readonly model: string;
  /** Left out: the model's default effort. */
  readonly effort?: EffortLevel;
  /** What remains of the run's budget, given to Claude Code as the call's own limit (`--max-budget-usd`). */
  readonly maxBudgetUsd?: number;
  /** The call-time cap, in milliseconds. */
  readonly timeoutMs: number;
  /** The run's directory, absolute: the settings and transcript go into its `calls/`. */
  readonly runDirectory: string;
  /** The iteration's number, which names `calls/<n>.jsonl` and `calls/<n>.settings.json`. */
  readonly iteration: number;
  /** The snapshot before the call, when the loop already took it for hand edits; taken here otherwise. */
  readonly before?: Snapshot;
  /** The Claude Code executable; `claude` on the PATH by default. */
  readonly command?: string;
  /** Claude Code's environment; the harness's own by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Stops the call, as when the developer interrupts the run. */
  readonly signal?: AbortSignal;
  /** The model's price, to estimate the cost of a call that ended without Claude Code reporting one. */
  readonly price?: ModelPrice;
  /** How long a stopped call gets to exit after SIGTERM before SIGKILL; 5 seconds by default. */
  readonly killGraceMs?: number;
}

/** The call's files in the run's directory. */
export function callFiles(iteration: number): { readonly transcript: string; readonly settings: string } {
  return { transcript: `calls/${String(iteration)}.jsonl`, settings: `calls/${String(iteration)}.settings.json` };
}

/** An empty MCP configuration: with `--strict-mcp-config`, the call has no MCP servers. */
const noMcpServers = JSON.stringify({ mcpServers: {} });

/**
 * The arguments of the `claude` call (flags confirmed against Claude Code 2.1.332). The prompt
 * isn't among them: it goes to standard input.
 */
export function claudeArguments(options: {
  readonly settingsFile: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly maxBudgetUsd?: number;
  /** `read`: only the reading tools; `edit` by default. */
  readonly access?: AgentAccess;
  readonly jsonSchema?: JsonSchema;
}): string[] {
  const tools: readonly string[] = options.access === "read" ? readOnlyTools : agentTools;
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--settings",
    options.settingsFile,
    // Only managed settings and --settings apply; the built-in tools that run code stay off unless --tools names them.
    "--restricted",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--tools",
    tools.join(","),
    "--disallowed-tools",
    deniedTools.join(","),
    "--strict-mcp-config",
    "--mcp-config",
    noMcpServers,
    "--no-session-persistence",
    "--model",
    options.model,
    ...(options.effort === undefined ? [] : ["--effort", options.effort]),
    ...(options.maxBudgetUsd === undefined ? [] : ["--max-budget-usd", budgetArgument(options.maxBudgetUsd)]),
    ...(options.jsonSchema === undefined
      ? []
      : ["--json-schema", JSON.stringify(claudeCodeJsonSchema(options.jsonSchema))]),
  ];
}

/** A budget in USD, rounded down to a hundredth of a cent so the call's limit never exceeds what remains. */
function budgetArgument(usd: number): string {
  return String(Math.max(0, Math.floor(usd * 10_000) / 10_000));
}

/** What in the `init` event shows the call didn't start with its permissions (PERM-001). */
export function initProblems(init: InitEvent): string[] {
  const problems: string[] = [];
  const denied = init.tools.filter(
    (tool) => tool.startsWith("mcp__") || (deniedTools as readonly string[]).includes(tool),
  );
  if (denied.length > 0) problems.push(`it has tools it must not have: ${denied.join(", ")}`);
  if (init.mcpServers.length > 0) problems.push(`it has MCP servers: ${init.mcpServers.join(", ")}`);
  if (init.permissionMode !== undefined && init.permissionMode !== "dontAsk") {
    problems.push(`its permission mode is ${init.permissionMode}, not dontAsk`);
  }
  return problems;
}

/** How much of Claude Code's standard error is kept for the error message. */
const stderrTail = 4000;

/**
 * Runs one agent call: writes its settings, starts `claude -p` in the repository with the prompt on
 * standard input, stops it at the call-time cap or on `signal`, writes the transcript, and compares
 * snapshots before and after it. Never throws for how the call went; only for the harness's own
 * failures (writing the run's files, listing the repository's files).
 */
export async function runAgentCall(options: AgentCallOptions): Promise<AgentCallResult> {
  const files = callFiles(options.iteration);
  const settingsFile = path.join(options.runDirectory, files.settings);
  const transcriptFile = path.join(options.runDirectory, files.transcript);
  await mkdir(path.dirname(settingsFile), { recursive: true });
  const settings = agentSettings({
    repo: options.repo,
    scope: options.scope,
    selfChecks: options.selfChecks,
    secretFiles: await findSecretFiles(options.repo),
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(options.access === "read"
      ? {}
      : { writeDenied: await findWriteDenied(options.repo, writableDirectories(options.scope, options.selfChecks)) }),
  });
  await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const before = options.before ?? (await takeSnapshot(options.repo));

  const started = new Date();
  const claude = await runClaude({
    command: options.command ?? claudeCodeCommand,
    args: claudeArguments({
      settingsFile,
      model: options.model,
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: options.maxBudgetUsd }),
      ...(options.access === undefined ? {} : { access: options.access }),
      ...(options.jsonSchema === undefined ? {} : { jsonSchema: options.jsonSchema }),
    }),
    cwd: options.repo,
    env: options.env,
    prompt: options.prompt,
    transcriptFile,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs ?? 5000,
    signal: options.signal,
  });
  const durationSeconds = (Date.now() - started.getTime()) / 1000;

  const after = await takeSnapshot(options.repo);
  const changed = changedFiles(before, after);
  const { reader } = claude;
  const { init, result } = reader;
  const outcome = callOutcome(claude);

  const tokens = result?.tokens ?? reader.messageTokens;
  const model = init?.model ?? result?.models[0] ?? options.model;
  let costUsd = result?.costUsd;
  let costEstimated =
    init?.apiKeySource === undefined || init.apiKeySource === "none" || result?.unknownCostBasis === true;
  if (costUsd === undefined && options.price !== undefined) {
    costUsd = tokenCost(tokens, options.price);
    costEstimated = true;
  }
  const sessionId = result?.sessionId ?? init?.sessionId;

  return {
    call: {
      model,
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      started: started.toISOString(),
      durationSeconds,
      end: outcome.end,
      tokens,
      costUsd: costUsd ?? 0,
      ...(costEstimated || costUsd === undefined ? { costEstimated: true } : {}),
      transcript: files.transcript,
      filesChanged: changed,
    },
    violations: violations(changed, options.scope),
    after,
    ...(init?.claudeCodeVersion === undefined ? {} : { claudeCodeVersion: init.claudeCodeVersion }),
    ...(sessionId === undefined ? {} : { sessionId }),
    costKnown: costUsd !== undefined,
    interrupted: claude.stopped === "signal",
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    exitCode: claude.exitCode,
    ...(outcome.end === "completed" && result?.text !== undefined ? { finalText: result.text } : {}),
    ...(outcome.end === "completed" && result?.structuredOutput !== undefined
      ? { structuredOutput: result.structuredOutput }
      : {}),
  };
}

/** Why the harness stopped the process, if it did. */
type Stopped = "call-time" | "signal" | "permissions";

interface ClaudeProcess {
  readonly reader: StreamJsonReader;
  readonly exitCode: number | null;
  readonly stopped: Stopped | undefined;
  /** Why the harness couldn't start it, or the problems that made it stop it (PERM-001). */
  readonly failure: string | undefined;
  readonly stderr: string;
}

function callOutcome(claude: ClaudeProcess): { end: AgentCallEnd; error?: string } {
  const { reader, stopped, exitCode, failure, stderr } = claude;
  const { result } = reader;
  if (stopped === "call-time") return { end: "call-time" };
  if (stopped === "signal") return { end: "error", error: "The call was stopped." };
  if (failure !== undefined) return { end: "error", error: failure };
  if (result === undefined) {
    const { lines, first } = reader.malformed;
    const detail =
      lines > 0
        ? `; ${String(lines)} ${lines === 1 ? "line wasn't" : "lines weren't"} JSON, the first: ${first ?? ""}`
        : "";
    return {
      end: "error",
      error: `Claude Code exited with code ${String(exitCode)} without reporting a result${detail}${stderrMessage(stderr)}`,
    };
  }
  if (result.subtype === "error_max_budget_usd") return { end: "budget" };
  if (result.isError || result.subtype !== "success" || exitCode !== 0) {
    const errors = result.errors.length > 0 ? `: ${result.errors.join("; ")}` : "";
    return {
      end: "error",
      error: `Claude Code ended the call with ${result.subtype} (exit code ${String(exitCode)})${errors}${stderrMessage(stderr)}`,
    };
  }
  return { end: "completed" };
}

function stderrMessage(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed === "" ? "" : `. Its standard error: ${trimmed}`;
}

interface RunClaudeOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
  readonly prompt: string;
  readonly transcriptFile: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * Runs Claude Code as the leader of its own process group, so stopping it stops the commands it
 * started too: SIGTERM to the group, then SIGKILL after the grace period.
 */
function runClaude(options: RunClaudeOptions): Promise<ClaudeProcess> {
  let failure: string | undefined;
  let stopped: Stopped | undefined;
  let stderr = "";
  let exitCode: number | null = null;
  let graceTimer: NodeJS.Timeout | undefined;
  const reader = new StreamJsonReader((init) => {
    const problems = initProblems(init);
    if (problems.length > 0) {
      failure = `The call didn't start with its permissions (PERM-001): ${problems.join("; ")}.`;
      stop("permissions");
    }
  });
  const transcript = createWriteStream(options.transcriptFile);
  transcript.on("error", (error) => {
    failure ??= `The transcript couldn't be written: ${error.message}`;
  });

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...(options.env ?? process.env) },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  function signalGroup(signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      // already gone
    }
  }
  function stop(reason: Stopped): void {
    if (stopped !== undefined) return;
    stopped = reason;
    signalGroup("SIGTERM");
    graceTimer = setTimeout(() => {
      signalGroup("SIGKILL");
    }, options.killGraceMs);
  }

  const timer = setTimeout(() => {
    stop("call-time");
  }, options.timeoutMs);
  const onAbort = () => {
    stop("signal");
  };
  if (options.signal?.aborted === true) stop("signal");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    transcript.write(chunk);
    reader.push(chunk);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-stderrTail);
  });
  // The process may exit before it reads its input; that's reported by its exit, not here.
  child.stdin.on("error", () => undefined);
  child.stdin.end(options.prompt);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      reader.end();
      transcript.end(() => {
        resolve({ reader, exitCode, stopped, failure, stderr });
      });
    };
    child.on("exit", (code) => {
      exitCode = code;
      // Anything left in its group once it exits is stopped, so its output closes.
      signalGroup("SIGKILL");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      failure =
        error.code === "ENOENT"
          ? `Claude Code isn't installed, or '${options.command}' isn't on the PATH.`
          : `Claude Code couldn't be started: ${error.message}`;
      if (child.pid === undefined) finish();
    });
    child.on("close", finish);
  });
}
