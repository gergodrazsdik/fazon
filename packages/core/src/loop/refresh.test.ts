// SPDX-License-Identifier: GPL-3.0-or-later
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../adapter.js";
import { resolveConfig } from "../config/load.js";
import { generatedRefresh, RefreshError, refreshGenerated, refreshScope } from "./refresh.js";

const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const config = resolveConfig({ fazon: 0, adapter: "vue", image, tokens: { prefix: "fz" } }).config;

/** An adapter that writes a story file (which imports the component), an API file, and one export line per component. */
const adapter = {
  id: "fake",
  componentFiles: (spec: { name: string }) => ({
    files: [{ name: spec.name, exportName: spec.name, file: `${spec.name}.vue` }],
    patterns: ["*.vue", "*.ts"],
  }),
  generate: (input: { spec: { name: string } }) =>
    Promise.resolve([
      { name: `${input.spec.name}.stories.ts`, content: `stories of ${input.spec.name}\n`, importsComponent: true },
      { name: "api.json", content: `{ "name": "Fz${input.spec.name}" }\n`, importsComponent: false },
    ]),
  entryFile: (input: { components: readonly { spec: { name: string } }[] }) =>
    Promise.resolve(input.components.map((c) => `export ${c.spec.name}\n`).join("")),
  themesFile: () => Promise.resolve({ path: ".storybook/generated/themes.ts", content: "themes\n" }),
} as unknown as Adapter;

let root: string;
const read = (file: string) => readFile(path.join(root, file), "utf8");
const exists = (file: string) =>
  readFile(path.join(root, file)).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-refresh-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
  for (const name of ["button", "dialog"]) {
    await cp(path.join(docs, `examples/specs/valid/${name}.md`), path.join(root, `specs/${name}.md`));
  }
  await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  // Dialog was generated before, and its generated files are stale; a person runs `fazon sync` for them.
  await mkdir(path.join(root, "src/components/dialog/generated"), { recursive: true });
  await writeFile(path.join(root, "src/components/dialog/Dialog.vue"), "<template />\n");
  await writeFile(path.join(root, "src/components/dialog/generated/api.json"), "stale\n");
  await writeFile(path.join(root, "src/index.ts"), "export Dialog\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the generated-files refresh", () => {
  it("covers the component's generated directory and the entry file only", () => {
    const scope = refreshScope(config, "button");
    expect(scope("src/components/button/generated/api.json")).toBe(true);
    expect(scope("src/index.ts")).toBe(true);
    expect(scope("src/components/button/Button.vue")).toBe(false);
    expect(scope("src/components/button-group/generated/api.json")).toBe(false);
    expect(scope("src/components/dialog/generated/api.json")).toBe(false);
    expect(scope("src/tokens.css")).toBe(false);
    expect(scope(".storybook/generated/themes.ts")).toBe(false);
  });

  it("writes only the data files until the root file exists, then the stories and the export", async () => {
    const first = await refreshGenerated({ root, config, adapter, name: "button" });
    expect(first.ok && first.changes).toEqual([
      { path: "src/components/button/generated/api.json", change: "added" },
      { path: "src/components/button/generated/stories.json", change: "added" },
    ]);
    expect(first.ok && first.pending).toContainEqual({
      component: "button",
      file: "src/components/button/Button.vue",
    });
    expect(await exists("src/components/button/generated/Button.stories.ts")).toBe(false);

    // The agent writes the root file; the refresh before the checks adds the rest.
    await writeFile(path.join(root, "src/components/button/Button.vue"), "<template />\n");
    const second = await refreshGenerated({ root, config, adapter, name: "button" });
    expect(second.ok && second.changes).toEqual([
      { path: "src/components/button/generated/Button.stories.ts", change: "added" },
      { path: "src/index.ts", change: "modified" },
    ]);
    expect(await read("src/index.ts")).toBe("export Button\nexport Dialog\n");

    // Nothing else sync maintains is touched: another component's files, the token CSS, the themes module.
    expect(await read("src/components/dialog/generated/api.json")).toBe("stale\n");
    expect(await exists("src/tokens.css")).toBe(false);
    expect(await exists(".storybook/generated/themes.ts")).toBe(false);

    const third = await refreshGenerated({ root, config, adapter, name: "button" });
    expect(third.ok && third.changes).toEqual([]);
  });

  it("refuses, writing nothing, when a spec breaks a rule; the run's start throws", async () => {
    await writeFile(path.join(root, "specs/button.md"), "no front matter\n");
    const result = await refreshGenerated({ root, config, adapter, name: "button" });
    expect(result.ok).toBe(false);
    await expect(generatedRefresh({ root, config, adapter, name: "button" })()).rejects.toThrow(RefreshError);
    expect(await exists("src/components/button/generated/api.json")).toBe(false);
  });
});
