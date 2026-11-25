// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Spec } from "../spec/types.js";
import { buildManifest } from "./build.js";
import { checkManifest, manifestRules, matrixRuleStages } from "./rules.js";
import type { StoryManifest } from "./types.js";

const file = "components/tag/generated/tag.stories.json";

function tag(fixtures: NonNullable<Spec["fixtures"]>): Spec {
  return {
    fazon: 0,
    name: "Tag",
    tier: "primitive",
    summary: "A keyword.",
    fixtures,
    matrix: { fixtures: Object.keys(fixtures) },
  };
}

describe("the MATRIX rules", () => {
  it("list the harness's rules, and leave MATRIX-003 to MATRIX-005 to the verifier", () => {
    expect(manifestRules.map((rule) => rule.id)).toEqual(["MATRIX-001", "MATRIX-002"]);
    expect(manifestRules.every((rule) => matrixRuleStages[rule.id] === "harness")).toBe(true);
    expect(Object.entries(matrixRuleStages).filter(([, stage]) => stage === "verifier")).toHaveLength(3);
  });

  it("find nothing in a manifest the rules wrote", () => {
    const manifest = buildManifest(tag({ short: {}, long: {} }), { file: "specs/tag.md", themes: ["light"] });
    expect(checkManifest(manifest, file)).toEqual([]);
  });
});

describe("MATRIX-001", () => {
  it("reports where the manifest breaks its schema", () => {
    const manifest = buildManifest(tag({ short: {} }), { file: "specs/tag.md", themes: ["light"] });
    const broken = { ...manifest, viewport: { ...manifest.viewport, scale: 0 } } as StoryManifest;
    expect(checkManifest(broken, file)).toEqual([
      expect.objectContaining({ rule: "MATRIX-001", file, path: "$.viewport.scale" }),
    ]);
  });
});

describe("MATRIX-002", () => {
  it("reports two stories whose names differ only in hyphens and capitals, as one Storybook ID", () => {
    const manifest = buildManifest(tag({ "x-y": {}, xy: {} }), { file: "specs/tag.md", themes: ["light"] });
    expect(manifest.stories.map((story) => [story.name, story.storybookId])).toEqual([
      ["tag--x-y--default", "tag--xy-default"],
      ["tag--xy--default", "tag--xy-default"],
    ]);
    expect(checkManifest(manifest, file)).toEqual([
      {
        rule: "MATRIX-002",
        file,
        path: "$.stories[1].storybookId",
        message: "stories 0 and 1 share the storybookId 'tag--xy-default'",
        hint: "Rename a fixture, value or state in the spec so that the names differ by more than hyphens and capitals.",
      },
    ]);
  });

  it("reports a repeated name", () => {
    const manifest = buildManifest(tag({ short: {} }), { file: "specs/tag.md", themes: ["light"] });
    const repeated = { ...manifest, stories: [...manifest.stories, ...manifest.stories] };
    expect(checkManifest(repeated, file).map((finding) => finding.path)).toEqual([
      "$.stories[1].name",
      "$.stories[1].storybookId",
    ]);
  });
});
