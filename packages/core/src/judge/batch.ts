// SPDX-License-Identifier: GPL-3.0-or-later
// Judge calls through the Message Batches API (docs/spec/measurement.md#the-calls-a-round-makes):
// the same requests a direct call makes, every repeat a request of its own, at half the price.
// A batch holds at most 256 MB, so the requests go in as many batches as they need.
import type Anthropic from "@anthropic-ai/sdk";
import type { EffortLevel, ModelPrice } from "../config/types.js";
import type { JudgeCall } from "./plan.js";
import { costOf } from "./prices.js";
import { judgeRequest } from "./request.js";
import { noTokens, readAnswer, tokensOf, type JudgeAttempt } from "./run.js";

/** A batch's share of the list price. */
export const batchDiscount = 0.5;

/** Below the API's 256 MB, with room for the request envelope. */
const maxBatchBytes = 200 * 1024 * 1024;
/** Below the API's 100,000 requests. */
const maxBatchRequests = 50_000;

export type BatchResult =
  | { readonly type: "succeeded"; readonly message: Anthropic.Message }
  | { readonly type: "errored"; readonly error: string }
  | { readonly type: "canceled" | "expired" };

/** The batches API, as the judge uses it; tests pass a fake. */
export interface BatchClient {
  /** Creates a batch; resolves to its ID. */
  readonly submit: (
    requests: readonly { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  ) => Promise<string>;
  /** Resolves once the batch has ended. */
  readonly wait: (id: string, signal?: AbortSignal) => Promise<void>;
  /** Every request's result, by its custom ID. */
  readonly results: (id: string) => AsyncIterable<{ readonly custom_id: string; readonly result: BatchResult }>;
}

/** The SDK's batches, polled every minute until they end. */
export function sdkBatchClient(client: Anthropic, pollMs = 60_000): BatchClient {
  return {
    submit: async (requests) => (await client.messages.batches.create({ requests: [...requests] })).id,
    wait: async (id, signal) => {
      for (;;) {
        const batch = await client.messages.batches.retrieve(id, {}, signal === undefined ? {} : { signal });
        if (batch.processing_status === "ended") return;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
    results: async function* (id) {
      for await (const entry of await client.messages.batches.results(id)) {
        const result = entry.result;
        yield {
          custom_id: entry.custom_id,
          result:
            result.type === "succeeded"
              ? { type: "succeeded", message: result.message }
              : result.type === "errored"
                ? { type: "errored", error: `${result.error.error.type}: ${result.error.error.message}` }
                : { type: result.type },
        };
      }
    },
  };
}

/** One call to make: its key, its plan call, and its images as PNG files within the limits. */
export interface BatchEntry {
  readonly key: string;
  readonly call: JudgeCall;
  readonly spec: { readonly file: string; readonly text: string };
  readonly images: readonly Buffer[];
}

export interface JudgeBatchInput {
  readonly entries: readonly BatchEntry[];
  readonly repeats: number;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly price: ModelPrice;
  readonly client: BatchClient;
  readonly signal?: AbortSignal;
  readonly progress?: (text: string) => void;
}

/** Each entry's attempts, one per repeat, by key; their costs are at the batch price. */
export async function judgeInBatches(input: JudgeBatchInput): Promise<Map<string, JudgeAttempt[]>> {
  const repeats = Math.max(1, Math.floor(input.repeats));
  const requests = input.entries.flatMap((entry) => {
    const params = judgeRequest({
      model: input.model,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      spec: entry.spec,
      call: entry.call,
      images: entry.images,
    });
    return Array.from({ length: repeats }, (_, repeat) => ({ custom_id: `${entry.key}~${String(repeat)}`, params }));
  });
  // Batches of at most maxBatchBytes and maxBatchRequests, in order.
  const chunks: (typeof requests)[] = [];
  let current: typeof requests = [];
  let size = 0;
  for (const request of requests) {
    const bytes = JSON.stringify(request).length;
    if (current.length > 0 && (size + bytes > maxBatchBytes || current.length >= maxBatchRequests)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(request);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);

  const attempts = new Map<string, JudgeAttempt[]>(input.entries.map((entry) => [entry.key, []]));
  const ids: string[] = [];
  for (const chunk of chunks) ids.push(await input.client.submit(chunk));
  input.progress?.(
    `Submitted ${String(requests.length)} requests in ${String(ids.length)} ${ids.length === 1 ? "batch" : "batches"}\n`,
  );
  const received = new Map<string, JudgeAttempt>();
  for (const id of ids) {
    await input.client.wait(id, input.signal);
    for await (const { custom_id, result } of input.client.results(id)) {
      if (result.type === "succeeded") {
        const tokens = tokensOf(result.message);
        received.set(custom_id, {
          durationSeconds: 0,
          stopReason: result.message.stop_reason ?? "",
          tokens,
          costUsd: costOf(tokens, input.price, batchDiscount),
          ...readAnswer(result.message),
        });
      } else {
        received.set(custom_id, {
          durationSeconds: 0,
          tokens: noTokens,
          costUsd: 0,
          problem:
            result.type === "errored"
              ? `the request failed in the batch: ${result.error}`
              : `the request was ${result.type} in the batch`,
        });
      }
    }
  }
  for (const entry of input.entries) {
    const list = attempts.get(entry.key) ?? [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      list.push(
        received.get(`${entry.key}~${String(repeat)}`) ?? {
          durationSeconds: 0,
          tokens: noTokens,
          costUsd: 0,
          problem: "the batch returned no result for the request",
        },
      );
    }
  }
  return attempts;
}
