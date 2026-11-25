// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the checks' tests: inspected elements without a browser, and the token index of the
// check fixtures. Not exported from the package.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTokens, type TokenIndex } from "../tokens/build.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { InspectedElement, StyleProperty, StyleSource } from "./snapshot.js";

export const checkExamples = fileURLToPath(new URL("../../../../docs/spec/examples/checks/", import.meta.url));

/**
 * The token index of the tokens check's fixtures: their tokens.json as the one set of a resolver
 * document whose two themes, `light` (the default) and `dark`, add no tokens of their own.
 */
export async function fixtureTokenIndex(tokensJson = join(checkExamples, "tokens/tokens.json")): Promise<TokenIndex> {
  const dir = dirname(tokensJson);
  const resolver = join(dir, "tokens.resolver.json");
  const files: Record<string, string> = {
    [resolver]: JSON.stringify({
      version: "2025.10",
      sets: { fixtures: { sources: [{ $ref: "tokens.json" }] } },
      modifiers: {
        theme: { contexts: { light: [{ $ref: "light.json" }], dark: [{ $ref: "dark.json" }] }, default: "light" },
      },
      resolutionOrder: [{ $ref: "#/sets/fixtures" }, { $ref: "#/modifiers/theme" }],
    }),
    [join(dir, "light.json")]: "{}",
    [join(dir, "dark.json")]: "{}",
    [join(dir, "tokens.json")]: await readFile(tokensJson, "utf8"),
  };
  const { tokenSet, findings } = await resolveTokenSet(resolver, { readFile: (file) => Promise.resolve(files[file]) });
  if (tokenSet === undefined) throw new Error(`The fixtures' tokens don't resolve: ${JSON.stringify(findings)}`);
  return (await buildTokens(tokenSet)).index;
}

/** An inspected element: a 100 by 40 px box at the origin, with nothing set unless given. */
export function element(overrides: Partial<InspectedElement> = {}): InspectedElement {
  return {
    selector: '[data-part="Button"]',
    tag: "button",
    part: "Button",
    partRoot: true,
    instance: 0,
    inFrame: true,
    box: { x: 16, y: 16, width: 100, height: 40 },
    display: "inline-block",
    visibility: "visible",
    position: "static",
    overflowX: "visible",
    overflowY: "visible",
    textOverflow: "clip",
    lineClamp: "none",
    clientWidth: 100,
    clientHeight: 40,
    scrollWidth: 100,
    scrollHeight: 40,
    textBoxes: [],
    inlineInText: false,
    tabbable: false,
    role: "",
    name: "",
    nameSource: "none",
    description: "",
    labelledBy: [],
    describedBy: [],
    aria: {},
    states: [],
    ...overrides,
  };
}

/** A style source from `name: value` pairs; `!important` and shorthands as the protocol reports them. */
export function style(
  origin: StyleSource["origin"],
  declarations: Readonly<Record<string, string>>,
  extra: { selector?: string; layer?: string; shorthands?: Readonly<Record<string, string>> } = {},
): StyleSource {
  const properties: StyleProperty[] = Object.entries(declarations).map(([name, value]) => {
    const important = value.endsWith("!important");
    const implicit = value === "(implicit)";
    return {
      name,
      value: implicit ? "" : value.replace(/\s*!important$/, ""),
      important,
      implicit,
    };
  });
  return {
    origin,
    ...(extra.selector === undefined ? {} : { selector: extra.selector }),
    ...(extra.layer === undefined ? {} : { layer: extra.layer }),
    properties,
    shorthands: Object.entries(extra.shorthands ?? {}).map(([name, value]) => ({
      name,
      value: value.replace(/\s*!important$/, ""),
      important: value.endsWith("!important"),
    })),
  };
}
