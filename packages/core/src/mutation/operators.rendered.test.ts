// SPDX-License-Identifier: GPL-3.0-or-later
// The measurable mutation operators in the verifier image's Chromium (`just test-rendered`): on a
// button the checks pass, each operator's CSS, injected after the page loads, fails the check the
// protocol expects to catch it (docs/spec/measurement.md#seeded-defects), and the unmodified page
// passes it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAxe } from "../checks/a11y.js";
import { checkLayout } from "../checks/layout.js";
import { launchRenderer, type RenderedPage, type Renderer } from "../checks/render.js";
import { fixtureTokenIndex } from "../checks/test-support.js";
import { checkTokens } from "../checks/tokens.js";
import type { CheckFinding } from "../checks/types.js";
import { checkVisualStory } from "../checks/visual.js";
import { buildManifest } from "../matrix/build.js";
import type { Story } from "../matrix/types.js";
import { parseSpecFile } from "../spec/load.js";
import type { TokenIndex } from "../tokens/build.js";
import { storyFacts, type StoryFacts } from "./facts.js";
import { mutationCases, type OperatorId } from "./operators.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const page = fileURLToPath(new URL("examples/checks/tokens/pass.html", docs));
const file = parseSpecFile("specs/button.md", readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8"));
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const spec = file.spec;
const manifest = buildManifest(spec, { file: file.file, themes: ["light"] });
let renderer: Renderer;
let index: TokenIndex;

beforeAll(async () => {
  renderer = await launchRenderer();
  index = await fixtureTokenIndex();
});

afterAll(async () => {
  await renderer.close();
});

function story(name: string): Story {
  const found = manifest.stories.find((entry) => entry.name === `button--${name}`);
  if (found === undefined) throw new Error(`no story button--${name}`);
  return found;
}

/** The page's findings of one check, after an optional keyboard focus. */
async function findings(rendered: RenderedPage, check: "a11y" | "tokens" | "layout"): Promise<CheckFinding[]> {
  switch (check) {
    case "a11y":
      return checkAxe(await rendered.axe()).findings;
    case "tokens":
      return checkTokens({ elements: (await rendered.inspect({ accessibility: false })).elements, index });
    case "layout":
      return checkLayout(await rendered.inspect({ styles: false }));
  }
}

/** The CSS an operator's first case gives the story, with the page's own facts. */
function cssOf(operator: OperatorId, target: Story, facts: StoryFacts): string {
  const found = mutationCases({ spec, manifest, index, facts: () => facts }).find(
    (entry) => entry.operator === operator,
  );
  const css = found?.css(target, "light");
  if (css === undefined) throw new Error(`${operator} gives ${target.name} no CSS`);
  return css;
}

async function open(focus = false, pair = false): Promise<{ rendered: RenderedPage; facts: StoryFacts }> {
  const rendered = await renderer.open({ file: page });
  if (focus) {
    await rendered.page.keyboard.press("Tab");
    await rendered.settle();
  }
  const facts = storyFacts(await rendered.inspect({ accessibility: false }));
  if (pair) {
    // A second button under the first, both in one part the checks inspect: an undersized target
    // fails WCAG 2.5.8 only when a 24 px circle centred on it reaches another target, which a
    // wide button's doesn't sideways.
    await rendered.page.evaluate(
      'const button = document.querySelector("[data-part]"); const group = document.createElement("div");' +
        ' group.setAttribute("data-part", "Group"); button.replaceWith(group);' +
        ' group.append(button, document.createElement("br"), button.cloneNode(true));',
    );
    await rendered.settle();
  }
  return { rendered, facts };
}

describe("the measurable operators on a passing button", () => {
  it.each([
    ["raw-color", "tokens", "raw-value", "label--variant-primary--size-md--default"],
    ["low-contrast", "a11y", "color-contrast", "label--variant-primary--size-md--default"],
    ["clipped-text", "layout", "clipped-text", "label--variant-primary--size-md--default"],
    ["target-shrunk", "layout", "target-size", "label--variant-primary--size-sm--default"],
  ] as const)("%s fails %s/%s", async (operator, check, rule, name) => {
    const { rendered, facts } = await open(false, operator === "target-shrunk");
    try {
      expect((await findings(rendered, check)).filter((f) => f.blocking)).toEqual([]);
      await rendered.inject(cssOf(operator, story(name), facts));
      const after = await findings(rendered, check);
      expect(after.map((f) => f.rule)).toContain(rule);
    } finally {
      await rendered.close();
    }
  });

  it.each([
    ["padding-step", "label--variant-primary--size-md--default", false],
    ["focus-ring-removed", "label--variant-primary--size-md--focus-visible", true],
  ] as const)("%s fails visual/changed against the unmodified capture", async (operator, name, focus) => {
    const { rendered, facts } = await open(focus);
    try {
      const baseline = (await rendered.capture()).png;
      await rendered.inject(cssOf(operator, story(name), facts));
      const result = checkVisualStory({ capture: (await rendered.capture()).png, baseline });
      expect(result.finding?.rule).toBe("changed");
    } finally {
      await rendered.close();
    }
  });
});
