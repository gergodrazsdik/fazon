// SPDX-License-Identifier: GPL-3.0-or-later
// The mutation operators on the Button example with the draft token set, from facts the tests
// build the way the checks' inspection would report them: each story's colours from the spec's
// token rules, and a padding, radius and font weight from role tokens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { element, style } from "../checks/test-support.js";
import { buildManifest } from "../matrix/build.js";
import type { Story } from "../matrix/types.js";
import { parseSpecFile } from "../spec/load.js";
import type { Spec } from "../spec/types.js";
import { indexTokens, type TokenIndex } from "../tokens/build.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import { affectedStories, capturesDiffer } from "./affected.js";
import { storyFacts, type FactDeclaration, type StoryFacts } from "./facts.js";
import { mutationCases, operators, type MutationCase } from "./operators.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const file = parseSpecFile("specs/button.md", readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8"));
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const spec: Spec = file.spec;
const manifest = buildManifest(spec, { file: file.file, themes: ["light", "dark"] });
const root = '[data-part="Button"]';
let index: TokenIndex;

beforeAll(async () => {
  const resolver = fileURLToPath(new URL("example-library/tokens/tokens.resolver.json", docs));
  const { tokenSet } = await resolveTokenSet(resolver);
  if (tokenSet === undefined) throw new Error("the draft token set doesn't resolve");
  index = await indexTokens(tokenSet, { prefix: "fz" });
});

const variable = (path: string) => `var(--fz-${path.replace(/\./g, "-")})`;
const borders = ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"];

/** A story's facts as the inspection would report them: its token rules, later ones winning. */
function factsOf(story: Story): StoryFacts {
  const declared = new Map<string, FactDeclaration>();
  const set = (property: string, value: string, declaredAs = property) => {
    declared.set(property, { property, declaredAs, value });
  };
  for (const rule of spec.tokens ?? []) {
    const props = rule.when?.props ?? {};
    if (Object.entries(props).some(([prop, value]) => story.axes[prop] !== value)) continue;
    if (rule.when?.state !== undefined && rule.when.state !== story.state.name) continue;
    for (const [property, token] of Object.entries(rule.use)) {
      if (property === "border-color") for (const side of borders) set(side, variable(token), "border-color");
      else set(property, variable(token));
    }
  }
  set("padding-top", variable("space.inset.sm"), "padding");
  set("padding-left", variable("space.inset.md"), "padding-inline");
  set("border-top-left-radius", variable("radius.control"), "border-radius");
  set("font-weight", variable("font-weight.medium"));
  return {
    parts: [
      {
        part: "Button",
        instance: 0,
        selector: root,
        declarations: [...declared.values()],
        text: true,
        icons: story.fixture === "with-icon" ? [`${root} > svg`] : [],
        states: story.state.name === "disabled" ? ["disabled"] : [],
      },
    ],
  };
}

function cases(): MutationCase[] {
  return mutationCases({
    spec,
    manifest,
    index,
    facts: (name) => {
      const story = manifest.stories.find((entry) => entry.name === name);
      return story === undefined ? undefined : factsOf(story);
    },
  });
}

function story(name: string): Story {
  const found = manifest.stories.find((entry) => entry.name === `button--${name}`);
  if (found === undefined) throw new Error(`no story button--${name}`);
  return found;
}

function caseOf(id: string): MutationCase {
  const found = cases().find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
}

describe("operators", () => {
  it("are the protocol's twelve, six measurable and six only a viewer sees", () => {
    expect(operators.map((operator) => operator.id)).toEqual([
      "raw-color",
      "low-contrast",
      "clipped-text",
      "target-shrunk",
      "padding-step",
      "focus-ring-removed",
      "emphasis-swapped",
      "variants-collapsed",
      "state-indistinct",
      "state-misleading",
      "icon-misaligned",
      "out-of-family",
    ]);
    expect(operators.filter((operator) => operator.class === "viewer-only")).toHaveLength(6);
  });
});

describe("mutationCases on Button", () => {
  it("applies every operator, once per variant pair, state and part where it can", () => {
    expect(cases().map((entry) => entry.id)).toEqual([
      "raw-color",
      "low-contrast",
      "clipped-text",
      "target-shrunk",
      "padding-step",
      "focus-ring-removed",
      "emphasis-swapped--primary-secondary",
      "variants-collapsed--secondary-as-primary",
      "emphasis-swapped--primary-ghost",
      "variants-collapsed--ghost-as-primary",
      "emphasis-swapped--secondary-ghost",
      "variants-collapsed--ghost-as-secondary",
      "state-indistinct--hover",
      "state-indistinct--focus-visible",
      "state-indistinct--active",
      "state-indistinct--disabled",
      "state-indistinct--loading",
      "state-misleading",
      "icon-misaligned",
      "out-of-family--button",
    ]);
  });

  it("raw-color writes the root's colour tokens as their literal values in the theme", () => {
    const css = caseOf("raw-color").css(story("label--variant-primary--size-md--default"), "light") ?? "";
    const primary = index.byTheme.get("light")?.get("--fz-color-action-primary")?.resolvedValue ?? "?";
    expect(css).toContain(`background-color: ${primary} !important;`);
    expect(css).not.toContain("var(");
  });

  it("low-contrast gives the text the colour of its group closest to the background", () => {
    const css = caseOf("low-contrast").css(story("label--variant-primary--size-md--default"), "light") ?? "";
    expect(css).toMatch(/^\[data-part="Button"\] \{ color: var\(--fz-color-text-[a-z-]+\) !important; \}$/);
    expect(css).not.toContain("on-action");
  });

  it("padding-step moves each padding token one step up its scale, as declared", () => {
    expect(caseOf("padding-step").css(story("label--variant-primary--size-md--default"), "light")).toBe(
      `${root} { padding: var(--fz-space-inset-md) !important; padding-inline: var(--fz-space-inset-lg) !important; }`,
    );
  });

  it("target-shrunk takes only the smallest size, and focus-ring-removed only the focus-visible stories", () => {
    const shrunk = caseOf("target-shrunk");
    expect(shrunk.css(story("label--variant-primary--size-sm--default"), "light")).toContain("padding: 0 !important;");
    expect(shrunk.css(story("label--variant-primary--size-md--default"), "light")).toBeUndefined();
    const ring = caseOf("focus-ring-removed");
    expect(ring.css(story("label--variant-primary--size-md--focus-visible"), "light")).toContain("outline-style: none");
    expect(ring.css(story("label--variant-primary--size-md--default"), "light")).toBeUndefined();
  });

  it("emphasis-swapped gives each of the two variants the other's colours, and leaves the third", () => {
    const swapped = caseOf("emphasis-swapped--primary-secondary");
    const primary = swapped.css(story("label--variant-primary--size-md--default"), "light") ?? "";
    expect(primary).toContain(`background-color: ${variable("color.surface.raised")} !important;`);
    expect(primary).toContain(`border-top-color: ${variable("color.border.default")} !important;`);
    expect(primary).toContain(`color: ${variable("color.text.primary")} !important;`);
    const secondary = swapped.css(story("label--variant-secondary--size-md--default"), "light") ?? "";
    expect(secondary).toContain(`background-color: ${variable("color.action.primary")} !important;`);
    // Primary has no border colour of its own: secondary's goes transparent.
    expect(secondary).toContain("border-top-color: transparent !important;");
    expect(swapped.css(story("label--variant-ghost--size-md--default"), "light")).toBeUndefined();
  });

  it("variants-collapsed gives one variant the other's colours, in the same state", () => {
    const collapsed = caseOf("variants-collapsed--ghost-as-primary");
    expect(collapsed.css(story("label--variant-ghost--size-md--hover"), "light")).toContain(
      `background-color: ${variable("color.action.primary-hover")} !important;`,
    );
    expect(collapsed.css(story("label--variant-primary--size-md--hover"), "light")).toBeUndefined();
  });

  it("state-indistinct gives a state's stories their default story's colours", () => {
    const hover = caseOf("state-indistinct--hover");
    expect(hover.css(story("label--variant-primary--size-md--hover"), "light")).toContain(
      `background-color: ${variable("color.action.primary")} !important;`,
    );
    expect(hover.css(story("label--variant-primary--size-md--default"), "light")).toBeUndefined();
  });

  it("state-misleading styles the disabled stories with the danger colours", () => {
    const css = caseOf("state-misleading").css(story("label--variant-primary--size-md--disabled"), "light") ?? "";
    expect(css).toContain(`background-color: ${variable("color.status.danger.surface")} !important;`);
    expect(css).toContain(`color: ${variable("color.status.danger.text")} !important;`);
  });

  it("icon-misaligned moves only the stories' icons, and out-of-family takes the scales' far ends", () => {
    const icon = caseOf("icon-misaligned");
    expect(icon.css(story("with-icon--variant-primary--size-md--default"), "light")).toMatch(
      /^\[data-part="Button"\] > svg \{ translate: 0 var\(--fz-space-gap-/,
    );
    expect(icon.css(story("label--variant-primary--size-md--default"), "light")).toBeUndefined();
    const family =
      caseOf("out-of-family--button").css(story("label--variant-primary--size-md--default"), "light") ?? "";
    expect(family).toContain("border-radius: var(--fz-radius-");
    expect(family).not.toContain("radius-control");
    expect(family).toContain("font-weight: var(--fz-font-weight-");
    expect(family).not.toContain("font-weight-medium");
  });

  it("gives no CSS for a story without facts", () => {
    const none = mutationCases({ spec, manifest, index, facts: () => undefined });
    expect(
      none.every((entry) => entry.css(story("label--variant-primary--size-md--default"), "light") === undefined),
    ).toBe(true);
  });
});

describe("storyFacts", () => {
  it("reads each part root's winning author declarations, its text and its icons", () => {
    const facts = storyFacts({
      viewport: { width: 1024, height: 768 },
      frame: {
        selector: "[data-fazon-frame]",
        box: { x: 0, y: 0, width: 1, height: 1 },
        contentBox: { x: 0, y: 0, width: 1, height: 1 },
      },
      elements: [
        element({
          styles: {
            matched: [
              style("user-agent", { color: "buttontext" }),
              style("author", {
                "background-color": "var(--fz-color-action-primary)",
                color: "var(--fz-color-text-on-action)",
                gap: "4px",
              }),
            ],
            inherited: [],
          },
        }),
        element({ selector: `${root} > svg`, tag: "svg", partRoot: false, parent: 0 }),
        element({
          selector: `${root} > span`,
          tag: "span",
          partRoot: false,
          parent: 0,
          fonts: { family: "Inter", first: "Inter", faces: [], rendered: [] },
        }),
      ],
    });
    const sorted = facts.parts.map((part) => ({
      ...part,
      declarations: [...part.declarations].sort((a, b) => a.property.localeCompare(b.property)),
    }));
    expect(sorted).toEqual([
      {
        part: "Button",
        instance: 0,
        selector: root,
        declarations: [
          { property: "background-color", declaredAs: "background-color", value: "var(--fz-color-action-primary)" },
          { property: "color", declaredAs: "color", value: "var(--fz-color-text-on-action)" },
        ],
        text: true,
        icons: [`${root} > svg`],
        states: [],
      },
    ]);
  });
});

describe("affectedStories", () => {
  const png = (shade: number) => {
    const image = new PNG({ width: 2, height: 2 });
    image.data.fill(shade);
    return new Uint8Array(PNG.sync.write(image));
  };

  it("takes the story-theme pairs whose capture differs from the unmodified one", () => {
    expect(capturesDiffer(png(1), png(1))).toBe(false);
    const unmodified = [
      { story: "a", theme: "light", png: png(1) },
      { story: "a", theme: "dark", png: png(2) },
      { story: "b", theme: "light", png: png(3) },
    ];
    const mutated = [
      { story: "a", theme: "light", png: png(1) },
      { story: "a", theme: "dark", png: png(9) },
      { story: "b", theme: "light", png: png(3) },
      { story: "c", theme: "light", png: png(4) },
    ];
    expect(affectedStories(unmodified, mutated)).toEqual([
      { story: "a", themes: ["dark"] },
      { story: "c", themes: ["light"] },
    ]);
  });
});
