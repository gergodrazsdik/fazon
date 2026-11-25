// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import {
  buildTokens,
  checkBaseStyles,
  checkCustomPropertyNames,
  checkPlacement,
  checkRawAndRole,
  checkReferences,
  checkTokenSet,
  resolveTokenSet,
  TokenSetError,
  type ReadTextFile,
  type ResolveTokenSetOptions,
  type TokenFinding,
  type TokenSet,
} from "../index.js";
import { isExpectedFilterWarning } from "./build.js";

type Tree = Record<string, unknown>;

const color = (hex: string) => ({
  $type: "color",
  $value: {
    colorSpace: "srgb",
    components: [1, 2, 3].map((i) => parseInt(hex.slice(2 * i - 1, 2 * i + 1), 16) / 255),
    hex,
  },
});
const dimension = (value: number) => ({ $type: "dimension", $value: { value, unit: "px" } });
const ref = ($type: string, path: string) => ({ $type, $value: `{${path}}` });

/** A minimal token set that keeps every rule: raw tokens, theme-independent roles, two themes. */
function minimalFiles(): Record<string, unknown> {
  return {
    "tokens.resolver.json": {
      version: "2025.10",
      sets: { raw: { sources: [{ $ref: "raw.json" }] }, roles: { sources: [{ $ref: "roles.json" }] } },
      modifiers: {
        theme: {
          contexts: { light: [{ $ref: "themes/light.json" }], dark: [{ $ref: "themes/dark.json" }] },
          default: "light",
        },
      },
      resolutionOrder: [{ $ref: "#/sets/raw" }, { $ref: "#/sets/roles" }, { $ref: "#/modifiers/theme" }],
    },
    "raw.json": {
      color: { white: color("#ffffff"), black: color("#000000") },
      size: { 2: dimension(14) },
      "font-family": { sans: { $type: "fontFamily", $value: ["Inter", "sans-serif"] } },
      "font-weight": { 400: { $type: "fontWeight", $value: 400 } },
      "line-height": { 2: { $type: "number", $value: 1.5 } },
      shadow: {
        1: {
          $type: "shadow",
          $value: {
            color: "{color.black}",
            offsetX: "{size.2}",
            offsetY: dimension(1).$value,
            blur: dimension(2).$value,
            spread: dimension(0).$value,
          },
        },
      },
    },
    "roles.json": {
      "font-family": { body: ref("fontFamily", "font-family.sans") },
      "font-size": { body: ref("dimension", "size.2") },
      "font-weight": { body: ref("fontWeight", "font-weight.400") },
      "line-height": { body: ref("number", "line-height.2") },
      elevation: { raised: ref("shadow", "shadow.1") },
    },
    "themes/light.json": {
      color: { surface: { base: ref("color", "color.white") }, text: { primary: ref("color", "color.black") } },
    },
    "themes/dark.json": {
      color: { surface: { base: ref("color", "color.black") }, text: { primary: ref("color", "color.white") } },
    },
  };
}

function reader(files: Record<string, unknown>): ReadTextFile {
  return (file) => {
    const data = files[file.replace(/^set\//, "")];
    return Promise.resolve(data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data));
  };
}

async function resolve(
  edit: (files: Record<string, unknown>) => void = () => undefined,
  options: Omit<ResolveTokenSetOptions, "readFile"> = {},
) {
  const files = minimalFiles();
  edit(files);
  return resolveTokenSet("set/tokens.resolver.json", { ...options, readFile: reader(files) });
}

async function resolved(edit: (files: Record<string, unknown>) => void = () => undefined): Promise<TokenSet> {
  const { tokenSet, findings } = await resolve(edit);
  expect(findings).toEqual([]);
  if (tokenSet === undefined) throw new Error("the token set did not resolve");
  return tokenSet;
}

const tree = (files: Record<string, unknown>, file: string): Tree => files[file] as Tree;
const group = (parent: Tree, name: string): Tree => parent[name] as Tree;
const rules = (findings: readonly TokenFinding[]) => [...new Set(findings.map((f) => f.rule))];

describe("the minimal token set", () => {
  it("keeps every rule and builds", async () => {
    const tokenSet = await resolved();
    expect(checkTokenSet(tokenSet)).toEqual([]);
    const { css, warnings } = await buildTokens(tokenSet);
    expect(warnings).toEqual([]);
    expect(css).toContain("--shadow-1: var(--size-2) 1px 2px 0px var(--color-black);");
    expect(css).toContain('[data-theme="dark"] {\n  --color-surface-base: var(--color-black);');
  });
});

describe("TOKEN-001", () => {
  it("reports a missing resolver document", async () => {
    const { tokenSet, findings } = await resolveTokenSet("nowhere.json", {
      readFile: () => Promise.resolve(undefined),
    });
    expect(tokenSet).toBeUndefined();
    expect(findings).toEqual([
      { rule: "TOKEN-001", path: "", message: "The resolver document does not exist.", file: "nowhere.json" },
    ]);
  });

  it("reports a token file that can't be read", async () => {
    const files = minimalFiles();
    const read = reader(files);
    const { tokenSet, findings } = await resolveTokenSet("set/tokens.resolver.json", {
      readFile: (file) => (file.endsWith("roles.json") ? Promise.reject(new Error("EACCES")) : read(file)),
    });
    expect(tokenSet).toBeUndefined();
    expect(findings).toEqual([
      { rule: "TOKEN-001", path: "", message: "The token file can't be read: EACCES", file: "set/roles.json" },
    ]);
  });

  it("reports a missing token file and invalid JSON", async () => {
    const { tokenSet, findings } = await resolve((files) => {
      delete files["roles.json"];
      files["themes/dark.json"] = "{ not json";
    });
    expect(tokenSet).toBeUndefined();
    expect(findings.map((f) => [f.rule, f.file, f.message.split(":")[0]])).toEqual([
      ["TOKEN-001", "set/roles.json", "The token file does not exist."],
      ["TOKEN-001", "set/themes/dark.json", "The file is not valid JSON"],
    ]);
  });

  it("reports what the resolver document gets wrong beyond its schema", async () => {
    const { findings } = await resolve((files) => {
      const resolver = tree(files, "tokens.resolver.json");
      group(group(resolver, "modifiers"), "theme").default = "sepia";
      resolver.resolutionOrder = [{ $ref: "#/modifiers/theme" }, { $ref: "#/sets/raw" }, { $ref: "#/sets/brand" }];
    });
    expect(findings.map((f) => f.message)).toEqual([
      'The theme modifier\'s default "sepia" is not one of its contexts.',
      "resolutionOrder must name #/modifiers/theme last.",
      "resolutionOrder names #/sets/brand, which is not a set of the resolver document.",
    ]);
  });

  it("refuses a file reference outside the resolver's directory", async () => {
    const { findings } = await resolve((files) => {
      const resolver = tree(files, "tokens.resolver.json");
      group(group(resolver, "sets"), "roles").sources = [{ $ref: "../roles.json" }];
    });
    expect(findings.map((f) => f.message)).toEqual([
      "The file reference ../roles.json must be a relative path inside the resolver's directory.",
    ]);
  });

  it("calls the validation hook for the resolver and each token file", async () => {
    const validate = vi.fn((schema: string, _data: unknown, file: string): TokenFinding[] =>
      file.endsWith("raw.json") ? [{ rule: "TOKEN-001", path: "", message: `not valid against ${schema}`, file }] : [],
    );
    const { tokenSet, findings } = await resolve(() => undefined, { validate });
    expect(validate.mock.calls.map(([schema, , file]) => [schema, file])).toEqual([
      ["token-resolver", "set/tokens.resolver.json"],
      ["tokens", "set/raw.json"],
      ["tokens", "set/roles.json"],
      ["tokens", "set/themes/light.json"],
      ["tokens", "set/themes/dark.json"],
    ]);
    expect(tokenSet).toBeUndefined();
    expect(findings).toEqual([
      { rule: "TOKEN-001", path: "", message: "not valid against tokens", file: "set/raw.json" },
    ]);
  });
});

describe("TOKEN-002", () => {
  it("fails an unresolved reference", async () => {
    const tokenSet = await resolved((files) => {
      group(tree(files, "roles.json"), "font-size").body = ref("dimension", "size.9");
    });
    const findings = checkReferences(tokenSet);
    expect(findings).toEqual([
      {
        rule: "TOKEN-002",
        path: "font-size.body",
        message: "font-size.body references {size.9}, which does not exist in theme light.",
        file: "set/roles.json",
      },
      {
        rule: "TOKEN-002",
        path: "font-size.body",
        message: "font-size.body references {size.9}, which does not exist in theme dark.",
        file: "set/roles.json",
      },
    ]);
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-002"]);
  });

  it("fails a reference to a token of another type", async () => {
    const tokenSet = await resolved((files) => {
      group(tree(files, "roles.json"), "font-size").body = ref("dimension", "line-height.2");
    });
    expect(checkReferences(tokenSet).map((f) => f.message)).toContain(
      "font-size.body needs a dimension but references {line-height.2}, a number in theme light.",
    );
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-002"]);
  });

  it("fails a shadow layer whose colour references a dimension", async () => {
    const tokenSet = await resolved((files) => {
      const shadow = group(group(tree(files, "raw.json"), "shadow"), "1");
      group(shadow, "$value").color = "{size.2}";
    });
    expect(checkReferences(tokenSet).map((f) => f.message)).toContain(
      "shadow.1 needs a color but references {size.2}, a dimension in theme light.",
    );
  });

  it("fails a cycle", async () => {
    const tokenSet = await resolved((files) => {
      const roles = tree(files, "roles.json");
      roles.loop = { a: ref("dimension", "loop.b"), b: ref("dimension", "loop.a") };
    });
    expect(checkReferences(tokenSet).map((f) => f.message)).toEqual([
      "loop.a references itself through loop.a -> loop.b -> loop.a in theme light.",
      "loop.a references itself through loop.a -> loop.b -> loop.a in theme dark.",
    ]);
  });
});

describe("TOKEN-003", () => {
  it("fails a raw token that references a role token", async () => {
    const tokenSet = await resolved((files) => {
      const shadow = group(group(tree(files, "raw.json"), "shadow"), "1");
      group(shadow, "$value").color = "{color.text.primary}";
    });
    expect(checkRawAndRole(tokenSet)).toEqual([
      {
        rule: "TOKEN-003",
        path: "shadow.1",
        message:
          "The raw token shadow.1 references the role token {color.text.primary}; raw tokens reference only raw tokens.",
        file: "set/raw.json",
      },
    ]);
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-003"]);
  });

  it("fails a value that mixes a reference with text", async () => {
    const tokenSet = await resolved((files) => {
      tree(files, "raw.json").gap = { $type: "dimension", $value: "{size.2} * 2" };
    });
    expect(checkRawAndRole(tokenSet).map((f) => f.message)).toEqual([
      "gap's value is neither a literal nor a single reference.",
    ]);
  });
});

describe("TOKEN-004", () => {
  it("fails a role token with a raw token's path", async () => {
    const tokenSet = await resolved((files) => {
      tree(files, "roles.json").color = { white: ref("color", "color.white") };
    });
    expect(checkPlacement(tokenSet)).toEqual([
      {
        rule: "TOKEN-004",
        path: "color.white",
        message: "color.white is defined more than once: in set/raw.json and in set/roles.json.",
        file: "set/roles.json",
      },
    ]);
    // Merged, the role replaces the raw token and references itself.
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-002", "TOKEN-004"]);
  });

  it("fails a raw token in a theme context", async () => {
    const tokenSet = await resolved((files) => {
      for (const theme of ["themes/light.json", "themes/dark.json"])
        group(tree(files, theme), "color").accent = color("#ff0000");
    });
    expect(checkPlacement(tokenSet).map((f) => f.message)).toEqual([
      "color.accent is a raw token in the theme context light; raw tokens belong in a set.",
      "color.accent is a raw token in the theme context dark; raw tokens belong in a set.",
    ]);
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-004"]);
  });

  it("fails theme contexts that define different tokens", async () => {
    const tokenSet = await resolved((files) => {
      group(group(tree(files, "themes/dark.json"), "color"), "surface").raised = ref("color", "color.black");
      delete group(group(tree(files, "themes/dark.json"), "color"), "text").primary;
    });
    expect(checkPlacement(tokenSet).map((f) => f.message)).toEqual([
      "The theme context dark doesn't define color.text.primary, which light does.",
      "The theme context dark defines color.surface.raised, which light doesn't.",
    ]);
  });

  it("fails a role token defined in a set and in a theme", async () => {
    const tokenSet = await resolved((files) => {
      tree(files, "roles.json").color = { surface: { base: ref("color", "color.white") } };
    });
    expect(checkPlacement(tokenSet).map((f) => f.message)).toEqual([
      "color.surface.base is defined more than once: in set/roles.json and in set/themes/light.json (theme light).",
      "color.surface.base is defined more than once: in set/roles.json and in set/themes/dark.json (theme dark).",
    ]);
  });

  it("fails a path that is both a token and a group", async () => {
    const tokenSet = await resolved((files) => {
      tree(files, "roles.json").size = { 2: { large: ref("dimension", "size.2") } };
    });
    expect(checkPlacement(tokenSet).map((f) => f.message)).toEqual([
      "size.2 is both a token (in set/raw.json) and a group (of size.2.large, in set/roles.json).",
    ]);
  });
});

describe("TOKEN-005", () => {
  it("fails a missing base style role", async () => {
    const tokenSet = await resolved((files) => {
      delete tree(files, "roles.json")["line-height"];
    });
    expect(checkBaseStyles(tokenSet)).toEqual([
      {
        rule: "TOKEN-005",
        path: "line-height.body",
        message: "The base style role token line-height.body is missing.",
      },
    ]);
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-005"]);
  });

  it("fails a base style token that is raw", async () => {
    const tokenSet = await resolved((files) => {
      group(tree(files, "roles.json"), "font-size").body = dimension(14);
    });
    expect(checkBaseStyles(tokenSet).map((f) => f.message)).toEqual([
      "The base style token font-size.body is a raw token in theme light; base styles take role tokens.",
      "The base style token font-size.body is a raw token in theme dark; base styles take role tokens.",
    ]);
  });
});

describe("TOKEN-006", () => {
  it("fails two tokens with the same custom property name", async () => {
    const tokenSet = await resolved((files) => {
      const raw = tree(files, "raw.json");
      raw.space = { "a-b": dimension(1) };
      raw["space-a"] = { b: dimension(2) };
    });
    expect(checkCustomPropertyNames(tokenSet)).toEqual([
      {
        rule: "TOKEN-006",
        path: "space-a.b",
        message: "space-a.b and space.a-b have the same custom property name, --space-a-b.",
        file: "set/raw.json",
      },
    ]);
    expect(rules(checkTokenSet(tokenSet))).toEqual(["TOKEN-006"]);
  });
});

describe("buildTokens", () => {
  it("refuses a token set that breaks a rule", async () => {
    const tokenSet = await resolved((files) => {
      delete tree(files, "roles.json")["line-height"];
    });
    await expect(buildTokens(tokenSet)).rejects.toThrow(TokenSetError);
  });

  it("refuses a prefix that isn't kebab-case", async () => {
    await expect(buildTokens(await resolved(), { prefix: "Fz_" })).rejects.toThrow(/kebab-case/);
  });

  it("drops only the filtered-reference warning that lists exactly the expected references", () => {
    const warning = (refs: string[]) =>
      [
        "⚠️ tokens.css",
        "While building tokens.css, filtered out token references were found; output may be unexpected. Ignore this warning if intentional.",
        "Here are the references that are used but not defined in the file:",
        ...refs.map((r) => `    ${r}`),
        "This is caused when combining a filter and `outputReferences`.",
      ].join("\n");
    const expected = new Set(["color.black", "color.white"]);
    expect(isExpectedFilterWarning(warning(["color.white", "color.black"]), expected)).toBe(true);
    expect(isExpectedFilterWarning(warning(["color.white", "color.red"]), expected)).toBe(false);
    expect(isExpectedFilterWarning(warning(["color.white"]), expected)).toBe(false);
    expect(isExpectedFilterWarning("Token collisions detected", expected)).toBe(false);
  });
});
