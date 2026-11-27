// SPDX-License-Identifier: GPL-3.0-or-later
// Making a plan's calls (docs/spec/judge.md): each call repeated as configured, the majority
// verdict of each image, a declined call or a failed request as `unsure`, the cost from the
// API's usage, no call started once the budget is spent (JUDGE-004), and each story's verdict
// from its calls, or "not judged" with the reason (JUDGE-003).
import Anthropic from "@anthropic-ai/sdk";
import type { EffortLevel, ModelPrice } from "../config/types.js";
import type { TokenUsage } from "../records/run-record.js";
import { validateWithSchema } from "../validation/validate.js";
import { fitPng } from "./images.js";
import type { JudgeCall, JudgePlan, JudgePlanImage } from "./plan.js";
import { addTokens, costOf } from "./prices.js";
import { judgeRequest } from "./request.js";

export type Verdict = "pass" | "fail" | "unsure";
export type Severity = "high" | "medium" | "low";

export interface JudgeFinding {
  readonly severity: Severity;
  readonly message: string;
}

/** The one method of the SDK the judge uses; tests pass a fake. */
export interface JudgeClient {
  readonly create: (
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { readonly signal?: AbortSignal },
  ) => Promise<Anthropic.Message>;
}

/** The SDK's client, streaming each request so that a long answer doesn't time out. */
export function sdkJudgeClient(client: Anthropic): JudgeClient {
  return { create: (params, options) => client.messages.stream(params, options).finalMessage() };
}

/** One request of a call: a call makes as many as the repeats. */
export interface JudgeAttempt {
  readonly durationSeconds: number;
  /** The API's stop reason; absent when the request failed. */
  readonly stopReason?: string;
  readonly tokens: TokenUsage;
  readonly costUsd: number;
  /** The answer, when it parsed against the result schema. */
  readonly answer?: unknown;
  /** Why this attempt's images are `unsure`: the model declined, the answer was cut off or invalid, or the request failed. */
  readonly problem?: string;
}

/** An image's verdict in a call, after the majority of its attempts. */
export interface ImageVerdict {
  readonly label: string;
  readonly story?: string;
  readonly verdict: Verdict;
  readonly findings: readonly JudgeFinding[];
  /** Why it's `unsure` when the model didn't say so itself. */
  readonly reason?: string;
}

export interface JudgeCallRecord {
  /** The call's position in the plan. */
  readonly index: number;
  readonly question: string;
  readonly theme: string;
  readonly attempts: readonly JudgeAttempt[];
  /** Absent for a call that never started. */
  readonly images?: readonly ImageVerdict[];
  /** Why the call never started. */
  readonly skipped?: string;
  readonly costUsd: number;
  readonly tokens: TokenUsage;
}

export interface StoryFinding extends JudgeFinding {
  readonly question: string;
  readonly theme: string;
  readonly verdict: "fail" | "unsure";
}

/** A story's verdict in one theme: the run record counts story-theme pairs. */
export interface StoryVerdict {
  readonly story: string;
  readonly theme: string;
  readonly verdict: Verdict | "not-judged";
  /** For `not-judged`, why; for an `unsure` the model didn't give, what went wrong. */
  readonly reasons: readonly string[];
  /** The findings of its `fail` and `unsure` verdicts. */
  readonly findings: readonly StoryFinding[];
}

export interface JudgeOutcome {
  readonly calls: readonly JudgeCallRecord[];
  readonly stories: readonly StoryVerdict[];
  readonly costUsd: number;
  readonly tokens: TokenUsage;
}

export interface RunJudgeInput {
  readonly plan: JudgePlan;
  readonly spec: { readonly file: string; readonly text: string };
  readonly model: string;
  readonly effort?: EffortLevel;
  /** Requests per call; the majority verdict of each image wins, and a tie is `unsure`. */
  readonly repeats: number;
  readonly price: ModelPrice;
  /** No request starts once the calls have cost this much. */
  readonly budgetUsd: number;
  /** Reads an image of a call as a PNG. */
  readonly loadImage: (image: JudgePlanImage, call: JudgeCall) => Promise<Buffer>;
  readonly client: JudgeClient;
  readonly signal?: AbortSignal;
  /** Calls in flight at once. */
  readonly concurrency?: number;
  /** Milliseconds, for durations; tests pass a fake. */
  readonly now?: () => number;
}

/** The credential was refused, or federation couldn't get a token: no call can succeed. */
export class JudgeCredentialError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JudgeCredentialError";
  }
}

const noTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function tokensOf(message: Anthropic.Message): TokenUsage {
  const usage = message.usage;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

function isCredentialError(error: unknown): boolean {
  return (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    (error instanceof Error && error.constructor.name === "WorkloadIdentityError")
  );
}

/** What went wrong with a request, without anything the error might carry beyond its status and message. */
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `the API failed after its retries: ${error.status === undefined ? "" : `${String(error.status)} `}${error.message}`;
  }
  return `the request failed: ${error instanceof Error ? error.message : String(error)}`;
}

/** The answer of a finished request, or why its images are `unsure`. */
function readAnswer(message: Anthropic.Message): { answer?: unknown; problem?: string } {
  if (message.stop_reason === "refusal") return { problem: "the model declined the call" };
  if (message.stop_reason === "max_tokens") return { problem: "the answer was cut off at the token limit" };
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return { problem: "the answer isn't JSON" };
  }
  const findings = validateWithSchema("judge-result", answer);
  if (findings.length > 0)
    return { problem: `the answer doesn't match the result schema at ${findings[0]?.path ?? "$"}` };
  return { answer };
}

interface Answer {
  readonly results: readonly {
    readonly story: string;
    readonly verdict: Verdict;
    readonly findings: readonly JudgeFinding[];
  }[];
}

/** Each image's verdict in one attempt; `undefined` where the attempt gives none. */
function attemptVerdicts(call: JudgeCall, attempt: JudgeAttempt): (ImageVerdict | undefined)[] {
  const answer = attempt.answer as Answer | undefined;
  return call.images.map((image) => {
    const base = { label: image.label, ...(image.story === undefined ? {} : { story: image.story }) };
    if (answer === undefined)
      return { ...base, verdict: "unsure", findings: [], reason: attempt.problem ?? "no answer" };
    const result = answer.results.find((entry) => entry.story.toLowerCase() === image.label.toLowerCase());
    if (result === undefined)
      return { ...base, verdict: "unsure", findings: [], reason: "the answer gave this image no verdict" };
    return { ...base, verdict: result.verdict, findings: result.verdict === "pass" ? [] : result.findings };
  });
}

/** The majority verdict of each image over the attempts; a tie is `unsure`. */
export function majority(call: JudgeCall, attempts: readonly JudgeAttempt[]): ImageVerdict[] {
  const perAttempt = attempts.map((attempt) => attemptVerdicts(call, attempt));
  return call.images.map((image, index) => {
    const verdicts = perAttempt.map((verdicts) => verdicts[index]).filter((entry) => entry !== undefined);
    const counts = new Map<Verdict, number>();
    for (const entry of verdicts) counts.set(entry.verdict, (counts.get(entry.verdict) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [top, second] = ranked;
    const base = { label: image.label, ...(image.story === undefined ? {} : { story: image.story }) };
    if (top === undefined) return { ...base, verdict: "unsure", findings: [], reason: "no answer" };
    if (second?.[1] === top[1]) {
      return { ...base, verdict: "unsure", findings: [], reason: "the repeats disagreed, with no majority" };
    }
    const winners = verdicts.filter((entry) => entry.verdict === top[0]);
    const findings = [
      ...new Map(winners.flatMap((entry) => entry.findings).map((finding) => [finding.message, finding])).values(),
    ];
    const reasons = [...new Set(winners.map((entry) => entry.reason).filter((reason) => reason !== undefined))];
    return { ...base, verdict: top[0], findings, ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}) };
  });
}

/** Each story's verdict in each theme it's judged in: `fail` if any call failed it, else `unsure` if any was unsure, else `pass`; "not judged" when no call that covers it ran. */
export function storyVerdicts(plan: JudgePlan, calls: readonly JudgeCallRecord[]): StoryVerdict[] {
  const order: { story: string; theme: string; key: string }[] = [];
  const byStory = new Map<
    string,
    { verdicts: Verdict[]; reasons: string[]; findings: StoryFinding[]; skipped: string[] }
  >();
  plan.calls.forEach((call, index) => {
    const record = calls[index];
    for (const [position, image] of call.images.entries()) {
      if (image.story === undefined || image.kind === "component") continue;
      const key = `${image.story} ${call.theme}`;
      let entry = byStory.get(key);
      if (entry === undefined) {
        entry = { verdicts: [], reasons: [], findings: [], skipped: [] };
        byStory.set(key, entry);
        order.push({ story: image.story, theme: call.theme, key });
      }
      const verdict = record?.images?.[position];
      if (verdict === undefined) {
        entry.skipped.push(record?.skipped ?? "its call didn't run");
        continue;
      }
      entry.verdicts.push(verdict.verdict);
      if (verdict.reason !== undefined) entry.reasons.push(`${call.question} (${call.theme}): ${verdict.reason}`);
      if (verdict.verdict !== "pass") {
        for (const finding of verdict.findings) {
          entry.findings.push({ ...finding, question: call.question, theme: call.theme, verdict: verdict.verdict });
        }
      }
    }
  });
  return order.map(({ story, theme, key }) => {
    const entry = byStory.get(key);
    const verdicts = entry?.verdicts ?? [];
    if (verdicts.length === 0) {
      return { story, theme, verdict: "not-judged", reasons: [...new Set(entry?.skipped ?? [])], findings: [] };
    }
    const verdict: Verdict = verdicts.includes("fail") ? "fail" : verdicts.includes("unsure") ? "unsure" : "pass";
    return { story, theme, verdict, reasons: [...new Set(entry?.reasons ?? [])], findings: entry?.findings ?? [] };
  });
}

/** Makes the plan's calls and gives every story's verdict. Throws `JudgeCredentialError` when the credential is refused. */
export async function runJudge(input: RunJudgeInput): Promise<JudgeOutcome> {
  const now = input.now ?? (() => Date.now());
  const repeats = Math.max(1, Math.floor(input.repeats));
  const records: (JudgeCallRecord | undefined)[] = Array.from({ length: input.plan.calls.length });
  let spent = 0;
  let next = 0;
  let fatal: unknown;

  const stopReason = (): string | undefined => {
    if (fatal !== undefined) return "the credential was refused";
    if (input.signal?.aborted === true) return "the judge was interrupted";
    if (spent >= input.budgetUsd) return "the judge's budget was spent";
    return undefined;
  };

  const runCall = async (index: number, call: JudgeCall): Promise<JudgeCallRecord> => {
    const attempts: JudgeAttempt[] = [];
    const skip = stopReason();
    if (skip !== undefined)
      return {
        index,
        question: call.question,
        theme: call.theme,
        attempts,
        skipped: skip,
        costUsd: 0,
        tokens: noTokens,
      };
    let images: Buffer[];
    try {
      images = await Promise.all(call.images.map(async (image) => fitPng(await input.loadImage(image, call))));
    } catch (error) {
      const problem = `an image couldn't be read: ${error instanceof Error ? error.message : String(error)}`;
      const failed: JudgeAttempt = { durationSeconds: 0, tokens: noTokens, costUsd: 0, problem };
      return {
        index,
        question: call.question,
        theme: call.theme,
        attempts: [failed],
        images: majority(call, [failed]),
        costUsd: 0,
        tokens: noTokens,
      };
    }
    const params = judgeRequest({
      model: input.model,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      spec: input.spec,
      call,
      images,
    });
    for (let repeat = 0; repeat < repeats; repeat++) {
      // Checked again just before each request: images load in between, and other calls finish (JUDGE-004).
      if (stopReason() !== undefined) break;
      const started = now();
      try {
        const message = await input.client.create(params, input.signal === undefined ? {} : { signal: input.signal });
        const tokens = tokensOf(message);
        const costUsd = costOf(tokens, input.price);
        spent += costUsd;
        attempts.push({
          durationSeconds: (now() - started) / 1000,
          stopReason: message.stop_reason ?? "",
          tokens,
          costUsd,
          ...readAnswer(message),
        });
      } catch (error) {
        if (isCredentialError(error)) {
          fatal = error;
          break;
        }
        if (error instanceof Anthropic.APIUserAbortError || input.signal?.aborted === true) break;
        attempts.push({
          durationSeconds: (now() - started) / 1000,
          tokens: noTokens,
          costUsd: 0,
          problem: describe(error),
        });
      }
    }
    const tokens = attempts.reduce((sum, attempt) => addTokens(sum, attempt.tokens), noTokens);
    const costUsd = attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    if (attempts.length === 0) {
      return {
        index,
        question: call.question,
        theme: call.theme,
        attempts,
        skipped: stopReason() ?? "its call didn't run",
        costUsd,
        tokens,
      };
    }
    return {
      index,
      question: call.question,
      theme: call.theme,
      attempts,
      images: majority(call, attempts),
      costUsd,
      tokens,
    };
  };

  const worker = async () => {
    for (;;) {
      const index = next++;
      const call = input.plan.calls[index];
      if (call === undefined) return;
      records[index] = await runCall(index, call);
    }
  };
  // The first call alone writes the cached prefix (the instructions and the spec); the rest read it.
  const [first] = input.plan.calls;
  if (first !== undefined) records[next++] = await runCall(0, first);
  const workers = Math.max(1, Math.min(input.concurrency ?? 4, input.plan.calls.length - 1));
  await Promise.all(Array.from({ length: workers }, worker));

  if (fatal !== undefined) {
    const reason = fatal instanceof Error ? fatal.message : "unknown error";
    throw new JudgeCredentialError(`the API refused the judge's credential: ${reason}`, { cause: fatal });
  }
  const calls = records.map((record, index) => {
    if (record !== undefined) return record;
    const call = input.plan.calls[index];
    return {
      index,
      question: call?.question ?? "",
      theme: call?.theme ?? "",
      attempts: [],
      skipped: "its call didn't run",
      costUsd: 0,
      tokens: noTokens,
    };
  });
  return {
    calls,
    stories: storyVerdicts(input.plan, calls),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    tokens: calls.reduce((sum, call) => addTokens(sum, call.tokens), noTokens),
  };
}
