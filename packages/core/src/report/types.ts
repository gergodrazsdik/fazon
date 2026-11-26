// SPDX-License-Identifier: GPL-3.0-or-later
// The run record as the report reads it: every field of docs/spec/schemas/run-record.schema.json,
// including the agent runs' iterations, calls and judge summaries, which a verify run leaves out.
import type { CheckResult, RunRecord } from "../verify/run-record.js";

export interface ReportTokens {
  readonly input: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly output: number;
}

/** `$defs.call`: one headless agent call. */
export interface ReportCall {
  readonly model: string;
  readonly effort?: string;
  readonly started: string;
  readonly durationSeconds: number;
  readonly end: "completed" | "call-time" | "budget" | "error";
  readonly tokens: ReportTokens;
  readonly costUsd: number;
  readonly costEstimated?: boolean;
  readonly transcript: string;
  readonly filesChanged?: readonly string[];
}

/** `$defs.judgeSummary`'s findings: the `fail` and `unsure` verdicts. */
export interface ReportJudgeFinding {
  readonly question: string;
  readonly story: string;
  readonly theme: string;
  readonly verdict: "fail" | "unsure";
  readonly severity: "high" | "medium" | "low";
  readonly message: string;
}

/** `$defs.judgeSummary`. */
export interface ReportJudge {
  readonly calls: number;
  readonly costUsd: number;
  readonly tokens?: ReportTokens;
  readonly stories: {
    readonly pass: number;
    readonly fail: number;
    readonly unsure: number;
    readonly notJudged: number;
  };
  readonly blocking?: boolean;
  readonly results: string;
  readonly findings?: readonly ReportJudgeFinding[];
}

/** `$defs.verification`. */
export interface ReportVerification {
  readonly checks: readonly CheckResult[];
  /** The directory of the captures and diff images, relative to the run's directory. */
  readonly captures?: string;
  readonly judge?: ReportJudge;
}

/** `$defs.iteration`. */
export interface ReportIteration {
  readonly n: number;
  readonly call: ReportCall;
  readonly violations?: readonly string[];
  readonly verification?: ReportVerification;
  readonly outcome: "pass" | "fail" | "stopped";
}

/** The run record with every field the schema defines. */
export interface ReportRecord extends Omit<RunRecord, "iterations" | "verification" | "handEdits" | "totals"> {
  readonly parent?: string;
  readonly measurement?: { readonly round: number; readonly repeat: number };
  readonly iterations: readonly ReportIteration[];
  readonly verification?: ReportVerification;
  readonly proposal?: { readonly path: string };
  readonly handEdits: readonly { readonly after: number; readonly files: readonly string[] }[];
  readonly totals: RunRecord["totals"] & {
    readonly costEstimated?: boolean;
    readonly overrunUsd?: number;
    readonly tokens?: ReportTokens;
  };
}

/** The verification whose captures the gallery shows: a verify run's, or the latest iteration's that has one. */
export function galleryVerification(
  record: ReportRecord,
): { readonly verification: ReportVerification; readonly iteration?: number } | undefined {
  if (record.verification !== undefined) return { verification: record.verification };
  for (const iteration of [...record.iterations].reverse()) {
    if (iteration.verification !== undefined) return { verification: iteration.verification, iteration: iteration.n };
  }
  return undefined;
}

/** A story's visual status in the report. */
export type ReportVisualStatus = "new" | "unchanged" | "changed";

/** One story in one theme, as the gallery shows it. Image paths are relative to the report's directory. */
export interface ReportCapture {
  /** The component's kebab-case name. */
  readonly component: string;
  /** The story's name: `<component>--<fixture>--…--<state>`. */
  readonly story: string;
  readonly theme: string;
  /** Its baseline's path in the baselines directory. */
  readonly path: string;
  readonly image?: string;
  readonly diff?: string;
  /** The baseline it was compared with, shown before and after when it changed. */
  readonly baseline?: string;
  readonly status?: ReportVisualStatus;
  readonly renamedFrom?: string;
  /** The live story in the local Storybook. */
  readonly storybook?: string;
}
