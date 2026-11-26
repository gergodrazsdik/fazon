// SPDX-License-Identifier: GPL-3.0-or-later
// The loop's injected dependencies (docs/spec/loop-and-caps.md): the agent call, the checks phase,
// the generated-files refresh, the judge, the inputs' hashes, a clock and an interrupt signal.
import type { CheckFinding } from "../checks/types.js";
import type { EffortLevel } from "../config/types.js";
import type {
  CallEnd,
  CheckResult,
  IterationRecord,
  JudgeSummary,
  RunInputs,
  RunRecord,
  TokenUsage,
} from "../records/run-record.js";

/** What the agent says it can't do without a person: a new dependency, or a change to shared code. */
export interface AgentNeed {
  readonly kind: "dependency" | "shared-code";
  /** What it needs, in the agent's words. */
  readonly message: string;
}

/** What the loop gives one agent call. */
export interface AgentCallInput {
  readonly runId: string;
  /** The run's directory, absolute. */
  readonly runDir: string;
  /** The iteration this call starts, from 1; a propose run's one call is 1. */
  readonly iteration: number;
  /** The model the loop chose: the generator's, or the escalation model's after escalating. */
  readonly model: string;
  /** The role's effort from the config; absent for the model's default. */
  readonly effort?: EffortLevel;
  /** The call's own spending limit: the budget the run has left (the budget cap). */
  readonly budgetUsd: number;
  /** The call-time cap: the call stops itself after this, and ends `call-time`. */
  readonly callMinutes: number;
  /** Where the call writes its transcript, relative to the run's directory: `calls/<n>.jsonl`. */
  readonly transcript: string;
  /** The caps left when the call starts, for the prompt; `iterations` counts this call. */
  readonly left: { readonly iterations: number; readonly budgetUsd: number; readonly runMinutes: number };
  /**
   * The findings to fix: the blocking findings of the latest iteration whose checks ran; on a
   * feedback run's first call, the parent run's last findings. The advisory visual diffs of the
   * component are never among them.
   */
  readonly findings: readonly CheckFinding[];
  /** The previous iteration of this run, as recorded: how its call ended, its checks, its outcome. */
  readonly previous?: IterationRecord;
  /** The developer's review feedback, on a feedback run's first call. */
  readonly feedback?: string;
  /** Aborted when the developer interrupts the run: the call stops as soon as it can. */
  readonly signal: AbortSignal;
}

/** How one agent call went, as the run record stores it (`$defs.call` and the iteration's `violations`). */
export interface AgentCallResult {
  readonly end: CallEnd;
  readonly tokens: TokenUsage;
  readonly costUsd: number;
  /** True when the cost is Claude Code's estimate (a subscription login), false when exact. */
  readonly costEstimated: boolean;
  /** The files the call changed inside the allowed paths, from the repository root. */
  readonly filesChanged: readonly string[];
  /** The files outside the allowed paths that differ from before the call (PERM-002): a violation. */
  readonly violations: readonly string[];
  /**
   * The files a person changed since the previous call of this run ended (PERM-005): the
   * difference between the snapshot after that call and the one before this call. Ignored on a
   * run's first call, which follows no call of the run.
   */
  readonly handEdits: readonly string[];
  /** Set when the agent said it needs a dependency or a change to shared code (`parseAgentNeed`). */
  readonly need?: AgentNeed;
  /** Why the call ended in error, for the developer. */
  readonly message?: string;
}

/**
 * One headless agent call (step 2 of T-0050 provides it). The loop measures the call's start and
 * duration with its clock and records the model and effort it passed. It enforces the call-time
 * cap itself (LOOP-002) and returns, rather than throws, when the agent or Claude Code fails; a
 * throw is a harness failure that leaves the run record at its last step.
 */
export type AgentCall = (input: AgentCallInput) => Promise<AgentCallResult>;

export interface ChecksInput {
  readonly runDir: string;
  readonly iteration: number;
  /** Where the iteration's captures and diff images go, relative to the run's directory: `captures/<n>`. */
  readonly captures: string;
  readonly signal: AbortSignal;
}

/**
 * A check phase's results. The phase applies the spec's exemptions, so a waived finding comes back
 * with `blocking: false`; the loop then makes the visual diffs of the component being generated
 * advisory.
 */
export interface ChecksOutcome {
  readonly checks: readonly CheckResult[];
  /** The captures' directory, relative to the run's directory, when the rendered checks ran. */
  readonly captures?: string;
}

/** Every check in the verifier image, after an agent call. */
export type ChecksPhase = (input: ChecksInput) => Promise<ChecksOutcome>;

export interface JudgeInput {
  readonly runDir: string;
  readonly iteration: number;
  /** The budget the run has left: the judge's calls count toward it. */
  readonly budgetUsd: number;
  readonly signal: AbortSignal;
}

/**
 * The judge (M3), after checks with no blocking finding: its summary, with `blocking` true when
 * its `fail` verdicts block in this run (a calibrated judge), or undefined when it didn't run.
 */
export type JudgeHook = (input: JudgeInput) => Promise<JudgeSummary | undefined>;

/** The judge until M3: it never runs. */
export const noJudge: JudgeHook = () => Promise.resolve(undefined);

/** Everything the loop calls out to; tests pass fakes. */
export interface LoopDependencies {
  readonly call: AgentCall;
  /** Required for generate and feedback runs; a propose run runs no checks. */
  readonly checks?: ChecksPhase;
  /** Regenerates the component's `generated/` directory from the spec, at the start of a generate or feedback run. */
  readonly refreshGenerated?: () => Promise<void>;
  /** Defaults to `noJudge`. */
  readonly judge?: JudgeHook;
  /**
   * The hashes of the spec, approved API, token set, conventions doc and config: read at the start
   * for the record, and again before a run passes (LOOP-004).
   */
  readonly inputs?: () => Promise<RunInputs>;
  /** The clock; defaults to the system's. */
  readonly now?: () => Date;
  /** Aborted when the developer interrupts the run. */
  readonly signal?: AbortSignal;
  /** Writes the run record after each step; defaults to `writeRunRecord` into the run's directory. */
  readonly writeRecord?: (record: RunRecord) => Promise<void>;
}
