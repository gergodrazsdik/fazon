// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Spec } from "../spec/types.js";
import { buildManifest } from "./build.js";
import { storybookId, storybookSanitize, storybookStoryNameFromExport, storyExportName, storyName } from "./names.js";

describe("story names", () => {
  it("are the component, the fixture, every axis and the state, in kebab-case", () => {
    expect(storyName("Button", "label", { variant: "primary", size: "md" }, { name: "hover" })).toBe(
      "button--label--variant-primary--size-md--hover",
    );
    expect(storyName("Tabs", "three", { orientation: "horizontal" }, { name: "focus-visible", part: "Trigger" })).toBe(
      "tabs--three--orientation-horizontal--trigger-focus-visible",
    );
    expect(storyName("RadioGroup", "options", { "OptionItem.iconSize": "sm", dense: true }, { name: "default" })).toBe(
      "radio-group--options--option-item-icon-size-sm--dense-true--default",
    );
    expect(storyName("Chip", "text", {}, { name: "default" })).toBe("chip--text--default");
  });

  it("give the export name in PascalCase, without the component", () => {
    expect(storyExportName("Button", "button--label--variant-primary--size-md--hover")).toBe(
      "LabelVariantPrimarySizeMdHover",
    );
    expect(storyExportName("RadioGroup", "radio-group--options--size-2xl--default")).toBe("OptionsSize2xlDefault");
  });
});

describe("Storybook IDs", () => {
  it("are what Storybook derives from the title and the export name", () => {
    expect(storybookId("Button", "button--label--variant-primary--size-md--hover")).toBe(
      "button--label-variant-primary-size-md-hover",
    );
    expect(storybookId("Dialog", "dialog--confirm--content-size-md--close-focus-visible")).toBe(
      "dialog--confirm-content-size-md-close-focus-visible",
    );
  });

  it("sanitize the title as Storybook does, without splitting words", () => {
    expect(storybookId("RadioGroup", "radio-group--options--default")).toBe("radiogroup--options-default");
  });

  it("split letters from digits as Storybook's start case does", () => {
    expect(storybookId("Heading", "heading--text--level-h2--size-2xl--default")).toBe(
      "heading--text-level-h-2-size-2-xl-default",
    );
  });

  it("follow Storybook's helpers", () => {
    expect(storybookSanitize("Hello, World / Again!")).toBe("hello-world-again");
    expect(storybookSanitize("--a__b--")).toBe("a-b");
    expect(storybookStoryNameFromExport("simpleStory")).toBe("Simple Story");
    expect(storybookStoryNameFromExport("LabelVariantPrimary")).toBe("Label Variant Primary");
    expect(storybookStoryNameFromExport("XYDefault")).toBe("XY Default");
    expect(storybookStoryNameFromExport("with_underscore-and.dot")).toBe("With Underscore And Dot");
  });
});

describe("name stability", () => {
  const base: Spec = {
    fazon: 0,
    name: "Badge",
    tier: "primitive",
    summary: "A count.",
    props: {
      tone: { type: "enum", values: ["neutral", "danger"], default: "neutral" },
      dot: { type: "boolean", default: false },
    },
    states: ["hover"],
    fixtures: { one: { slots: { default: "1" } }, many: { slots: { default: "99+" } } },
    matrix: { axes: ["tone", "dot"], fixtures: ["one", "many"] },
  };
  const names = (spec: Spec) =>
    buildManifest(spec, { file: "specs/badge.md", themes: ["light", "dark"] }).stories.map((story) => story.name);
  const before = names(base);

  it("don't change when the spec changes outside the matrix's names", () => {
    const changed: Spec = {
      ...base,
      summary: "A number on another element.",
      props: {
        tone: { type: "enum", values: ["neutral", "danger"], default: "neutral", description: "Colour." },
        dot: { type: "boolean", default: false },
        max: { type: "number", default: 99 },
      },
      fixtures: {
        one: { slots: { default: "One" }, frame: { width: 40 }, description: "A single digit." },
        many: { slots: { default: "1000" } },
        unused: { slots: { default: "Not rendered" } },
      },
      tokens: [{ use: { color: "color.text.primary" } }],
      judge: [{ id: "legible", question: "Is the count legible?" }],
      exemptions: [{ check: "layout", rule: "overflow", reason: "By design." }],
      extensions: { vue: { reason: "None." } },
    };
    expect(new Set(names(changed))).toEqual(new Set(before));
  });

  it("keep the existing names when a value, a state or a fixture is added", () => {
    const grown: Spec = {
      ...base,
      props: { ...base.props, tone: { type: "enum", values: ["neutral", "danger", "info"], default: "neutral" } },
      states: ["hover", "focus-visible"],
      fixtures: { ...base.fixtures, empty: {} },
      matrix: { ...base.matrix, fixtures: ["one", "many", "empty"] },
    };
    expect(names(grown)).toEqual(expect.arrayContaining(before));
  });

  it("change every name when an axis is added", () => {
    const withAxis: Spec = { ...base, matrix: { ...base.matrix, axes: ["tone", "dot", "tone2"] } };
    const props = { ...base.props, tone2: { type: "enum" as const, values: ["a"] } };
    const after = names({ ...withAxis, props });
    expect(after.filter((name) => before.includes(name))).toEqual([]);
  });
});
