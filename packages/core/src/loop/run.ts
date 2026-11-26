// SPDX-License-Identifier: GPL-3.0-or-later
// The loop (docs/spec/loop-and-caps.md): a propose run's one call, or a generate or feedback run's
// iterations, with the caps, escalation and run ends enforced here and the run record rewritten
// after every step (docs/spec/records.md#the-run-record).
import type { CheckFinding, CheckId } from "../checks/types.js";
import { recordTimestamp } from "../records/json-file.js";
import {
  roundUsd,
  writeRunRecord,
  type AgentRunKind,
  type CallRecord,
  type HandEdit,
  type IterationRecord,
  type RunInputs,
  type RunReason,
  type RunRecord,
  type RunStatus,
  type RunVersions,
  type TokenUsage,
  type Verification,
} from "../records/run-record.js";
import { generateContext, phaseVerdict } from "./blocking.js";
import { modelFor, runConfig, type LoopSettings } from "./settings.js";
import { noJudge, type AgentNeed, type ChecksPhase, type LoopDependencies } from "./types.js";

/** A feedback run's link to the run it answers. */
export interface FeedbackInput {
  /** The run it answers. */
  readonly parent: string;
  /** The developer's feedback, in plain words. */
  readonly text: string;
  /** The parent run's last findings (`lastFindings`), for the first prompt. */
  readonly findings: readonly CheckFinding[];
}

export interface AgentRunOptions {
  readonly kind: AgentRunKind;
  /** The run's ID (`newRunId`). */
  readonly id: string;
  /** The run's directory, absolute (`runDirectory`). */
  readonly runDir: string;
  /** The component, in PascalCase. */
  readonly component: string;
  readonly settings: LoopSettings;
  /** The framework, adapter, Claude Code, image and judge versions. */
  readonly versions: RunVersions & { readonly claudeCode: string };
  readonly measurement?: { readonly round: number; readonly repeat: number };
  /** A propose run's spec, from the repository root: where the proposed API is written. */
  readonly proposal?: string;
  /** Required for a feedback run, and only there. */
  readonly feedback?: FeedbackInput;
}

export interface AgentRunOutcome {
  /** The final run record, as written. */
  readonly record: RunRecord;
  /** The blocking findings of the latest iteration whose checks ran: what a person looks at first. */
  readonly findings: readonly CheckFinding[];
  /** What the agent said it needs, when the run ended for a dependency or shared code. */
  readonly need?: AgentNeed;
}

/**
 * Runs a propose, generate or feedback run to its end (docs/spec/loop-and-caps.md):
 *
 * - before each call, the iteration, budget and run-time caps (LOOP-001); the call gets the
 *   budget left as its own limit, and enforces the call-time cap itself (LOOP-002);
 * - the generator's model until `escalateAfter` failed iterations, then the escalation model's
 *   (LOOP-003);
 * - after each call: a violation, or the agent's need for a dependency or shared code, ends the
 *   run as needs a person; a call that didn't complete fails its iteration without checks;
 * - before each check phase, the run-time cap; then the checks, with the component's own visual
 *   diffs advisory, and the judge hook when they pass;
 * - the run passes with the first passing iteration, if its inputs are unchanged (LOOP-004); the
 *   same check ending in error in two check phases in a row ends it as needs a person.
 *
 * The record is rewritten after the start, each call, each check phase, each judge pass and the
 * end. An iteration whose outcome isn't known yet is recorded as `stopped`, so a crash leaves a
 * `running` record whose last iteration never finished. An error thrown by a dependency
 * propagates and leaves the record at its last step.
 * @throws Error on options that don't fit the kind of run
 */
export async function runAgent(options: AgentRunOptions, dependencies: LoopDependencies): Promise<AgentRunOutcome> {
  const { kind, settings } = options;
  const { caps } = settings;
  const propose = kind === "propose";
  if ((kind === "feedback") !== (options.feedback !== undefined)) {
    throw new Error("A feedback run, and only a feedback run, answers a parent run with feedback.");
  }
  if (propose && options.proposal === undefined) throw new Error("A propose run needs the spec it proposes into.");
  if (!propose && dependencies.checks === undefined) throw new Error(`A ${kind} run needs the checks phase.`);
  const checksPhase: ChecksPhase = dependencies.checks ?? (() => Promise.reject(new Error("No checks phase.")));

  const now = dependencies.now ?? (() => new Date());
  const signal = dependencies.signal ?? new AbortController().signal;
  // A function, not the property itself: the signal can be aborted while the loop awaits.
  const interrupted = () => signal.aborted;
  const judge = dependencies.judge ?? noJudge;
  const write = dependencies.writeRecord ?? ((record: RunRecord) => writeRunRecord(options.runDir, record));
  const maxCalls = propose ? 1 : caps.iterations;

  const started = now();
  const iterations: IterationRecord[] = [];
  const handEdits: HandEdit[] = [];
  let agentCostUsd = 0;
  let judgeCostUsd = 0;
  let costEstimated = false;
  let escalated = false;
  let tokens: TokenUsage = { input: 0, output: 0 };
  let inputs: RunInputs | undefined;
  let proposal: { path: string } | undefined;
  let status: RunStatus = "running";
  let reason: RunReason | undefined;
  let ended: Date | undefined;
  let findings: readonly CheckFinding[] = options.feedback?.findings ?? [];

  const spent = () => agentCostUsd + judgeCostUsd;
  const elapsedMinutes = () => (now().getTime() - started.getTime()) / 60_000;

  const record = (): RunRecord => {
    const costUsd = roundUsd(spent());
    const overrun = roundUsd(costUsd - caps.budgetUsd);
    return {
      fazon: 0,
      id: options.id,
      kind,
      ...(options.feedback === undefined ? {} : { parent: options.feedback.parent }),
      component: options.component,
      status,
      ...(reason === undefined ? {} : { reason }),
      started: recordTimestamp(started),
      ...(ended === undefined ? {} : { ended: recordTimestamp(ended) }),
      ...(options.measurement === undefined ? {} : { measurement: options.measurement }),
      versions: options.versions,
      ...(inputs === undefined ? {} : { inputs }),
      config: runConfig(settings),
      iterations: [...iterations],
      ...(proposal === undefined ? {} : { proposal }),
      handEdits: [...handEdits],
      totals: {
        iterations: iterations.length,
        agentCostUsd: roundUsd(agentCostUsd),
        judgeCostUsd: roundUsd(judgeCostUsd),
        costUsd,
        costEstimated,
        ...(overrun > 0 ? { overrunUsd: overrun } : {}),
        tokens,
        durationSeconds: Math.round(((ended ?? now()).getTime() - started.getTime()) / 1000),
        escalated,
      },
    };
  };

  const finish = async (end: RunStatus, why?: RunReason, need?: AgentNeed): Promise<AgentRunOutcome> => {
    status = end;
    reason = why;
    ended = now();
    const final = record();
    await write(final);
    return { record: final, findings, ...(need === undefined ? {} : { need }) };
  };

  if (dependencies.inputs !== undefined) inputs = await dependencies.inputs();
  await write(record());
  if (!propose) await dependencies.refreshGenerated?.();

  let failed = 0;
  let lastErrored: ReadonlySet<CheckId> = new Set();
  for (;;) {
    if (interrupted()) return finish("stopped");
    if (iterations.length >= maxCalls) return finish("needs-a-person", "iterations");
    if (spent() >= caps.budgetUsd) return finish("needs-a-person", "budget");
    if (elapsedMinutes() >= caps.runMinutes) return finish("needs-a-person", "run-time");

    const n = iterations.length + 1;
    const choice = modelFor(settings, failed);
    if (choice.escalated) escalated = true;
    const transcript = `calls/${String(n)}.jsonl`;
    const previous = iterations.at(-1);
    const callStarted = now();
    const result = await dependencies.call({
      runId: options.id,
      runDir: options.runDir,
      iteration: n,
      model: choice.model,
      ...(choice.effort === undefined ? {} : { effort: choice.effort }),
      budgetUsd: roundUsd(caps.budgetUsd - spent()),
      callMinutes: caps.callMinutes,
      transcript,
      left: {
        iterations: maxCalls - n + 1,
        budgetUsd: roundUsd(caps.budgetUsd - spent()),
        runMinutes: Math.max(0, caps.runMinutes - elapsedMinutes()),
      },
      findings,
      ...(previous === undefined ? {} : { previous }),
      ...(n === 1 && options.feedback !== undefined ? { feedback: options.feedback.text } : {}),
      signal,
    });
    const callEnded = now();

    agentCostUsd += result.costUsd;
    costEstimated ||= result.costEstimated;
    tokens = addTokens(tokens, result.tokens);
    if (n > 1 && result.handEdits.length > 0) handEdits.push({ after: n - 1, files: [...result.handEdits] });
    const call: CallRecord = {
      model: choice.model,
      ...(choice.effort === undefined ? {} : { effort: choice.effort }),
      started: recordTimestamp(callStarted),
      durationSeconds: Math.round((callEnded.getTime() - callStarted.getTime()) / 100) / 10,
      end: result.end,
      tokens: result.tokens,
      costUsd: result.costUsd,
      costEstimated: result.costEstimated,
      transcript,
      filesChanged: [...result.filesChanged],
    };
    let iteration: IterationRecord = { n, call, violations: [...result.violations], outcome: "stopped" };
    iterations.push(iteration);
    const settle = (patch: Partial<Pick<IterationRecord, "verification" | "outcome">>) => {
      iteration = { ...iteration, ...patch };
      iterations[n - 1] = iteration;
    };
    await write(record());

    if (interrupted()) return finish("stopped");
    if (result.violations.length > 0) {
      settle({ outcome: "fail" });
      return finish("needs-a-person", "violation");
    }
    if (result.need !== undefined) {
      settle({ outcome: "fail" });
      return finish("needs-a-person", result.need.kind, result.need);
    }
    if (result.end !== "completed") {
      // The call-time cap, Claude Code's budget limit or an error cut the call short: the iteration
      // fails without checks, and the next call (if a cap allows one) carries on.
      settle({ outcome: "fail" });
      failed += 1;
      if (propose) return finish("needs-a-person", result.end === "budget" ? "budget" : "iterations");
      await write(record());
      continue;
    }
    if (propose) {
      settle({ outcome: "pass" });
      proposal = { path: options.proposal ?? "" };
      return finish("passed");
    }

    if (elapsedMinutes() >= caps.runMinutes) return finish("needs-a-person", "run-time");
    const outcome = await checksPhase({
      runDir: options.runDir,
      iteration: n,
      captures: `captures/${String(n)}`,
      signal,
    });
    const checks = generateContext(outcome.checks, options.component);
    let verification: Verification = {
      checks,
      ...(outcome.captures === undefined ? {} : { captures: outcome.captures }),
    };
    settle({ verification });
    await write(record());
    if (interrupted()) return finish("stopped");

    let verdict = phaseVerdict(checks);
    if (verdict.passes && settings.judgePolicy !== "off") {
      const summary = await judge({
        runDir: options.runDir,
        iteration: n,
        budgetUsd: roundUsd(caps.budgetUsd - spent()),
        signal,
      });
      if (summary !== undefined) {
        judgeCostUsd += summary.costUsd;
        if (summary.tokens !== undefined) tokens = addTokens(tokens, summary.tokens);
        verification = { ...verification, judge: summary };
        settle({ verification });
        verdict = phaseVerdict(checks, summary);
        await write(record());
        if (interrupted()) return finish("stopped");
      }
    }

    if (verdict.passes) {
      settle({ outcome: "pass" });
      findings = [];
      if (inputs !== undefined && dependencies.inputs !== undefined) {
        const current = await dependencies.inputs();
        if (inputsChanged(inputs, current)) return finish("needs-a-person", "inputs-changed");
      }
      return finish("passed");
    }
    settle({ outcome: "fail" });
    failed += 1;
    findings = verdict.blocking;
    if (verdict.errored.some((check) => lastErrored.has(check))) return finish("needs-a-person", "check-error");
    lastErrored = new Set(verdict.errored);
    await write(record());
  }
}

/** Whether any hash the run started from differs now, or is gone. */
function inputsChanged(before: RunInputs, now: RunInputs): boolean {
  return Object.entries(before).some(([name, hash]) => now[name as keyof RunInputs] !== hash);
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  const sum = (x: number | undefined, y: number | undefined) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  const cacheRead = sum(a.cacheRead, b.cacheRead);
  const cacheWrite = sum(a.cacheWrite, b.cacheWrite);
  return {
    input: a.input + b.input,
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    output: a.output + b.output,
  };
}

/**
 * The findings a feedback run's first prompt carries from the run it answers: the blocking
 * findings of that run's last iteration whose checks ran. None when it passed.
 */
export function lastFindings(record: RunRecord): CheckFinding[] {
  const checked = record.iterations.findLast((iteration) => iteration.verification !== undefined);
  return (checked?.verification?.checks ?? []).flatMap((check) => check.findings.filter((f) => f.blocking));
}
