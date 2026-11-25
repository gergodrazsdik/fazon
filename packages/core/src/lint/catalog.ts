// SPDX-License-Identifier: GPL-3.0-or-later
// The token set as the lint rules look it up: each custom property's token, and the role tokens
// that could replace a raw value or a raw token.
import type { IndexedToken, TokenIndex } from "../tokens/build.js";

/** Lookups over a token index, built once per index. */
export interface TokenCatalog {
  readonly prefix: string;
  /** The token a custom property names, in any theme. */
  token(name: string): IndexedToken | undefined;
  /** Role tokens of the given types whose value, in the default theme, is this literal. */
  rolesWithValue(types: readonly string[], literal: string): readonly IndexedToken[];
  /** Role tokens of the given types, in the default theme. */
  rolesOfType(types: readonly string[]): readonly IndexedToken[];
  /** Role tokens that reference a token directly, in any theme. */
  rolesReferencing(path: string): readonly IndexedToken[];
}

const catalogs = new WeakMap<TokenIndex, TokenCatalog>();

/** The catalog of a token index; built once per index. */
export function tokenCatalog(index: TokenIndex): TokenCatalog {
  let catalog = catalogs.get(index);
  if (catalog === undefined) {
    catalog = buildCatalog(index);
    catalogs.set(index, catalog);
  }
  return catalog;
}

function buildCatalog(index: TokenIndex): TokenCatalog {
  const themes = [index.defaultTheme, ...index.themes.filter((t) => t !== index.defaultTheme)];
  const byName = new Map<string, IndexedToken>();
  const referencing = new Map<string, Map<string, IndexedToken>>();
  for (const theme of themes) {
    for (const [name, token] of index.byTheme.get(theme) ?? []) {
      if (!byName.has(name)) byName.set(name, token);
      if (token.kind !== "role") continue;
      for (const path of token.references) {
        const roles = referencing.get(path) ?? new Map<string, IndexedToken>();
        roles.set(token.name, token);
        referencing.set(path, roles);
      }
    }
  }
  const defaults = [...(index.byTheme.get(index.defaultTheme)?.values() ?? [])].filter((t) => t.kind === "role");
  return {
    prefix: index.prefix,
    token: (name) => byName.get(name),
    rolesWithValue: (types, literal) => {
      const wanted = normalizeLiteral(literal);
      return defaults.filter((t) => types.includes(t.type) && normalizeLiteral(t.resolvedValue) === wanted);
    },
    rolesOfType: (types) => defaults.filter((t) => types.includes(t.type)),
    rolesReferencing: (path) => [...(referencing.get(path)?.values() ?? [])],
  };
}

const numberWithUnit = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([a-z]*|%)$/;

/**
 * A literal in a form that compares equal to a token's resolved value: lower case, whitespace
 * collapsed, three-digit hex colours expanded, numbers without redundant zeros, seconds as ms.
 */
export function normalizeLiteral(text: string): string {
  const lower = text.trim().toLowerCase().split(/\s+/).join(" ");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(lower);
  if (short !== null) {
    const digits = short.slice(1).map((digit) => digit.repeat(2));
    return `#${digits.join("")}`;
  }
  const match = numberWithUnit.exec(lower);
  if (match === null) return lower;
  const value = Number(match[1]);
  const unit = match[2] ?? "";
  if (unit === "s") return `${String(value * 1000)}ms`;
  return `${String(value)}${unit}`;
}
