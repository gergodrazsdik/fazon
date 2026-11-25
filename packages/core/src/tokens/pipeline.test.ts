// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTokens,
  checkTokenSet,
  customPropertyName,
  hashText,
  hashTokenSet,
  resolveTokenSet,
  tokenCssHeader,
  type ReadTextFile,
  type TokenSet,
} from "../index.js";

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const draftResolver = repo("docs/spec/example-library/tokens/tokens.resolver.json");

async function resolveDraft(readFile?: ReadTextFile): Promise<TokenSet> {
  const { tokenSet, findings } = await resolveTokenSet(draftResolver, readFile === undefined ? {} : { readFile });
  expect(findings).toEqual([]);
  if (tokenSet === undefined) throw new Error("the draft token set did not resolve");
  return tokenSet;
}

/** The custom property declarations of one CSS block, in order. */
function declarations(css: string, selector: string): [string, string][] {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return [];
  const body = css.slice(start, css.indexOf("}", start));
  return [...body.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the draft token set", () => {
  it("resolves its themes, default theme and files in resolution order", async () => {
    const tokenSet = await resolveDraft();
    expect(tokenSet.themes).toEqual(["light", "dark"]);
    expect(tokenSet.defaultTheme).toBe("light");
    expect(tokenSet.files.map((f) => [f.ref, f.source])).toEqual([
      ["raw.json", { kind: "set", set: "raw" }],
      ["roles.json", { kind: "set", set: "roles" }],
      ["themes/light.json", { kind: "theme", theme: "light" }],
      ["themes/dark.json", { kind: "theme", theme: "dark" }],
    ]);
  });

  it("keeps the TOKEN rules", async () => {
    expect(checkTokenSet(await resolveDraft())).toEqual([]);
  });

  it("builds with the prefix fz", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const { css, warnings } = await buildTokens(await resolveDraft(), { prefix: "fz" });
    expect(warnings).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(css.startsWith(tokenCssHeader)).toBe(true);
    expect(css).toMatchSnapshot();
  });

  it("builds with no prefix", async () => {
    const { css, warnings } = await buildTokens(await resolveDraft());
    expect(warnings).toEqual([]);
    expect(css).toMatchSnapshot();
  });

  it("builds the same CSS every time", async () => {
    const tokenSet = await resolveDraft();
    const first = await buildTokens(tokenSet, { prefix: "fz" });
    const second = await buildTokens(tokenSet, { prefix: "fz" });
    expect(second.css).toBe(first.css);
  });

  it("puts every token in :root, then each theme's role tokens in its own block, the default first", async () => {
    const tokenSet = await resolveDraft();
    const { css } = await buildTokens(tokenSet, { prefix: "fz" });
    const names = (paths: Iterable<string>) => [...paths].map((p) => customPropertyName(p, "fz")).sort();
    const pathsOf = (ref: string) => tokenSet.files.find((f) => f.ref === ref)?.tokens.map((t) => t.path) ?? [];
    const all = new Set(
      tokenSet.files.filter((f) => f.ref !== "themes/dark.json").flatMap((f) => f.tokens.map((t) => t.path)),
    );
    expect([...css.matchAll(/^(\S.*) \{$/gm)].map((m) => m[1])).toEqual([
      ":root",
      '[data-theme="light"]',
      '[data-theme="dark"]',
    ]);
    const root = declarations(css, ":root");
    expect(root.map(([name]) => name).sort()).toEqual(names(all));
    const lightBlock = declarations(css, '[data-theme="light"]');
    expect(lightBlock.map(([name]) => name).sort()).toEqual(names(pathsOf("themes/light.json")));
    const darkBlock = declarations(css, '[data-theme="dark"]');
    expect(darkBlock.map(([name]) => name).sort()).toEqual(names(pathsOf("themes/dark.json")));
    expect(root).toContainEqual(["--fz-color-surface-base", "var(--fz-color-neutral-0)"]);
    expect(lightBlock).toContainEqual(["--fz-color-surface-base", "var(--fz-color-neutral-0)"]);
    expect(darkBlock).toContainEqual(["--fz-color-surface-base", "var(--fz-color-neutral-950)"]);
    expect(root).toContainEqual(["--fz-duration-100", "0.1s"]);
  });

  it("indexes each theme's custom properties and the role tokens", async () => {
    const tokenSet = await resolveDraft();
    const { css, index } = await buildTokens(tokenSet, { prefix: "fz" });
    expect(index.themes).toEqual(["light", "dark"]);
    expect(index.defaultTheme).toBe("light");
    const light = index.byTheme.get("light");
    const dark = index.byTheme.get("dark");
    expect(new Set(light?.keys())).toEqual(new Set(declarations(css, ":root").map(([name]) => name)));
    expect(dark?.get("--fz-color-surface-base")).toEqual({
      path: "color.surface.base",
      name: "--fz-color-surface-base",
      kind: "role",
      type: "color",
      references: ["color.neutral.950"],
      resolvedValue: "#121417",
    });
    expect(light?.get("--fz-color-surface-base")?.resolvedValue).toBe("#ffffff");
    expect(light?.get("--fz-shadow-1")).toMatchObject({
      kind: "raw",
      type: "shadow",
      references: ["color.black-alpha.8"],
      resolvedValue: "0px 1px 2px 0px rgba(0, 0, 0, 0.08)",
    });
    const roles = [...(light?.values() ?? [])].filter((t) => t.kind === "role").map((t) => t.path);
    expect([...index.roleTokens].sort()).toEqual(roles.sort());
    expect(index.roleTokens).toContain("color.text.primary");
    expect(index.roleTokens).not.toContain("color.blue.600");
  });
});

describe("hashTokenSet", () => {
  it("hashes the resolver and each file in resolution order", async () => {
    const tokenSet = await resolveDraft();
    const dir = "docs/spec/example-library/tokens/";
    const fileHash = async (path: string) =>
      `sha256:${createHash("sha256")
        .update(await readFile(repo(dir + path)))
        .digest("hex")}`;
    const lines = await Promise.all(
      ["tokens.resolver.json", "raw.json", "roles.json", "themes/light.json", "themes/dark.json"].map(
        async (path) => `${path} ${await fileHash(path)}\n`,
      ),
    );
    const expected = `sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
    expect(hashTokenSet(tokenSet)).toBe(expected);
    expect(hashTokenSet(await resolveDraft())).toBe(expected);
  });

  it("changes when a file changes, and not with line endings", async () => {
    const original = hashTokenSet(await resolveDraft());
    const reading = (change: (file: string, text: string) => string): ReadTextFile => {
      return async (file) => change(file, await readFile(file, "utf8"));
    };
    const edited = await resolveDraft(
      reading((file, text) =>
        file.endsWith("dark.json") ? text.replace("{color.neutral.950}", "{color.neutral.900}") : text,
      ),
    );
    expect(hashTokenSet(edited)).not.toBe(original);
    const crlf = await resolveDraft(reading((_, text) => text.replace(/\n/g, "\r\n")));
    expect(hashTokenSet(crlf)).toBe(original);
  });

  it("normalises line endings in a file's hash", () => {
    expect(hashText("a\r\nb\rc\n")).toBe(hashText("a\nb\nc\n"));
    expect(hashText("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("the tokens check's fixture set", () => {
  it("builds exactly the custom properties pass.html declares", async () => {
    const tokensFile = repo("docs/spec/examples/checks/tokens/tokens.json");
    const resolver = {
      version: "2025.10",
      sets: { all: { sources: [{ $ref: "tokens.json" }] } },
      modifiers: { theme: { contexts: { light: [{ $ref: "light.json" }] }, default: "light" } },
      resolutionOrder: [{ $ref: "#/sets/all" }, { $ref: "#/modifiers/theme" }],
    };
    const files = new Map([
      ["fixture/tokens.resolver.json", JSON.stringify(resolver)],
      ["fixture/tokens.json", await readFile(tokensFile, "utf8")],
      ["fixture/light.json", "{}"],
    ]);
    const { tokenSet, findings } = await resolveTokenSet("fixture/tokens.resolver.json", {
      readFile: (file) => Promise.resolve(files.get(file)),
    });
    expect(findings).toEqual([]);
    if (tokenSet === undefined) throw new Error("the fixture set did not resolve");
    const { css } = await buildTokens(tokenSet);
    const html = await readFile(repo("docs/spec/examples/checks/tokens/pass.html"), "utf8");
    const byName = (list: [string, string][]) => Object.fromEntries(list);
    expect(byName(declarations(css, ":root"))).toEqual(byName(declarations(html, ":root")));
  });
});
