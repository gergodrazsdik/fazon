// SPDX-License-Identifier: GPL-3.0-or-later
// One judge call's request (docs/spec/judge.md#batching): the system instructions, the spec as
// a cached prefix, then the question and each image after a text label. Each request is a fresh
// context with at most 20 images and the result schema as its response format (JUDGE-002). It
// carries only the spec's text, the plan's question and the images: never the component's code
// or the checks' findings (JUDGE-001).
import type Anthropic from "@anthropic-ai/sdk";
import type { EffortLevel } from "../config/types.js";
import { judgeInstructions, judgeResponseSchema } from "./instructions.js";
import { maxImagesPerCall, type JudgeCall, type JudgeImageKind } from "./plan.js";

/** Room for adaptive thinking and the answer; requests are streamed, so a long one doesn't time out. */
export const judgeMaxTokens = 32_000;

export interface JudgeRequestInput {
  readonly model: string;
  /** Left out, the model runs at its default effort. */
  readonly effort?: EffortLevel;
  /** The spec file as written: front matter and body. */
  readonly spec: { readonly file: string; readonly text: string };
  readonly call: JudgeCall;
  /** Each of the call's images as a PNG within the API's limits, in the call's order. */
  readonly images: readonly Buffer[];
}

const imageKinds: Readonly<Record<JudgeImageKind, string>> = {
  capture: "the story's capture",
  baseline: "the story's committed baseline",
  diff: "the pixels that differ between baseline and capture",
  reference: "the spec's reference image",
  component: "another component of the library",
};

export function judgeRequest(input: JudgeRequestInput): Anthropic.MessageCreateParamsNonStreaming {
  const { call, images } = input;
  if (call.images.length > maxImagesPerCall) {
    throw new Error(
      `the call ${call.question} has ${String(call.images.length)} images; at most ${String(maxImagesPerCall)} fit (JUDGE-002)`,
    );
  }
  if (images.length !== call.images.length) {
    throw new Error(
      `the call ${call.question} has ${String(call.images.length)} images, but ${String(images.length)} were loaded`,
    );
  }
  const how =
    call.kind === "compare"
      ? "a compare question: judge the images against each other"
      : "an each question: judge every image on its own";
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `The spec of the component, ${input.spec.file}:\n\n${input.spec.text}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `Question \`${call.question}\`, ${how}. The images are in the ${call.theme} theme.\n\n${call.text}`,
    },
  ];
  call.images.forEach((image, index) => {
    content.push({
      type: "text",
      text: `Image ${String(index + 1)}, label \`${image.label}\`: ${imageKinds[image.kind]}.`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: (images[index] ?? Buffer.alloc(0)).toString("base64") },
    });
  });
  return {
    model: input.model,
    max_tokens: judgeMaxTokens,
    system: judgeInstructions,
    messages: [{ role: "user", content }],
    output_config: {
      format: { type: "json_schema", schema: judgeResponseSchema() },
      ...(input.effort === undefined ? {} : { effort: input.effort }),
    },
  };
}
