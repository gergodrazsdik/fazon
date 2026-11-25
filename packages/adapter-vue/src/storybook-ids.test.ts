// SPDX-License-Identifier: GPL-3.0-or-later
// The core derives each story's Storybook ID itself (docs/spec/story-matrix.md#names), with a port
// of Storybook's CSF helpers, so the core needn't depend on Storybook. These tests hold the port to
// the Storybook version the Vue adapter pins (devDependencies), whose indexer gives a story the ID
// `toId(title, storyNameFromExport(exportName))`.
import {
  buildManifest,
  storybookId,
  storybookSanitize,
  storybookStoryNameFromExport,
  storyExportName,
  storyName,
  type Spec,
} from "@fazon/core";
import { sanitize, storyNameFromExport, toId } from "storybook/internal/csf";
import { describe, expect, it } from "vitest";
import { exampleNames, exampleSpec } from "./test-support.js";

/** The ID Storybook gives a story of the generated story file: its title is the component's name. */
function storybooksId(component: string, name: string): string {
  return toId(component, storyNameFromExport(storyExportName(component, name)));
}

describe("Storybook IDs", () => {
  it.each(exampleNames)("of every story of the example %s are Storybook's", (name) => {
    const spec = exampleSpec(name);
    const manifest = buildManifest(spec, { file: `specs/${name}.md`, themes: ["light", "dark"] });
    for (const story of manifest.stories) {
      expect(story.storybookId).toBe(storybooksId(spec.name, story.name));
    }
  });

  it.each([
    ["RadioGroup", storyName("RadioGroup", "options", { size: "md" }, { name: "default" })],
    ["Heading", storyName("Heading", "text", { level: "h2", size: "2xl" }, { name: "default" })],
    [
      "Badge",
      storyName("Badge", "x2", { "Item.iconSize": "x-sm", dense: true }, { name: "focus-visible", part: "Item" }),
    ],
    ["HTMLEditor", storyName("HTMLEditor", "a1b2", {}, { name: "default" })],
    ["Tabs", storyName("Tabs", "abc-123-def", { mode: "s3x" }, { name: "active" })],
  ])("of %s's edge cases are Storybook's", (component, name) => {
    expect(storybookId(component, name)).toBe(storybooksId(component, name));
  });

  it("give a spec's whole matrix the IDs Storybook gives", () => {
    const spec: Spec = {
      fazon: 0,
      name: "RadioGroup",
      tier: "form-control",
      summary: "One option of several.",
      props: {
        size: { type: "enum", values: ["sm", "2xl", "h2", "x-1y"], default: "sm" },
        dense: { type: "boolean", default: false },
      },
      states: ["hover", "focus-visible"],
      fixtures: { "three-options": {}, "x2-y": {} },
      matrix: { axes: ["size", "dense"], fixtures: ["three-options", "x2-y"] },
    };
    const manifest = buildManifest(spec, { file: "specs/radio-group.md", themes: ["light"] });
    expect(manifest.stories.length).toBeGreaterThan(8);
    for (const story of manifest.stories) {
      expect(story.storybookId).toBe(storybooksId(spec.name, story.name));
    }
  });
});

describe("the core's ports of Storybook's helpers", () => {
  const samples = [
    "Button",
    "RadioGroup",
    "LabelVariantPrimarySizeMdHover",
    "OptionsSize2xlDefault",
    "TextLevelH2Size2xlDefault",
    "XYDefault",
    "ABCDef",
    "a1B2c3",
    "with_underscore-and.dot",
    "Hello, World / Again!",
    "--a__b--",
    "Ünïcode Name",
    "x2Y",
    "H2",
    "2xl",
  ];

  it.each(samples)("sanitize %j as Storybook does", (text) => {
    expect(storybookSanitize(text)).toBe(sanitize(text));
  });

  it.each(samples)("start-case %j as Storybook does", (text) => {
    expect(storybookStoryNameFromExport(text)).toBe(storyNameFromExport(text));
  });
});
