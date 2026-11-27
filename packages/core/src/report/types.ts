// SPDX-License-Identifier: GPL-3.0-or-later
// The run record as the report reads it: every field of docs/spec/schemas/run-record.schema.json,
// including the agent runs' iterations, calls and judge summaries, which a verify run leaves out.
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { CheckResult, CheckStatus, RunRecord } from "../verify/run-record.js";

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

/**
 * Another component an agent run's checks covered (they cover the whole library), as the report
 * summarises it in one line, and shows in full only when it blocks.
 */
export interface ReportOtherComponent {
  /** The component's kebab-case name. */
  readonly component: string;
  /** Its captures (a story in a theme) by visual status; `notCompared` when the image differs from the baselines'. */
  readonly captures: {
    readonly unchanged: number;
    readonly changed: number;
    readonly new: number;
    readonly notCompared: number;
  };
  /**
   * Each check's status for it, in the catalogue's order: a check skipped or ended in error is that
   * for every component; otherwise it fails when a blocking finding is the component's own.
   */
  readonly checks: readonly { readonly check: CheckId; readonly status: CheckStatus }[];
  /** A changed story, an orphaned baseline or a blocking finding of its own: shown in full. */
  readonly blocks: boolean;
}

/** An agent run's report keeps to its component: the gallery shows its stories, and the others are summarised. */
export interface ReportFocus {
  /** The run's component, in kebab-case. */
  readonly component: string;
  /** Where components and specs live, repository-relative and `/`-separated, to tell a finding's component by its file. */
  readonly paths: { readonly components: string; readonly specs: string };
  /** Every other component of the checks phase the gallery shows, by name. */
  readonly others: readonly ReportOtherComponent[];
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

/**
 * The component a finding concerns, in kebab-case: by its story's name (`<component>--…`); for a
 * visual finding without a story (an orphaned baseline), by its baseline's path
 * (`<theme>/<component>/…`); otherwise by its file, in the component's directory or its spec.
 * Undefined for a finding of no component, such as one in the library's entry file.
 */
export function findingOwner(
  finding: Pick<CheckFinding, "check" | "story" | "file">,
  paths: ReportFocus["paths"],
): string | undefined {
  const named = (name: string | undefined): string | undefined =>
    name === undefined || name === "" ? undefined : name;
  if (finding.story !== undefined) return named(finding.story.split("--")[0]);
  const file = finding.file;
  if (file === undefined) return undefined;
  if (finding.check === "visual") return named(file.split("/")[1]);
  const under = (directory: string): string | undefined =>
    directory !== "" && file.startsWith(`${directory}/`) ? file.slice(directory.length + 1) : undefined;
  const inComponents = under(paths.components);
  if (inComponents !== undefined) return named(inComponents.split("/")[0]);
  const inSpecs = under(paths.specs);
  return inSpecs !== undefined && !inSpecs.includes("/") && inSpecs.endsWith(".md")
    ? named(inSpecs.slice(0, -".md".length))
    : undefined;
}
