// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's plan: the Button example spec gives the M0 example plan, and the rubric's other
// questions (reference, family, change, part states, CI's story filter) follow docs/spec/judge.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../matrix/build.js";
import type { StoryManifest } from "../matrix/types.js";
import { parseSpecFile, type SpecFile } from "../spec/load.js";
import type { Spec } from "../spec/types.js";
import { validateWithSchema } from "../validation/validate.js";
import { appearanceStatements, judgePlan, maxImagesPerCall, type JudgePlan } from "./plan.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const themes = ["light", "dark"];

function example(name: string): { file: SpecFile; spec: Spec; manifest: StoryManifest } {
  const text = readFileSync(new URL(`examples/specs/valid/${name}.md`, docs), "utf8");
  const file = parseSpecFile(`specs/${name}.md`, text);
  if (file.spec === undefined) throw new Error(`the example ${name} doesn't pass SPEC-001`);
  return { file, spec: file.spec, manifest: buildManifest(file.spec, { file: file.file, themes }) };
}

function plan(name: string, extra: Partial<Parameters<typeof judgePlan>[0]> = {}): JudgePlan {
  const { file, spec, manifest } = example(name);
  return judgePlan({ spec, body: file.body, manifest, ...extra });
}

const questions = (result: JudgePlan) => result.calls.map((call) => `${call.question} ${call.theme}`);

describe("the Button example", () => {
  it("gives examples/judge/button-plan.json", () => {
    const expected: unknown = JSON.parse(readFileSync(new URL("examples/judge/button-plan.json", docs), "utf8"));
    const result = plan("button");
    expect(result).toStrictEqual(expected);
    expect(JSON.stringify(result, null, 2)).toBe(JSON.stringify(expected, null, 2));
  });

  it("has 17 calls with 102 images, as judge.md says", () => {
    const result = plan("button");
    expect(result.calls).toHaveLength(17);
    expect(result.calls.reduce((sum, call) => sum + call.images.length, 0)).toBe(102);
  });

  it("covers every story in every theme the manifest gives it (JUDGE-003)", () => {
    const { manifest } = example("button");
    const result = plan("button");
    for (const story of manifest.stories) {
      for (const theme of story.judge) {
        const covered = result.calls.some(
          (call) =>
            call.question === "story" &&
            call.theme === theme &&
            call.images.some((image) => image.story === story.name),
        );
        expect(covered, `${story.name} in ${theme}`).toBe(true);
      }
    }
  });
});

describe("every example", () => {
  it.each(["button", "tabs", "dialog"])(
    "%s's plan is valid and its calls carry at most 20 images (JUDGE-002)",
    (name) => {
      const result = plan(name);
      expect(validateWithSchema("judge-plan", result)).toEqual([]);
      for (const call of result.calls) {
        expect(call.images.length).toBeGreaterThan(0);
        expect(call.images.length).toBeLessThanOrEqual(maxImagesPerCall);
      }
    },
  );

  it("names a part's state question after the part", () => {
    const result = plan("tabs");
    const state = result.calls.find((call) => call.question === "state-trigger-hover");
    expect(state?.text).toBe(
      "Is the `Trigger` part's `hover` state visibly different from default, in the way the spec describes?",
    );
    expect(state?.theme).toBe("light");
    expect(state?.images.map((image) => image.story)).toEqual([
      "tabs--three--orientation-horizontal--default",
      "tabs--three--orientation-horizontal--trigger-hover",
    ]);
  });
});

describe("the questions that need more than the spec", () => {
  it("asks reference only when the spec names a reference image", () => {
    const { file, spec, manifest } = example("button");
    const result = judgePlan({ spec: { ...spec, reference: "button.png" }, body: file.body, manifest });
    const reference = result.calls.find((call) => call.question === "reference");
    expect(reference?.theme).toBe("light");
    expect(reference?.images).toEqual([
      {
        kind: "capture",
        label: "button--label--variant-primary--size-md--default",
        story: "button--label--variant-primary--size-md--default",
      },
      { kind: "reference", label: "reference" },
    ]);
    expect(questions(result).indexOf("reference light")).toBe(questions(result).indexOf("loading-spinner light") - 1);
  });

  it("asks family with up to five other components, and leaves it out without any", () => {
    expect(questions(plan("button"))).not.toContain("family light");
    const family = Array.from({ length: 7 }, (_, index) => ({
      component: `Other${String(index)}`,
      story: `other${String(index)}--label--default`,
    }));
    const result = plan("button", { family });
    const call = result.calls.find((entry) => entry.question === "family");
    expect(call?.images.map((image) => image.kind)).toEqual(["capture", ...Array<string>(5).fill("component")]);
    expect(validateWithSchema("judge-plan", result)).toEqual([]);
  });

  it("asks change-<story> per changed story and theme, with baseline, capture and diff", () => {
    const changed = [
      { story: "button--label--variant-ghost--size-md--default", theme: "dark" },
      { story: "button--label--variant-primary--size-sm--default", theme: "light" },
    ];
    const result = plan("button", { changed });
    const calls = result.calls.filter((call) => call.question.startsWith("change-"));
    expect(calls.map((call) => `${call.question} ${call.theme}`)).toEqual([
      "change-button--label--variant-primary--size-sm--default light",
      "change-button--label--variant-ghost--size-md--default dark",
    ]);
    expect(calls[0]?.images.map((image) => image.kind)).toEqual(["baseline", "capture", "diff"]);
    expect(validateWithSchema("judge-plan", result)).toEqual([]);
  });
});

describe("in CI, the stories the judge sees", () => {
  it("narrow each questions to them and keep only the compare calls that show one", () => {
    const hover = "button--label--variant-primary--size-md--hover";
    const result = plan("button", { stories: new Set([hover]) });
    expect(questions(result)).toEqual(["story light", "state-hover light"]);
    expect(result.calls[0]?.images.map((image) => image.story)).toEqual([hover]);
    expect(result.calls[1]?.images).toHaveLength(2);
  });

  it("give an empty plan when none of them is the component's", () => {
    expect(plan("button", { stories: new Set() }).calls).toEqual([]);
  });
});

describe("appearanceStatements", () => {
  it("reads the list items of the Appearance section, joining continuation lines", () => {
    const body = [
      "## Purpose",
      "",
      "- not this one",
      "",
      "## Appearance",
      "",
      "- First statement,",
      "  continued.",
      "* Second.",
      "1. Third.",
      "",
      "```text",
      "- inside a fence",
      "```",
      "",
      "## Never",
      "",
      "- not this one either",
    ].join("\n");
    expect(appearanceStatements(body)).toEqual(["First statement, continued.", "Second.", "Third."]);
  });

  it("gives none without the section", () => {
    expect(appearanceStatements("## Purpose\n\nText.\n")).toEqual([]);
  });
});
