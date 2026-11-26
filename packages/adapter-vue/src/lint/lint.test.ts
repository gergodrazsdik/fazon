// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { lintFindings, type LintFinding } from "@fazon/core";
import { ESLint } from "eslint";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";
import { lintConfigFiles } from "../index.js";
import { fazonStylelint, fazonVueEslint } from "./index.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtures = fileURLToPath(new URL("../../test-fixtures/lint/", import.meta.url));
const tokenOptions = { root: repo, tokens: "docs/spec/example-library/tokens/tokens.resolver.json", prefix: "fz" };

function eslint(): ESLint {
  return new ESLint({ cwd: fixtures, overrideConfigFile: true, overrideConfig: fazonVueEslint() });
}

/** ESLint and Stylelint on files or on one file's text, as the `lint` check's findings. */
async function lint(input: { files: string[] } | { code: string; filePath: string }): Promise<LintFinding[]> {
  // ESLint reads the scripts and templates, Stylelint the styles, as the self-checks run them.
  const eslintResults =
    "files" in input
      ? await eslint().lintFiles(input.files)
      : /\.(vue|ts)$/.test(input.filePath)
        ? await eslint().lintText(input.code, { filePath: `${fixtures}${input.filePath}` })
        : [];
  const styled = "files" in input ? input.files : [input.filePath].filter((f) => /\.(vue|css)$/.test(f));
  const { results } =
    styled.length === 0
      ? { results: [] }
      : await stylelint.lint({
          ...("files" in input
            ? { files: input.files.map((f) => `${fixtures}${f}`) }
            : { code: input.code, codeFilename: `${fixtures}${input.filePath}` }),
          config: fazonStylelint(tokenOptions),
        });
  const report = lintFindings({ eslint: eslintResults, stylelint: results }, { root: fixtures });
  expect(report.errors).toEqual([]);
  return [...report.findings];
}

const summary = (findings: readonly LintFinding[]) => findings.map((f) => [f.rule, f.line]);

describe("the lint check's fixtures", () => {
  it("passes a component whose styles use only role tokens", async () => {
    expect(await lint({ files: ["pass/LintButton.vue"] })).toEqual([]);
  });

  it("fails `background-color: #2050d0` with raw-value", async () => {
    const findings = await lint({ files: ["fail/LintButton.vue"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: "lint",
      rule: "raw-value",
      file: "fail/LintButton.vue",
      line: 20,
      column: 21,
    });
    expect(findings[0]?.message).toContain("`#2050d0` in `background-color` is a raw value");
  });
});

describe("inline suppressions", () => {
  it("fails every suppression in a single-file component's script, template and styles", async () => {
    const findings = await lint({ files: ["suppressed/SuppressedBox.vue"] });
    expect(summary(findings)).toEqual([
      ["inline-suppression", 3],
      ["eslint", 4],
      ["inline-suppression", 5],
      ["inline-suppression", 10],
      ["eslint", 11],
      ["inline-suppression", 12],
      ["inline-suppression", 17],
      ["raw-value", 19],
    ]);
    expect(findings[1]?.message).toBe("ESLint prefer-const: 'label' is never reassigned. Use 'const' instead.");
    expect(findings[4]?.message).toMatch(/^ESLint vue\/no-v-html: /);
    expect(findings[0]?.message).toContain("`eslint-disable-next-line`");
    expect(findings[5]?.message).toContain("`@vue-ignore`");
  });

  it("fails them in a TypeScript module", async () => {
    const code = [
      "// SPDX-License-Identifier: GPL-3.0-or-later",
      "// @ts-nocheck",
      "/* eslint-disable */",
      "/* eslint prefer-const: off */",
      "// @ts-ignore",
      "export const size: number = 1; // eslint-disable-line",
      "// a comment that mentions eslint-disable",
    ].join("\n");
    expect(summary(await lint({ code, filePath: "use-size.ts" }))).toEqual([
      ["inline-suppression", 2],
      ["inline-suppression", 3],
      ["inline-suppression", 4],
      ["inline-suppression", 5],
      ["inline-suppression", 6],
    ]);
  });

  it("fails them in a stylesheet", async () => {
    const code =
      "/* stylelint-disable fazon/raw-token */\n.box { color: var(--fz-color-blue-600); }\n/* stylelint-enable */\n";
    expect(summary(await lint({ code, filePath: "box.css" }))).toEqual([
      ["inline-suppression", 1],
      ["raw-token", 2],
      ["inline-suppression", 3],
    ]);
  });
});

describe("the token rules in single-file components", () => {
  it("follows a local custom property across the component's style blocks", async () => {
    const code = `<template><div class="tile-box" /></template>
<style>
.tile-box { --_fill: var(--fz-color-surface-raised); --_edge: var(--fz-color-blue-600); }
</style>
<style scoped>
.tile-box { background-color: var(--_fill); border-color: var(--_edge); padding: var(--_gap); }
</style>
`;
    const findings = await lint({ code, filePath: "TileBox.vue" });
    expect(summary(findings)).toEqual([
      ["raw-token", 3],
      ["unknown-token", 6],
    ]);
  });

  it("leaves Vue's scoped-style selectors and v-bind() to the rules they belong to", async () => {
    const code = `<script setup lang="ts">
const tint = "red";
</script>
<template><div class="tint-box" /></template>
<style scoped>
.tint-box :deep(.inner) { color: var(--fz-color-text-primary); }
.tint-box { width: v-bind(tint); color: v-bind(tint); }
</style>
`;
    expect(summary(await lint({ code, filePath: "TintBox.vue" }))).toEqual([["raw-value", 7]]);
  });
});

describe("component names", () => {
  const button = (script: string) => `<script setup lang="ts">
${script}</script>
<template><button type="button"><slot /></button></template>
`;

  it("fail a one-word component, named by its file", async () => {
    const findings = await lint({ code: button(""), filePath: "Button.vue" });
    expect(summary(findings)).toEqual([["eslint", 1]]);
    expect(findings[0]?.message).toContain("vue/multi-word-component-names");
  });

  it("pass the prefixed name the component declares (ADR 0022)", async () => {
    const code = button('defineOptions({ name: "FzButton" });\n');
    expect(await lint({ code, filePath: "Button.vue" })).toEqual([]);
  });
});

describe("what ESLint ignores", () => {
  it("skips build output and the run records under .fazon/, whose Storybook builds aren't source", async () => {
    const lint = eslint();
    for (const ignored of ["dist/a.js", "storybook-static/a.js", "coverage/a.js", ".fazon/runs/x/storybook/a.js"]) {
      expect(await lint.isPathIgnored(ignored), ignored).toBe(true);
    }
    expect(await lint.isPathIgnored("src/a.ts")).toBe(false);
  });
});

describe("the lint configuration files fazon init writes", () => {
  it("call the factories the package's lint subpath exports, without a licence header", async () => {
    const files = lintConfigFiles();
    expect(Object.keys(files)).toEqual(["eslint.config.js", "stylelint.config.js"]);
    expect(files["eslint.config.js"]).toContain('import { fazonVueEslint } from "@fazon/adapter-vue/lint";');
    expect(files["eslint.config.js"]).toContain("export default defineConfig(fazonVueEslint());\n");
    expect(files["stylelint.config.js"]).toContain('import { fazonStylelint } from "@fazon/adapter-vue/lint";');
    expect(files["stylelint.config.js"]).toContain("export default fazonStylelint();\n");
    for (const text of Object.values(files)) expect(text).not.toContain("SPDX-License-Identifier");

    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports["./lint"]).toEqual({ types: "./dist/lint/index.d.ts", default: "./dist/lint/index.js" });
  });
});
