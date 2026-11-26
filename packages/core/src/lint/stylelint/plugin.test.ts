// SPDX-License-Identifier: GPL-3.0-or-later
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";
import { buildTokens, resolveTokenSet, type TokenIndex } from "../../index.js";
import { fazonStylelintPlugins, fazonStylelintRules, stylelintRuleNames, type TokenLintOptions } from "./plugin.js";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const draft: TokenLintOptions = {
  root: repo,
  tokens: "docs/spec/example-library/tokens/tokens.resolver.json",
  prefix: "fz",
};

interface Problem {
  rule: string;
  text: string;
  line: number;
  column: number;
}

async function lint(code: string, options: TokenLintOptions = draft): Promise<Problem[]> {
  const { results } = await stylelint.lint({
    code,
    config: { plugins: [...fazonStylelintPlugins], rules: fazonStylelintRules(options), ignoreDisables: true },
  });
  const [result] = results;
  if (result === undefined) throw new Error("no result");
  expect(result.invalidOptionWarnings).toEqual([]);
  return result.warnings.map((w) => ({ rule: w.rule, text: w.text, line: w.line, column: w.column }));
}

/** The rules a declaration breaks, without messages. */
async function rules(css: string, options?: TokenLintOptions): Promise<string[]> {
  return (await lint(css, options)).map((p) => p.rule.replace("fazon/", ""));
}

describe("the token rules with the example library's draft token set (prefix fz)", () => {
  it("passes role tokens and allowed values", async () => {
    const css = `.button {
  color: var(--fz-color-text-on-action);
  background-color: var(--fz-color-action-primary);
  padding: var(--fz-space-inset-sm) var(--fz-space-inset-md);
  margin: 0;
  border-radius: var(--fz-radius-control);
  border-width: var(--fz-border-width-default);
  border-color: transparent;
  outline-color: currentColor;
  font-family: inherit;
  font-size: var(--fz-font-size-body);
  font-weight: var(--fz-font-weight-medium);
  line-height: normal;
  letter-spacing: normal;
  box-shadow: none;
  gap: 0px;
  transition-duration: var(--fz-motion-duration-fast);
  transition-timing-function: var(--fz-motion-easing-standard);
  width: 120px;
  top: 3px;
  transform: translateX(4px);
}`;
    expect(await lint(css)).toEqual([]);
  });

  it("allows each allowed value", async () => {
    const values = [
      "0",
      "0px",
      "0rem",
      "0ms",
      "auto",
      "none",
      "normal",
      "inherit",
      "initial",
      "unset",
      "revert",
      "currentColor",
      "currentcolor",
      "transparent",
      "100%",
    ];
    expect(await lint(values.map((v, i) => `.a${String(i)} { margin: ${v}; }`).join("\n"))).toEqual([]);
  });

  it("fails a literal (raw-value) and names the role tokens with that value", async () => {
    const problems = await lint(".button { padding: 12px; }");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "fazon/raw-value", line: 1, column: 20 });
    expect(problems[0]?.text).toContain("`12px` in `padding` is a raw value");
    expect(problems[0]?.text).toContain("var(--fz-space-inset-md)");
    expect(problems[0]?.text).toContain("var(--fz-space-gap-md)");
  });

  it("names the role token for a raw colour", async () => {
    const [problem] = await lint(".button { background-color: #2154D9; }");
    expect(problem?.rule).toBe("fazon/raw-value");
    expect(problem?.text).toContain("var(--fz-color-action-primary)");
  });

  it("suggests role tokens of the property's type when no value matches", async () => {
    const [problem] = await lint(".button { background-color: #2050d0; }");
    expect(problem?.rule).toBe("fazon/raw-value");
    expect(problem?.text).toMatch(/such as `var\(--fz-color-[a-z-]+\)`/);
  });

  it("fails literal keywords, colour functions and timing functions", async () => {
    expect(
      await rules(`.a {
  color: red;
  background-color: rgb(0 0 0);
  font-weight: bold;
  font-family: Inter, sans-serif;
  transition-timing-function: ease-in;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
  transition-duration: 150ms;
  border-width: thin;
}`),
    ).toEqual([
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
      "raw-value",
    ]);
  });

  it("fails a raw token's custom property (raw-token) and names the roles that point at it", async () => {
    const problems = await lint(".button { background-color: var(--fz-color-blue-600); }");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "fazon/raw-token", column: 29 });
    expect(problems[0]?.text).toContain("the raw token `color.blue.600`");
    expect(problems[0]?.text).toContain("var(--fz-color-action-primary)");
  });

  it("fails a custom property that is neither a token nor a local one (unknown-token)", async () => {
    const [problem] = await lint(".button { color: var(--brand-ink); }");
    expect(problem?.rule).toBe("fazon/unknown-token");
    expect(problem?.text).toContain("`--brand-ink`");
  });

  it("points at the prefix when a token's property is written without it", async () => {
    const [problem] = await lint(".button { color: var(--color-text-primary); }");
    expect(problem?.rule).toBe("fazon/unknown-token");
    expect(problem?.text).toContain("did you mean `var(--fz-color-text-primary)`");
  });

  it("checks a var() fallback", async () => {
    expect(await rules(".a { color: var(--fz-color-text-primary, #000); }")).toEqual(["raw-value"]);
    expect(await rules(".a { color: var(--fz-color-text-primary, var(--fz-color-text-secondary)); }")).toEqual([]);
  });

  describe("calc(), min(), max() and clamp()", () => {
    it("accepts role tokens, allowed values and unitless numbers as operands", async () => {
      const css = `.a {
  margin: calc(var(--fz-space-inset-sm) * -1);
  padding: calc((var(--fz-space-inset-sm) + var(--fz-space-inset-md)) / 2);
  gap: max(0px, min(var(--fz-space-gap-sm), 100%));
  font-size: clamp(var(--fz-font-size-small), var(--fz-font-size-body), var(--fz-font-size-large));
  margin-top: calc(var(--fz-space-inset-sm)*2);
}`;
      expect(await lint(css)).toEqual([]);
    });

    it("fails a literal operand", async () => {
      expect(await rules(".a { padding: calc(var(--fz-space-inset-sm) + 2px); }")).toEqual(["raw-value"]);
      expect(await rules(".a { padding: calc(2px*3); }")).toEqual(["raw-value"]);
      expect(await rules(".a { margin: min(4px, var(--fz-color-blue-600)); }")).toEqual(["raw-value", "raw-token"]);
    });
  });

  describe("component-local custom properties", () => {
    it("passes a local property set from a role token, also through a chain", async () => {
      const css = `.a {
  --_padding: var(--fz-space-inset-md);
  --_inner: var(--_padding);
  padding: var(--_inner);
}
.a:hover { --_padding: var(--fz-space-inset-lg); }`;
      expect(await lint(css)).toEqual([]);
    });

    it("fails a local property's raw value at the local's declaration", async () => {
      const problems = await lint(`.a {
  --_padding: 12px;
  padding: var(--_padding);
}`);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ rule: "fazon/raw-value", line: 2 });
      expect(problems[0]?.text).toContain("`--_padding`, which `padding` uses");
    });

    it("fails a chain that ends in a raw token", async () => {
      const problems = await lint(`.a {
  --_bg: var(--fz-color-blue-600);
  --_fill: var(--_bg);
  background-color: var(--_fill);
}`);
      expect(problems.map((p) => [p.rule, p.line])).toEqual([["fazon/raw-token", 2]]);
    });

    it("fails a local property that isn't declared (unknown-token)", async () => {
      expect(await rules(".a { color: var(--_ink); }")).toEqual(["unknown-token"]);
    });

    it("doesn't check a local property no token-bound property uses", async () => {
      expect(await lint(".a { --_width: 12px; width: var(--_width); }")).toEqual([]);
    });

    it("stops at a cycle", async () => {
      expect(await lint(".a { --_a: var(--_b); --_b: var(--_a); color: var(--_a); }")).toEqual([]);
    });
  });

  describe("sides, corners, logical forms and shorthands", () => {
    it("checks every side, corner and logical form", async () => {
      const properties = [
        "padding-top",
        "padding-inline",
        "padding-block-start",
        "margin-inline-end",
        "border-top-color",
        "border-inline-start-color",
        "border-bottom-width",
        "border-block-end-width",
        "border-top-left-radius",
        "border-start-end-radius",
        "column-rule-color",
        "row-gap",
      ];
      const css = properties.map((p) => `.a { ${p}: ${p.includes("color") ? "#fff" : "3px"}; }`).join("\n");
      expect(await rules(css)).toEqual(properties.map(() => "raw-value"));
    });

    it("checks the token-bound parts of a shorthand and leaves the others", async () => {
      expect(
        await lint(
          ".a { border: 0 solid transparent; outline: var(--fz-border-width-focus) solid var(--fz-color-focus-ring); }",
        ),
      ).toEqual([]);
      expect(await rules(".a { border: 1px solid #ccc; }")).toEqual(["raw-value", "raw-value"]);
      expect(await rules(".a { border-inline-start: var(--fz-border-width-default) dashed red; }")).toEqual([
        "raw-value",
      ]);
      expect(
        await lint(".a { background: url(x.png) no-repeat center / cover var(--fz-color-surface-base); }"),
      ).toEqual([]);
      expect(await rules(".a { background: #fff; }")).toEqual(["raw-value"]);
      expect(await lint(".a { text-decoration: underline dotted var(--fz-color-text-action); }")).toEqual([]);
      expect(await rules(".a { font: italic 400 16px/1.5 Inter; }")).toEqual([
        "raw-value",
        "raw-value",
        "raw-value",
        "raw-value",
      ]);
      expect(await lint(".a { font: inherit; }")).toEqual([]);
      expect(
        await lint(
          ".a { transition: background-color var(--fz-motion-duration-fast) var(--fz-motion-easing-standard), opacity var(--fz-motion-duration-fast); }",
        ),
      ).toEqual([]);
      expect(await rules(".a { transition: opacity 200ms ease-out; }")).toEqual(["raw-value", "raw-value"]);
      expect(
        await lint(
          ".a { animation: spin var(--fz-motion-duration-slow) var(--fz-motion-easing-standard) 2 alternate; }",
        ),
      ).toEqual([]);
      expect(await rules(".a { animation: spin var(--fz-motion-duration-slow) linear(0, 1) infinite; }")).toEqual([
        "raw-value",
      ]);
      expect(await rules(".a { animation: spin 1s infinite; }")).toEqual(["raw-value"]);
      expect(await lint(".a { box-shadow: inset var(--fz-shadow-raised); }")).toEqual([]);
      expect(await rules(".a { box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.5); }")).toEqual(["raw-value", "raw-value"]);
      expect(await lint(".a { column-rule: 1px solid var(--fz-color-border-default); }")).toEqual([]);
    });

    it("ignores vendor prefixes, custom properties and @font-face descriptors", async () => {
      expect(await rules(".a { -webkit-padding-start: 3px; }")).toEqual([]);
      expect(await rules(".a { -webkit-box-shadow: 0 0 2px red; }")).toEqual(["raw-value", "raw-value"]);
      expect(await lint(".a { --fz-color-local: #fff; }")).toEqual([]);
      expect(await lint('@font-face { font-family: "Inter"; font-weight: 400; }')).toEqual([]);
    });
  });

  it("reads the resolver and prefix from fazon.yaml", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fazon-lint-"));
    try {
      await cp(`${repo}docs/spec/example-library/tokens`, path.join(root, "design/tokens"), { recursive: true });
      const config = await readFile(`${repo}docs/spec/examples/config/minimal/fazon.yaml`, "utf8");
      await writeFile(
        path.join(root, "fazon.yaml"),
        `${config}paths:\n  tokens: design/tokens/tokens.resolver.json\ntokens:\n  prefix: ds\n`,
      );
      expect(await rules(".a { color: var(--ds-color-text-primary); padding: var(--ds-space-3); }", { root })).toEqual([
        "raw-token",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects without a fazon.yaml", async () => {
    await expect(lint(".a { color: red; }", { root: path.join(repo, "docs") })).rejects.toThrow(/fazon\.yaml/);
  });

  it("takes a prebuilt index", async () => {
    const index = await draftIndex("");
    expect(
      await rules(".a { color: var(--color-text-primary); background-color: var(--color-blue-600); }", { index }),
    ).toEqual(["raw-token"]);
  });

  it("works without a prefix", async () => {
    const noPrefix = { ...draft, prefix: "" };
    expect(await rules(".a { color: var(--color-text-primary); }", noPrefix)).toEqual([]);
    expect(await rules(".a { color: var(--fz-color-text-primary); }", noPrefix)).toEqual(["unknown-token"]);
  });

  it("rejects when the token set can't be read", async () => {
    await expect(
      lint(".a { color: red; }", { root: repo, tokens: "does/not/exist.json", prefix: "" }),
    ).rejects.toThrow();
  });

  it("checks long values in linear time", async () => {
    const long = `.a { padding: ${"1".repeat(100_000)}x; margin: calc(${"1".repeat(100_000)}.x); }`;
    const started = performance.now();
    expect(await rules(long)).toEqual(["raw-value", "raw-value"]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("the inline-suppression rule", () => {
  it("fails stylelint-disable comments, which ignoreDisables makes ineffective", async () => {
    const css = `/* stylelint-disable */
.a { color: red; }
/* stylelint-enable */
.b { color: red; } /* stylelint-disable-line */
/* stylelint-disable-next-line fazon/raw-value */
.c { color: blue; }
/* a comment about stylelint-disable */`;
    const problems = (await lint(css)).sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
    expect(problems.map((p) => [p.rule, p.line])).toEqual([
      ["fazon/inline-suppression", 1],
      ["fazon/raw-value", 2],
      ["fazon/inline-suppression", 3],
      ["fazon/inline-suppression", 4],
      ["fazon/raw-value", 4],
      ["fazon/inline-suppression", 5],
      ["fazon/raw-value", 6],
    ]);
    expect(problems[0]?.text).toContain("`stylelint-disable`");
  });

  it("is on in fazonStylelintRules", () => {
    expect(fazonStylelintRules()).toEqual({
      [stylelintRuleNames["raw-value"]]: true,
      [stylelintRuleNames["raw-token"]]: true,
      [stylelintRuleNames["unknown-token"]]: true,
      [stylelintRuleNames["inline-suppression"]]: true,
    });
  });
});

/** The tokens check's fixture set (docs/spec/examples/checks/tokens/tokens.json), no prefix. */
async function fixtureIndex(): Promise<TokenIndex> {
  const resolver = {
    version: "2025.10",
    sets: { all: { sources: [{ $ref: "tokens.json" }] } },
    modifiers: {
      theme: { contexts: { light: [{ $ref: "light.json" }], dark: [{ $ref: "dark.json" }] }, default: "light" },
    },
    resolutionOrder: [{ $ref: "#/sets/all" }, { $ref: "#/modifiers/theme" }],
  };
  const files = new Map([
    ["fixture/tokens.resolver.json", JSON.stringify(resolver)],
    ["fixture/tokens.json", await readFile(`${repo}docs/spec/examples/checks/tokens/tokens.json`, "utf8")],
    ["fixture/light.json", "{}"],
    ["fixture/dark.json", "{}"],
  ]);
  const { tokenSet } = await resolveTokenSet("fixture/tokens.resolver.json", {
    readFile: (file) => Promise.resolve(files.get(file)),
  });
  if (tokenSet === undefined) throw new Error("the fixture set did not resolve");
  return (await buildTokens(tokenSet)).index;
}

async function draftIndex(prefix: string): Promise<TokenIndex> {
  const { tokenSet } = await resolveTokenSet(`${repo}docs/spec/example-library/tokens/tokens.resolver.json`);
  if (tokenSet === undefined) throw new Error("the draft set did not resolve");
  return (await buildTokens(tokenSet, { prefix })).index;
}

/** The component's own rules of a fixture page: those for `.button`, without the frame and the token CSS. */
async function componentStyles(page: string): Promise<string> {
  const html = await readFile(`${repo}docs/spec/examples/checks/tokens/${page}`, "utf8");
  const css = /<style>([^<]*)<\/style>/.exec(html)?.[1] ?? "";
  const root = postcss.parse(css);
  root.each((node) => {
    if (node.type !== "rule" || !node.selector.startsWith(".button")) node.remove();
  });
  return root.toString();
}

describe("the tokens check's fixtures, as CSS", () => {
  it("passes pass.html's component styles", async () => {
    const css = await componentStyles("pass.html");
    expect(css).toContain("background-color: var(--color-action-primary)");
    expect(await lint(css, { index: await fixtureIndex() })).toEqual([]);
  });

  it("fails fail.html's component styles with raw-token", async () => {
    const problems = await lint(await componentStyles("fail.html"), { index: await fixtureIndex() });
    expect(problems.map((p) => p.rule)).toEqual(["fazon/raw-token"]);
    expect(problems[0]?.text).toContain("`--color-blue-600`");
  });
});
