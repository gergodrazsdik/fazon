// SPDX-License-Identifier: GPL-3.0-or-later
// The connection between the headless agent call (../agent/call.ts) and the loop (./run.ts): a
// `LoopCall` that runs `claude -p` with the caps the loop passes, takes the snapshots between calls
// for hand edits (PERM-005), and maps the call's result onto what the loop records. Shared by
// `fazon propose`, `fazon generate` and `fazon feedback`.
import type { JsonSchema, SelfChecks } from "../adapter.js";
import { runAgentCall, type AgentCallOptions, type AgentCallResult } from "../agent/call.js";
import type { AgentAccess } from "../agent/settings.js";
import { changedFiles, takeSnapshot, type AgentScope, type Snapshot } from "../agent/snapshot.js";
import type { ModelPrice } from "../config/types.js";
import { parseAgentNeed } from "./blocking.js";
import type { LoopCall, LoopCallInput, LoopCallResult } from "./types.js";

/** No self-check commands: the agent of a call that only reads runs nothing. */
export const noSelfChecks: SelfChecks = { commands: [], cacheDirectories: [] };

export interface AgentLoopCallOptions {
  /** The repository root, absolute. */
  readonly repo: string;
  /** The component's directory and the adapter's file patterns; patterns `[]` for a call that may write nothing. */
  readonly scope: AgentScope;
  /** The adapter's self-check commands for the component; `noSelfChecks` for a call that only reads. */
  readonly selfChecks: SelfChecks;
  /** `read` for a propose call: only the reading tools, no edits, no shell. `edit` by default. */
  readonly access?: AgentAccess;
  /** Builds each call's prompt from what the loop passes: the iteration, the caps left, the findings, the feedback. */
  readonly prompt: (input: LoopCallInput) => string | Promise<string>;
  /** A JSON Schema for the final answer (`--json-schema`), as a propose call has. */
  readonly jsonSchema?: JsonSchema;
  /**
   * Reads a completed call's answer, such as a propose call's API: returns why it can't be used,
   * which ends the call in `error` with that message, or `undefined` when it can.
   */
  readonly answer?: (result: AgentCallResult) => string | undefined | Promise<string | undefined>;
  /** Prices by model (the config's `prices`), to estimate a call's cost when Claude Code reports none. */
  readonly prices?: Readonly<Record<string, ModelPrice>>;
  /** The Claude Code executable; `claude` on the PATH by default. */
  readonly command?: string;
  /** Claude Code's environment; the harness's own by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How long a stopped call gets to exit after SIGTERM; 5 seconds by default. */
  readonly killGraceMs?: number;
  /** Runs one call; `runAgentCall` by default. */
  readonly run?: (options: AgentCallOptions) => Promise<AgentCallResult>;
}

/** The loop's agent call, and what the calls returned beyond what the loop records. */
export interface AgentLoopCall {
  readonly call: LoopCall;
  /** Every call's full result, in order. */
  readonly results: readonly AgentCallResult[];
  /** What the loop got from every call, in order: its `message` says why a call ended in error, which the run record doesn't. */
  readonly returned: readonly LoopCallResult[];
  /** Claude Code's version as its first call reported it. */
  readonly claudeCodeVersion: () => string | undefined;
}

/**
 * Turns the headless agent call into the loop's `LoopCall`:
 *
 * - the loop's model and effort; the budget left as the call's own limit (`--max-budget-usd`); the
 *   call-time cap in milliseconds;
 * - a snapshot before each call, compared with the one after the previous call: the files a person
 *   changed in between are the call's `handEdits`;
 * - the result: how the call ended, its tokens and cost (estimated from `prices` when Claude Code
 *   reported none), the files it changed inside the allowed paths, the violations outside them,
 *   and a `FAZON-NEEDS` line of its final message;
 * - `answer`, when given, reads a completed call's answer; an answer it can't use ends the call in error.
 *
 * Like `runAgentCall`, it returns rather than throws for how the call went.
 */
export function agentLoopCall(options: AgentLoopCallOptions): AgentLoopCall {
  const run = options.run ?? runAgentCall;
  const results: AgentCallResult[] = [];
  const returned: LoopCallResult[] = [];
  let lastAfter: Snapshot | undefined;

  const call: LoopCall = async (input) => {
    const before = await takeSnapshot(options.repo);
    const handEdits = lastAfter === undefined ? [] : changedFiles(lastAfter, before);
    const price = options.prices?.[input.model];
    const result = await run({
      repo: options.repo,
      prompt: await options.prompt(input),
      scope: options.scope,
      selfChecks: options.selfChecks,
      ...(options.access === undefined ? {} : { access: options.access }),
      ...(options.jsonSchema === undefined ? {} : { jsonSchema: options.jsonSchema }),
      model: input.model,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      maxBudgetUsd: input.budgetUsd,
      timeoutMs: input.callMinutes * 60_000,
      runDirectory: input.runDir,
      iteration: input.iteration,
      before,
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(options.env === undefined ? {} : { env: options.env }),
      signal: input.signal,
      ...(price === undefined ? {} : { price }),
      ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs }),
    });
    results.push(result);
    lastAfter = result.after;
    const loop = loopResult(result, handEdits, await answerProblem(options, result));
    returned.push(loop);
    return loop;
  };

  return {
    call,
    results,
    returned,
    claudeCodeVersion: () => results.find((result) => result.claudeCodeVersion !== undefined)?.claudeCodeVersion,
  };
}

/** Why a completed call's answer can't be used; `undefined` when it can, or when there's nothing to read. */
async function answerProblem(options: AgentLoopCallOptions, result: AgentCallResult): Promise<string | undefined> {
  if (options.answer === undefined || result.call.end !== "completed" || result.violations.length > 0) {
    return undefined;
  }
  return options.answer(result);
}

/** What the loop records of a call. */
export function loopResult(
  result: AgentCallResult,
  handEdits: readonly string[],
  answerProblem?: string,
): LoopCallResult {
  const violations = new Set(result.violations);
  const need = result.finalText === undefined ? undefined : parseAgentNeed(result.finalText);
  const message = answerProblem ?? result.error;
  return {
    end: answerProblem === undefined ? result.call.end : "error",
    tokens: result.call.tokens,
    costUsd: result.call.costUsd,
    costEstimated: result.call.costEstimated === true,
    filesChanged: result.call.filesChanged.filter((file) => !violations.has(file)),
    violations: result.violations,
    handEdits,
    ...(need === undefined ? {} : { need }),
    ...(message === undefined ? {} : { message }),
  };
}
