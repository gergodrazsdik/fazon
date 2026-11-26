// SPDX-License-Identifier: GPL-3.0-or-later
// Run records (docs/spec/records.md): `.fazon/runs/<id>/run.json`, valid against
// docs/spec/schemas/run-record.schema.json (RECORD-001) and replaced atomically (RECORD-002).
// Verify runs and agent runs (propose, generate, feedback) write the same record.
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { EffortLevel, JudgePolicy } from "../config/types.js";
import { validateWithSchema } from "../validation/validate.js";
import { writeJsonAtomically } from "./json-file.js";

/** Where runs live, relative to the repository root. */
export const runsDirectory = ".fazon/runs";
/** The run record's file name in a run's directory. */
export const runRecordFile = "run.json";

export type RunKind = "propose" | "generate" | "feedback" | "verify";
/** The runs with an agent call. */
export type AgentRunKind = Exclude<RunKind, "verify">;
export type RunStatus = "running" | "passed" | "failed" | "needs-a-person" | "stopped";
export type RunReason =
  "iterations" | "budget" | "run-time" | "violation" | "dependency" | "shared-code" | "check-error" | "inputs-changed";

/** How a check ended (docs/spec/check-catalogue.md#order-and-results). */
export type CheckStatus = "pass" | "fail" | "skipped" | "error";

/** One check's result, as `$defs.checkResult` stores it. */
export interface CheckResult {
  readonly check: CheckId;
  readonly status: CheckStatus;
  readonly durationSeconds: number;
  /** Why it was skipped or ended in error. */
  readonly message?: string;
  readonly findings: readonly CheckFinding[];
}

/** Token counts, as `$defs.tokens` stores them. */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/**
 * How an agent call ended: it finished; the harness stopped it at the call-time cap; Claude Code
 * stopped it at its budget limit; or it failed.
 */
export type CallEnd = "completed" | "call-time" | "budget" | "error";

/** One headless agent call, as `$defs.call` stores it. */
export interface CallRecord {
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly started: string;
  readonly durationSeconds: number;
  readonly end: CallEnd;
  readonly tokens: TokenUsage;
  readonly costUsd: number;
  /** True when the cost is Claude Code's estimate under a subscription login. */
  readonly costEstimated?: boolean;
  /** The call's transcript, relative to the run's directory: `calls/<n>.jsonl`. */
  readonly transcript: string;
  readonly filesChanged?: readonly string[];
}

/** The judge's summary of one iteration or verify run, as `$defs.judgeSummary` stores it. */
export interface JudgeSummary {
  readonly calls: number;
  readonly costUsd: number;
  readonly tokens?: TokenUsage;
  readonly stories: {
    readonly pass: number;
    readonly fail: number;
    readonly unsure: number;
    readonly notJudged: number;
  };
  /** Whether its fails blocked in this run. */
  readonly blocking?: boolean;
  /** The plan and every call's result, relative to the run's directory. */
  readonly results: string;
  readonly findings?: readonly {
    readonly question: string;
    readonly story: string;
    readonly theme: string;
    readonly verdict: "fail" | "unsure";
    readonly severity: "high" | "medium" | "low";
    readonly message: string;
  }[];
}

/** The checks and judge of a verify run or of one iteration. */
export interface Verification {
  readonly checks: readonly CheckResult[];
  /** The directory of the captures and diff images, relative to the run's directory. */
  readonly captures?: string;
  readonly judge?: JudgeSummary;
}

export type IterationOutcome = "pass" | "fail" | "stopped";

/** One iteration of an agent run, as `$defs.iteration` stores it. */
export interface IterationRecord {
  readonly n: number;
  readonly call: CallRecord;
  /** Files outside the allowed paths that changed during the call (PERM-002). */
  readonly violations?: readonly string[];
  readonly verification?: Verification;
  readonly outcome: IterationOutcome;
}

/** Files a person changed between agent calls (PERM-005). */
export interface HandEdit {
  /** The iteration they followed. */
  readonly after: number;
  readonly files: readonly string[];
}

export type InputName = "spec" | "api" | "tokens" | "conventions" | "config";
/** Hashes of what the run started from (docs/spec/records.md#hashes). */
export type RunInputs = Readonly<Partial<Record<InputName, string>>>;

/** The settings in force for a run. */
export interface RunConfig {
  readonly caps: {
    readonly iterations: number;
    readonly budgetUsd: number;
    readonly runMinutes: number;
    readonly callMinutes: number;
  };
  readonly models: { readonly generator: string; readonly escalation: string; readonly judge: string };
  readonly escalateAfter: number;
  readonly judgePolicy: JudgePolicy;
  readonly judgeCalibrated?: boolean;
}

export interface RunVersions {
  readonly framework: string;
  readonly adapter?: string;
  /** Absent when the run made no agent call, as in a verify run. */
  readonly claudeCode?: string;
  readonly image: string;
  /** Absent when the run used no judge. */
  readonly judge?: number;
}

export interface RunTotals {
  readonly iterations: number;
  readonly agentCostUsd: number;
  readonly judgeCostUsd: number;
  readonly costUsd: number;
  /** True when any agent call's cost was Claude Code's estimate. */
  readonly costEstimated?: boolean;
  /** How far the run's cost went past the budget. */
  readonly overrunUsd?: number;
  readonly tokens?: TokenUsage;
  readonly durationSeconds?: number;
  readonly escalated: boolean;
}

/** The run record (docs/spec/records.md#the-run-record). */
export interface RunRecord {
  readonly fazon: 0;
  readonly id: string;
  readonly kind: RunKind;
  /** For a feedback run: the run it answers. */
  readonly parent?: string;
  readonly component?: string;
  readonly status: RunStatus;
  readonly reason?: RunReason;
  readonly started: string;
  readonly ended?: string;
  readonly measurement?: { readonly round: number; readonly repeat: number };
  readonly versions: RunVersions;
  readonly inputs?: RunInputs;
  readonly config: RunConfig;
  readonly iterations: readonly IterationRecord[];
  readonly verification?: Verification;
  /** A propose run's proposed API: the spec it was written into. */
  readonly proposal?: { readonly path: string };
  readonly handEdits: readonly HandEdit[];
  readonly totals: RunTotals;
}

/** `<UTC time>-<label>-<4 hex digits>`, such as `20261125T164012Z-verify-3f9a`. */
export function newRunId(
  now: Date,
  label: string,
  random: () => string = () => randomBytes(2).toString("hex"),
): string {
  const time = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return `${time}-${label}-${random()}`;
}

/** A run's directory, from the repository root. */
export function runDirectory(root: string, id: string): string {
  return path.join(root, runsDirectory, id);
}

/** The schema's problems with a record; none when it's valid (RECORD-001). */
export function runRecordProblems(record: unknown): string[] {
  return validateWithSchema("run-record", record).map((p) => `${p.path}: ${p.message}`);
}

/**
 * Writes `run.json` into a run's directory: validated against its schema first, then written to a
 * temporary file and renamed over the record, so a reader never sees a partly written file.
 * @throws Error when the record isn't valid: a harness bug, never written
 */
export async function writeRunRecord(directory: string, record: RunRecord): Promise<void> {
  const problems = runRecordProblems(record);
  if (problems.length > 0) throw new Error(`The run record of ${record.id} isn't valid: ${problems.join("; ")}`);
  await writeJsonAtomically(directory, runRecordFile, record);
}

/** Reads a run's record; undefined when it doesn't exist or can't be parsed. */
export async function readRunRecord(directory: string): Promise<RunRecord | undefined> {
  try {
    return JSON.parse(await readFile(path.join(directory, runRecordFile), "utf8")) as RunRecord;
  } catch {
    return undefined;
  }
}

/** The IDs of the runs under `.fazon/runs/`, newest first. */
export async function listRunIds(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, runsDirectory), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z-[a-z][a-z0-9-]*-[0-9a-f]{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/**
 * A run and the runs it is linked to through `parent`, oldest first: for a feedback run, the
 * generate run it started from and every feedback round in between.
 * @throws Error when a record in the chain is missing, or the chain loops
 */
export async function linkedRuns(root: string, id: string): Promise<RunRecord[]> {
  const chain: RunRecord[] = [];
  const seen = new Set<string>();
  let next: string | undefined = id;
  while (next !== undefined) {
    if (seen.has(next)) throw new Error(`The run ${next} is its own ancestor.`);
    seen.add(next);
    const record = await readRunRecord(runDirectory(root, next));
    if (record === undefined) throw new Error(`The run record of ${next} is missing or can't be read.`);
    chain.unshift(record);
    next = record.parent;
  }
  return chain;
}

/** Rounds an amount in USD to a millionth of a dollar, so sums of costs don't carry float noise. */
export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
