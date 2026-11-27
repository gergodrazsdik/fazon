// SPDX-License-Identifier: GPL-3.0-or-later
// A judge call's request: the instructions, the spec as the cached prefix, the question and the
// labelled images; the same prefix and response format for every call; nothing but the spec, the
// question and the images (JUDGE-001, JUDGE-002).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../matrix/build.js";
import { parseSpecFile } from "../spec/load.js";
import { judgeInstructions, judgeResponseSchema } from "./instructions.js";
import { judgePlan, type JudgeCall } from "./plan.js";
import { judgeRequest } from "./request.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const text = readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8");
const file = parseSpecFile("specs/button.md", text);
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const plan = judgePlan({
  spec: file.spec,
  body: file.body,
  manifest: buildManifest(file.spec, { file: file.file, themes: ["light", "dark"] }),
});
const spec = { file: "specs/button.md", text };
const image = (call: JudgeCall) => call.images.map((_, index) => Buffer.from(`png ${String(index)}`));
const request = (call: JudgeCall) => judgeRequest({ model: "claude-sonnet-5-5", spec, call, images: image(call) });

function blocks(call: JudgeCall) {
  const content = request(call).messages[0]?.content;
  return Array.isArray(content) ? content : [];
}

describe("judgeRequest", () => {
  it("puts the instructions in the system prompt and the spec first, as the cached prefix", () => {
    const [first] = plan.calls;
    if (first === undefined) throw new Error("no call");
    const params = request(first);
    expect(params.system).toBe(judgeInstructions);
    expect(blocks(first)[0]).toEqual({
      type: "text",
      text: `The spec of the component, specs/button.md:\n\n${text}`,
      cache_control: { type: "ephemeral" },
    });
  });

  it("keeps everything before the question the same for every call, so the prefix is cached", () => {
    const prefixes = new Set(
      plan.calls.map((call) => {
        const params = request(call);
        return JSON.stringify([params.model, params.system, params.output_config, blocks(call)[0]]);
      }),
    );
    expect(prefixes.size).toBe(1);
  });

  it("labels every image, and carries only the spec, the question and the images (JUDGE-001)", () => {
    const call = plan.calls.find((entry) => entry.question === "axis-variant");
    if (call === undefined) throw new Error("no axis-variant call");
    const content = blocks(call);
    expect(content.map((block) => block.type)).toEqual([
      "text",
      "text",
      "text",
      "image",
      "text",
      "image",
      "text",
      "image",
    ]);
    expect(content[1]).toEqual({
      type: "text",
      text: `Question \`axis-variant\`, a compare question: judge the images against each other. The images are in the light theme.\n\n${call.text}`,
    });
    expect(content[2]).toEqual({
      type: "text",
      text: "Image 1, label `button--label--variant-primary--size-md--default`: the story's capture.",
    });
    const texts = content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    const known = [
      `The spec of the component, specs/button.md:\n\n${text}`,
      content[1]?.type === "text" ? content[1].text : "",
    ];
    for (const entry of texts) {
      expect(known.includes(entry) || entry.startsWith("Image ")).toBe(true);
    }
  });

  it("has at most 20 images and the result schema as its response format (JUDGE-002)", () => {
    for (const call of plan.calls) {
      const params = request(call);
      expect(blocks(call).filter((block) => block.type === "image").length).toBeLessThanOrEqual(20);
      expect(params.output_config?.format).toEqual({ type: "json_schema", schema: judgeResponseSchema() });
    }
    const [first] = plan.calls;
    if (first === undefined) throw new Error("no call");
    const tooMany = {
      ...first,
      images: Array.from({ length: 21 }, () => first.images[0] ?? { kind: "capture" as const, label: "x" }),
    };
    expect(() => judgeRequest({ model: "m", spec, call: tooMany, images: image(tooMany) })).toThrow(/at most 20/);
  });

  it("sets the effort only when the config gives one", () => {
    const [first] = plan.calls;
    if (first === undefined) throw new Error("no call");
    expect(request(first).output_config).not.toHaveProperty("effort");
    expect(
      judgeRequest({ model: "m", effort: "medium", spec, call: first, images: image(first) }).output_config?.effort,
    ).toBe("medium");
  });
});

describe("judgeResponseSchema", () => {
  it("leaves out the keywords the API's structured output rejects", () => {
    const json = JSON.stringify(judgeResponseSchema());
    for (const keyword of ["$schema", "$id", "minLength", "maxItems", "title"]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
    expect(json).toContain('"additionalProperties":false');
  });
});
