// SPDX-License-Identifier: GPL-3.0-or-later
// The M0 worked examples: each valid example spec gives exactly its committed manifest, and the
// story counts in docs/spec/story-matrix.md#counts come out right.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSpecFile } from "../spec/load.js";
import type { Spec } from "../spec/types.js";
import { validateWithSchema } from "../validation/validate.js";
import { buildManifest } from "./build.js";
import { checkManifest } from "./rules.js";
import type { StoryManifest } from "./types.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const themes = ["light", "dark"];

function exampleSpec(name: string): Spec {
  const text = readFileSync(new URL(`examples/specs/valid/${name}.md`, docs), "utf8");
  const file = parseSpecFile(`specs/${name}.md`, text);
  if (file.spec === undefined) {
    throw new Error(`the example ${name} doesn't pass SPEC-001`);
  }
  return file.spec;
}

function exampleManifest(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`examples/manifests/${name}.json`, docs), "utf8"));
}

function build(name: string): StoryManifest {
  return buildManifest(exampleSpec(name), { file: `specs/${name}.md`, themes });
}

describe("the example manifests", () => {
  it.each(["button", "tabs", "dialog"])("%s.md gives %s.json", (name) => {
    const manifest = build(name);
    expect(manifest).toStrictEqual(exampleManifest(name));
    // The same JSON, key order included, as `fazon sync` would write it.
    expect(JSON.stringify(manifest, null, 2)).toBe(JSON.stringify(exampleManifest(name), null, 2));
    expect(validateWithSchema("story-manifest", manifest)).toEqual([]);
    expect(checkManifest(manifest, `components/${name}/generated/${name}.stories.json`)).toEqual([]);
  });
});

describe("the counts table in story-matrix.md", () => {
  const text = readFileSync(new URL("story-matrix.md", docs), "utf8");
  const section = /^### Counts\n([\s\S]*?)\n## /m.exec(text)?.[1] ?? "";
  const rows = [...section.matchAll(/^\| \[(\w+)\]\(examples\/specs\/valid\/([a-z-]+)\.md\)[^|]*\|(.*)\|$/gm)].map(
    ([, component, name, cells]) => ({
      component,
      name: name ?? "",
      counts: (cells ?? "").split("|").map((cell) => Number(cell.trim())),
    }),
  );

  it("has a row for each example", () => {
    expect(rows.map((row) => row.name)).toEqual(["button", "tabs", "dialog"]);
  });

  it.each(rows)("$component: $counts", ({ name, counts }) => {
    const { stories, themes: all } = build(name);
    const grid = (which: string) => stories.filter((story) => story.grid === which).length;
    expect([
      grid("axes"),
      grid("states"),
      grid("fixtures"),
      stories.length,
      stories.length * all.length,
      stories.reduce((sum, story) => sum + story.judge.length, 0),
    ]).toEqual(counts);
  });
});
