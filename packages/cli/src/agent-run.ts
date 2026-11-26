// SPDX-License-Identifier: GPL-3.0-or-later
// What `fazon propose`, `fazon generate` and `fazon feedback` share (docs/spec/cli.md#the-loop): the
// component and its spec, the Claude Code version (T-0094), the run lock, the run itself through
// the loop with the agent call connected, and the outcome a run ends the command with.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  acquireRunLock,
  agentLoopCall,
  checkSpec,
  claudeCodeCommand,
  claudeCodeProblem,
  claudeCodeStatus,
  ClaudeCodeVersionError,
  generatedDirectory,
  hashApi,
  hashText,
  hashTokenSet,
  isKebabCase,
  kebabCase,
  loopSettings,
  newRunId,
  noSelfChecks,
  parseSpecFile,
  readSpecFiles,
  resolveTokenSet,
  runAgent,
  runDirectory,
  runsDirectory,
  type Adapter,
  type AgentAccess,
  type AgentCallResult,
  type AgentLoopCall,
  type AgentRunKind,
  type AgentRunOutcome,
  type Config,
  type FeedbackInput,
  type Finding,
  type JsonSchema,
  type LoopCallInput,
  type LoopDependencies,
  type RunInputs,
  type RunReason,
  type SpecFile,
  type ValidSpecFile,
} from "@fazon/core";
import { findAdapter } from "./adapters.js";
import { describeFinding, requireConfig, type Context, type Invocation } from "./commands/context.js";
import { refused, type Message, type Outcome, type Status } from "./outcome.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** The agent commands. */
export type AgentCommand = "propose" | "generate" | "feedback";

/** A component's config, adapter and spec, as a command that works on one component reads them. */
export interface ComponentSetup {
  /** The repository root, absolute. */
  readonly repo: string;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The component's kebab-case name, as on the command line. */
  readonly component: string;
  /** The component's spec, which passes SPEC-001. */
  readonly spec: ValidSpecFile;
  /** The spec's text, as read. */
  readonly specText: string;
  /** Every spec in the specs directory, for the rules that compare specs. */
  readonly specs: readonly SpecFile[];
  /** The spec's findings by every SPEC rule `spec check` checks. */
  readonly findings: readonly Finding[];
  /** The component's directory, from the repository root, with `/` separators: `<paths.components>/<component>`. */
  readonly directory: string;
}

/** Everything an agent command has read before its run starts. */
export interface AgentCommandSetup extends ComponentSetup {
  /** The Claude Code executable and its version, at least the minimum. */
  readonly claudeCode: { readonly command: string; readonly version: string };
}

/** An outcome that ends the command before its run: a refusal (2) or a missing tool (3). */
export interface Stop {
  readonly stop: Outcome;
}

/** Status `error` (exit 3): the environment or a tool failed (docs/spec/cli.md#exit-codes). */
function environmentError(text: string, hint?: string): Outcome {
  return { status: "error", messages: [{ level: "error", text, ...(hint === undefined ? {} : { hint }) }] };
}

/**
 * The installed Claude Code, at least the minimum this framework version declares (T-0094,
 * ADR 0021): `propose`, `generate` and `feedback` refuse to start (3) without it.
 */
export async function requireClaudeCodeVersion(context: Context): Promise<AgentCommandSetup["claudeCode"] | Stop> {
  const command = context.environment.claudeCode ?? claudeCodeCommand;
  const ran = await context.environment.exec(command, ["--version"]);
  const status = claudeCodeStatus(ran?.exitCode === 0 ? ran.stdout : undefined);
  if (status.state === "ok") return { command, version: status.version };
  const { hint } = new ClaudeCodeVersionError(status);
  return {
    stop: environmentError(`${claudeCodeProblem(status)}, so the agent can't run. ${hint}`, "fazon doctor"),
  };
}

/**
 * The steps every agent command takes before its run: the component (`readComponent`), then the
 * Claude Code version, refused (3) when it's older than the minimum.
 */
export async function prepareAgentCommand(
  command: AgentCommand,
  invocation: Invocation,
  context: Context,
): Promise<AgentCommandSetup | Stop> {
  const setup = await readComponent(command, invocation, context);
  if ("stop" in setup) return setup;
  const claudeCode = await requireClaudeCodeVersion(context);
  if ("stop" in claudeCode) return claudeCode;
  return { ...setup, claudeCode };
}

/**
 * What a command on one component reads first, in order: the component's name, the config, the
 * adapter and the spec, refused (2) when it's missing or breaks SPEC-001. The spec's other
 * findings are in the setup, for the command to decide on.
 */
export async function readComponent(
  command: string,
  invocation: Invocation,
  context: Context,
): Promise<ComponentSetup | Stop> {
  const [component] = invocation.positionals;
  if (component === undefined) {
    return { stop: refused(`fazon ${command} needs the component's name, in kebab-case.`, `fazon ${command} button`) };
  }
  if (!isKebabCase(component)) {
    const suggestion = kebabCase(component.replace(/[^A-Za-z0-9]+/g, "-")).replace(/-+/g, "-");
    return {
      stop: refused(
        `'${component}' isn't a component name. Name components in kebab-case, as their spec files are named: ${suggestion}.`,
        isKebabCase(suggestion) ? `fazon ${command} ${suggestion}` : undefined,
      ),
    };
  }

  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return { stop: loaded.refusal };
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) {
    return {
      stop: refused(`This version of fazon has no '${config.adapter}' adapter. Set adapter in fazon.yaml to vue.`),
    };
  }

  const repo = context.environment.cwd;
  const specsDirectory = toPosix(config.paths.specs);
  let specs: SpecFile[];
  try {
    specs = await readSpecFiles(repo, config.paths.specs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    specs = [];
  }
  const file = specs.find((spec) => spec.component === component);
  const specPath = path.posix.join(specsDirectory, `${component}.md`);
  if (file === undefined) {
    return {
      stop: refused(
        `There's no spec at ${specPath}. Write it first, or check the component name.`,
        `fazon spec new ${component}`,
      ),
    };
  }
  if (file.spec === undefined) {
    return { stop: specRefusal(component, file.findings, `${specPath} isn't a valid spec`) };
  }
  const spec: ValidSpecFile = { ...file, spec: file.spec };
  const specText = await readFile(path.join(repo, file.file), "utf8");
  return {
    repo,
    config,
    adapter,
    component,
    spec,
    specText,
    specs,
    findings: checkSpec(file, specs),
    directory: path.posix.join(toPosix(config.paths.components), component),
  };
}

/** A refusal (2) for a spec with findings: one message per finding, then how to see them all. */
export function specRefusal(component: string, findings: readonly Finding[], what: string): Outcome {
  const messages: Message[] = [
    {
      level: "error",
      text: `${what}: ${String(findings.length)} ${findings.length === 1 ? "finding" : "findings"}. Fix ${findings.length === 1 ? "it" : "them"} first.`,
      hint: `fazon spec check ${component}`,
    },
    ...findings.map((finding): Message => ({
      level: "error",
      text: `${describeFinding(finding, true)}.${finding.hint === undefined ? "" : ` ${finding.hint}`}`,
    })),
  ];
  return { status: "refused", messages };
}

function toPosix(directory: string): string {
  return directory.split(path.sep).join("/");
}

/**
 * The hashes of what a run starts from (docs/spec/records.md#hashes): the spec, its API when
 * `api` is set (the approved API, which `generate` checked), the token set, the conventions doc
 * and the config. Read again before a run passes (LOOP-004); a file that can't be read is left out.
 */
export async function readRunInputs(setup: ComponentSetup, options: { readonly api: boolean }): Promise<RunInputs> {
  const { repo, config } = setup;
  const inputs: Partial<Record<keyof RunInputs, string>> = {};
  const text = (file: string) => readFile(path.join(repo, file), "utf8").catch(() => undefined);
  const specText = await text(setup.spec.file);
  if (specText !== undefined) {
    inputs.spec = hashText(specText);
    const parsed = parseSpecFile(setup.spec.file, specText);
    if (options.api && parsed.spec !== undefined) inputs.api = hashApi(parsed.spec);
  }
  try {
    const { tokenSet } = await resolveTokenSet(path.join(repo, config.paths.tokens));
    if (tokenSet !== undefined) inputs.tokens = hashTokenSet(tokenSet);
  } catch {
    // A token set that can't be read has no hash.
  }
  const conventions = await text(config.paths.conventions);
  if (conventions !== undefined) inputs.conventions = hashText(conventions);
  const configText = await text("fazon.yaml");
  if (configText !== undefined) inputs.config = hashText(configText);
  return inputs;
}

/** What an agent command's run is made of, beyond its setup. */
export interface AgentRunRequest {
  readonly kind: AgentRunKind;
  /** Builds each call's prompt. */
  readonly prompt: (input: LoopCallInput) => string | Promise<string>;
  /** `read` for a propose run: the agent may change no file and run no command. `edit` by default. */
  readonly access?: AgentAccess;
  /** A JSON Schema for the final answer (`--json-schema`). */
  readonly jsonSchema?: JsonSchema;
  /** Reads a completed call's answer; a message ends the call in error (`agentLoopCall`). */
  readonly answer?: (result: AgentCallResult) => string | undefined | Promise<string | undefined>;
  /** The checks phase, the generated-files refresh and the judge of a generate or feedback run. */
  readonly dependencies?: Pick<LoopDependencies, "checks" | "refreshGenerated" | "judge">;
  /** Whether the run's inputs include the approved API's hash: true for generate and feedback. */
  readonly approvedApi?: boolean;
  /**
   * The files the harness writes between calls, which aren't hand edits (F-0021); by default the
   * component's `generated/` directory and the package entry file, as the refresh writes them.
   */
  readonly harnessFile?: (file: string) => boolean;
  /** A propose run's spec, from the repository root. */
  readonly proposal?: string;
  readonly feedback?: FeedbackInput;
  readonly measurement?: { readonly round: number; readonly repeat: number };
}

/** Whether the refresh writes a file: one in the component's `generated/` directory, or the package entry file. */
export function refreshedFile(directory: string, entry: string): (file: string) => boolean {
  const generated = `${directory}/${generatedDirectory}/`;
  return (file) => file.startsWith(generated) || file === entry;
}

/** A run that ran to its end. */
export interface AgentRunDone {
  readonly id: string;
  /** The run's directory, absolute. */
  readonly runDir: string;
  readonly outcome: AgentRunOutcome;
  /** The calls' full results, and what the loop got from each. */
  readonly connection: AgentLoopCall;
}

/**
 * Runs an agent run for a prepared command: takes the component's run lock (refused (2) while
 * another run of the component is in progress), connects the agent call to the loop with the
 * config's caps, models and prices, stops the run on SIGINT, and releases the lock at the end.
 */
export async function runAgentCommand(
  setup: AgentCommandSetup,
  request: AgentRunRequest,
  context: Context,
): Promise<AgentRunDone | Stop> {
  const { repo, config, adapter, component, directory } = setup;
  const started = new Date();
  const id = newRunId(started, component);
  const runDir = runDirectory(repo, id);

  const lock = await acquireRunLock(repo, component, id);
  if (!lock.acquired) {
    return {
      stop: refused(
        `${setup.spec.spec.name} has a run in progress: ${lock.holder.run}, started ${lock.holder.started} by process ${String(lock.holder.pid)}. Wait for it to end, or stop it, before starting another.`,
        "fazon runs",
      ),
    };
  }

  const interrupt = new AbortController();
  const onInterrupt = () => {
    interrupt.abort();
  };
  const external = context.environment.interrupt;
  if (external === undefined) process.on("SIGINT", onInterrupt);
  else if (external.aborted) interrupt.abort();
  else external.addEventListener("abort", onInterrupt, { once: true });

  try {
    const readOnly = request.access === "read";
    const connection = agentLoopCall({
      repo,
      scope: { directory, patterns: readOnly ? [] : adapter.componentFiles(setup.spec.spec).patterns },
      selfChecks: readOnly ? noSelfChecks : adapter.selfChecks(directory),
      ...(request.access === undefined ? {} : { access: request.access }),
      prompt: request.prompt,
      ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
      ...(request.answer === undefined ? {} : { answer: request.answer }),
      harnessFile: request.harnessFile ?? refreshedFile(directory, toPosix(config.paths.entry)),
      prices: config.prices,
      command: setup.claudeCode.command,
      env: context.environment.env,
    });
    const outcome = await runAgent(
      {
        kind: request.kind,
        id,
        runDir,
        component: setup.spec.spec.name,
        settings: loopSettings(config),
        versions: { framework: version, adapter: version, claudeCode: setup.claudeCode.version, image: config.image },
        ...(request.measurement === undefined ? {} : { measurement: request.measurement }),
        ...(request.proposal === undefined ? {} : { proposal: request.proposal }),
        ...(request.feedback === undefined ? {} : { feedback: request.feedback }),
      },
      {
        call: connection.call,
        ...request.dependencies,
        inputs: () => readRunInputs(setup, { api: request.approvedApi === true }),
        signal: interrupt.signal,
      },
    );
    return { id, runDir, outcome, connection };
  } finally {
    if (external === undefined) process.off("SIGINT", onInterrupt);
    else external.removeEventListener("abort", onInterrupt);
    await lock.release();
  }
}

/** What each reason a run needs a person means, for the developer. */
const reasons: Readonly<Record<RunReason, string>> = {
  iterations: "its calls ran out",
  budget: "it reached its budget",
  "run-time": "it reached its run-time cap",
  violation: "the agent changed files outside the ones it may change",
  dependency: "the component needs a new dependency",
  "shared-code": "the component needs a change to shared code",
  "check-error": "the same check ended in error twice in a row",
  "inputs-changed": "the spec, approved API, token set, conventions doc or config changed during the run",
};

/** The status a run's end gives its command (docs/spec/cli.md#exit-codes). */
export function runStatus(done: AgentRunDone): Status {
  switch (done.outcome.record.status) {
    case "passed":
      return "ok";
    case "needs-a-person":
      return "needs-a-person";
    case "stopped":
      return "interrupted";
    default:
      return "error";
  }
}

/** The messages about a run's end: how it ended and why, what it cost, and why its last call failed. */
export function runMessages(done: AgentRunDone): Message[] {
  const { record, need } = done.outcome;
  const { totals } = record;
  const cost = `$${totals.costUsd.toFixed(2)}${totals.costEstimated === true ? " (estimated)" : ""}`;
  const calls = `${String(totals.iterations)} ${totals.iterations === 1 ? "call" : "calls"}`;
  const messages: Message[] = [];
  const last = done.connection.returned.at(-1);
  if (last?.message !== undefined && last.end === "error") {
    messages.push({ level: "error", text: `The agent's last call ended in error: ${last.message}` });
  }
  const lastIteration = record.iterations.at(-1);
  if (lastIteration?.violations !== undefined && lastIteration.violations.length > 0) {
    messages.push({
      level: "error",
      text: `The agent changed files it may not change (PERM-002), which are left as they are: ${lastIteration.violations.join(", ")}.`,
    });
  }
  if (need !== undefined) messages.push({ level: "error", text: `The agent says: ${need.message}` });
  const summary = `Run ${record.id} (${record.kind}): ${calls}, ${cost}.`;
  switch (record.status) {
    case "passed":
      messages.push({ level: "info", text: `${summary} It passed.` });
      break;
    case "needs-a-person":
      messages.push({
        level: "error",
        text: `${summary} It needs a person: ${record.reason === undefined ? "it stopped" : reasons[record.reason]}.`,
      });
      break;
    case "stopped":
      messages.push({ level: "warning", text: `${summary} It was interrupted.` });
      break;
    default:
      messages.push({ level: "error", text: `${summary} It ended as ${record.status}.` });
  }
  return messages;
}

/** The result fields every agent command's run has. */
export function runResult(done: AgentRunDone): Record<string, unknown> {
  const { record } = done.outcome;
  return {
    run: record.id,
    kind: record.kind,
    status: record.status,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    iterations: record.totals.iterations,
    costUsd: record.totals.costUsd,
    ...(record.totals.costEstimated === true ? { costEstimated: true } : {}),
    record: `${runsDirectory}/${record.id}/run.json`,
  };
}
