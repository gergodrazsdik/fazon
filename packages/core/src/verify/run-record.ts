// SPDX-License-Identifier: GPL-3.0-or-later
// Run records (docs/spec/records.md): `.fazon/runs/<id>/run.json`, valid against
// docs/spec/schemas/run-record.schema.json (RECORD-001) and replaced atomically (RECORD-002).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { JudgePolicy } from "../config/types.js";
import { validateWithSchema } from "../validation/validate.js";

/** Where runs live, relative to the repository root. */
export const runsDirectory = ".fazon/runs";
/** The run record's file name in a run's directory. */
export const runRecordFile = "run.json";

export type RunKind = "propose" | "generate" | "feedback" | "verify";
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

/** The parts of the run record a verify run fills (docs/spec/records.md#the-run-record). */
export interface RunRecord {
  readonly fazon: 0;
  readonly id: string;
  readonly kind: RunKind;
  readonly component?: string;
  readonly status: RunStatus;
  readonly reason?: RunReason;
  readonly started: string;
  readonly ended?: string;
  readonly versions: {
    readonly framework: string;
    readonly adapter?: string;
    /** Absent when the run made no agent call, as in a verify run. */
    readonly claudeCode?: string;
    readonly image: string;
    /** Absent when the run used no judge. */
    readonly judge?: number;
  };
  readonly inputs?: Readonly<Partial<Record<"spec" | "api" | "tokens" | "conventions" | "config", string>>>;
  readonly config: {
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
  };
  readonly iterations: readonly unknown[];
  readonly verification?: {
    readonly checks: readonly CheckResult[];
    /** The directory of the captures and diff images, relative to the run's directory. */
    readonly captures?: string;
  };
  readonly handEdits: readonly unknown[];
  readonly totals: {
    readonly iterations: number;
    readonly agentCostUsd: number;
    readonly judgeCostUsd: number;
    readonly costUsd: number;
    readonly durationSeconds?: number;
    readonly escalated: boolean;
  };
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
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, runRecordFile);
  const temporary = path.join(directory, `.${runRecordFile}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, target);
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
