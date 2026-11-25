// SPDX-License-Identifier: GPL-3.0-or-later
import { customPropertyName, mixesReference, referencedPath, referencesOf, tokenKind } from "./reference.js";
import { tokensOfTheme } from "./resolve.js";
import type { TokenDefinition, TokenFinding, TokenSet } from "./types.js";

/** The role tokens the story frame's base styles take (docs/spec/tokens.md#base-styles). */
export const baseStyleRoles = [
  "color.surface.base",
  "color.text.primary",
  "font-family.body",
  "font-size.body",
  "font-weight.body",
  "line-height.body",
] as const;

/** Collects findings, dropping exact repeats (a rule checked in each theme finds the same thing in each). */
class Findings {
  readonly #seen = new Set<string>();
  readonly list: TokenFinding[] = [];
  add(finding: TokenFinding): void {
    const key = `${finding.rule}\0${finding.path}\0${finding.message}\0${finding.file ?? ""}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.list.push(finding);
  }
}

function where(token: TokenDefinition): { file: string } {
  return { file: token.file };
}

function themesNote(themes: readonly string[], all: readonly string[]): string {
  return themes.length === all.length ? "" : ` in theme ${themes.join(", ")}`;
}

/**
 * TOKEN-002: every reference resolves, to a token of the same `$type`, without a cycle; a shadow
 * layer's references resolve to a colour or a dimension. Checked in every theme.
 */
export function checkReferences(tokenSet: TokenSet): TokenFinding[] {
  const findings = new Findings();
  for (const theme of tokenSet.themes) {
    const tokens = tokensOfTheme(tokenSet, theme);
    const note = tokenSet.themes.length > 1 ? ` in theme ${theme}` : "";
    for (const token of tokens.values()) {
      for (const { target, expectedType } of referencesOf(token)) {
        const found = tokens.get(target);
        if (found === undefined) {
          const group = [...tokens.keys()].some((p) => p.startsWith(`${target}.`));
          findings.add({
            rule: "TOKEN-002",
            path: token.path,
            message: `${token.path} references {${target}}, which ${group ? "is a group, not a token" : "does not exist"}${note}.`,
            ...where(token),
          });
        } else if (expectedType === undefined) {
          findings.add({
            rule: "TOKEN-002",
            path: token.path,
            message: `${token.path} has a reference to {${target}} where the format allows none.`,
            ...where(token),
          });
        } else if (found.type !== expectedType) {
          findings.add({
            rule: "TOKEN-002",
            path: token.path,
            message: `${token.path} needs a ${expectedType} but references {${target}}, a ${found.type}${note}.`,
            ...where(token),
          });
        }
      }
    }
    for (const cycle of referenceCycles(tokens)) {
      const first = cycle[0];
      const token = first === undefined ? undefined : tokens.get(first);
      if (token === undefined) continue;
      findings.add({
        rule: "TOKEN-002",
        path: token.path,
        message: `${token.path} references itself through ${[...cycle, token.path].join(" -> ")}${note}.`,
        ...where(token),
      });
    }
  }
  return findings.list;
}

/** The cycles among single-reference values, each from its smallest path. */
function referenceCycles(tokens: ReadonlyMap<string, TokenDefinition>): string[][] {
  const cycles = new Map<string, string[]>();
  const done = new Set<string>();
  for (const start of tokens.keys()) {
    const chain: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && !done.has(current)) {
      const at = chain.indexOf(current);
      if (at >= 0) {
        const cycle = chain.slice(at);
        const smallest = [...cycle].sort()[0] ?? current;
        const from = cycle.indexOf(smallest);
        const rotated = [...cycle.slice(from), ...cycle.slice(0, from)];
        cycles.set(rotated.join("\0"), rotated);
        break;
      }
      chain.push(current);
      const token = tokens.get(current);
      current = token === undefined ? undefined : referencedPath(token.value);
    }
    for (const path of chain) done.add(path);
  }
  return [...cycles.values()];
}

/**
 * TOKEN-003: a raw token's value is no single reference and a role token's value is one, so a
 * value is either a literal or exactly one reference; a raw token references only raw tokens.
 */
export function checkRawAndRole(tokenSet: TokenSet): TokenFinding[] {
  const findings = new Findings();
  for (const theme of tokenSet.themes) {
    const tokens = tokensOfTheme(tokenSet, theme);
    for (const token of tokens.values()) {
      if (mixesReference(token.value)) {
        findings.add({
          rule: "TOKEN-003",
          path: token.path,
          message: `${token.path}'s value is neither a literal nor a single reference.`,
          ...where(token),
        });
      }
      if (tokenKind(token) !== "raw") continue;
      for (const { target } of referencesOf(token)) {
        const found = tokens.get(target);
        if (found !== undefined && tokenKind(found) === "role") {
          findings.add({
            rule: "TOKEN-003",
            path: token.path,
            message: `The raw token ${token.path} references the role token {${target}}; raw tokens reference only raw tokens.`,
            ...where(token),
          });
        }
      }
    }
  }
  return findings.list;
}

/**
 * TOKEN-004: a path is defined once, in one set or in every theme context; theme contexts define
 * role tokens only, and all of them the same ones. A path is also never both a token and a group.
 */
export function checkPlacement(tokenSet: TokenSet): TokenFinding[] {
  const findings = new Findings();
  const inSets = new Map<string, TokenDefinition>();
  const byTheme = new Map<string, Map<string, TokenDefinition>>(tokenSet.themes.map((t) => [t, new Map()]));

  for (const file of tokenSet.files) {
    for (const token of file.tokens) {
      if (file.source.kind === "set") {
        const earlier = inSets.get(token.path);
        if (earlier === undefined) inSets.set(token.path, token);
        else
          findings.add({
            rule: "TOKEN-004",
            path: token.path,
            message: `${token.path} is defined more than once: in ${earlier.file} and in ${token.file}.`,
            ...where(token),
          });
        continue;
      }
      const theme = file.source.theme;
      const themeTokens = byTheme.get(theme);
      if (themeTokens === undefined) continue;
      const earlier = themeTokens.get(token.path) ?? inSets.get(token.path);
      if (earlier !== undefined) {
        findings.add({
          rule: "TOKEN-004",
          path: token.path,
          message: `${token.path} is defined more than once: in ${earlier.file} and in ${token.file} (theme ${theme}).`,
          ...where(token),
        });
      }
      themeTokens.set(token.path, token);
      if (tokenKind(token) === "raw") {
        findings.add({
          rule: "TOKEN-004",
          path: token.path,
          message: `${token.path} is a raw token in the theme context ${theme}; raw tokens belong in a set.`,
          ...where(token),
        });
      }
    }
  }

  const [first, ...others] = tokenSet.themes;
  const firstTokens = first === undefined ? undefined : byTheme.get(first);
  if (first !== undefined && firstTokens !== undefined) {
    for (const theme of others) {
      const tokens = byTheme.get(theme) ?? new Map<string, TokenDefinition>();
      for (const [path, token] of firstTokens) {
        if (!tokens.has(path))
          findings.add({
            rule: "TOKEN-004",
            path,
            message: `The theme context ${theme} doesn't define ${path}, which ${first} does.`,
            ...where(token),
          });
      }
      for (const [path, token] of tokens) {
        if (!firstTokens.has(path))
          findings.add({
            rule: "TOKEN-004",
            path,
            message: `The theme context ${theme} defines ${path}, which ${first} doesn't.`,
            ...where(token),
          });
      }
    }
  }

  const all = allDefinitions(tokenSet);
  for (const [path, token] of all) {
    const segments = path.split(".");
    for (let i = 1; i < segments.length; i++) {
      const group = segments.slice(0, i).join(".");
      const other = all.get(group);
      if (other !== undefined)
        findings.add({
          rule: "TOKEN-004",
          path: group,
          message: `${group} is both a token (in ${other.file}) and a group (of ${path}, in ${token.file}).`,
          ...where(other),
        });
    }
  }
  return findings.list;
}

/** TOKEN-005: the role tokens of the base styles exist, in every theme. */
export function checkBaseStyles(tokenSet: TokenSet): TokenFinding[] {
  const findings = new Findings();
  const themes = tokenSet.themes.map((theme) => ({ theme, tokens: tokensOfTheme(tokenSet, theme) }));
  for (const path of baseStyleRoles) {
    const missing = themes.filter(({ tokens }) => !tokens.has(path)).map(({ theme }) => theme);
    if (missing.length > 0) {
      findings.add({
        rule: "TOKEN-005",
        path,
        message: `The base style role token ${path} is missing${themesNote(missing, tokenSet.themes)}.`,
      });
    }
    const raw = themes.filter(({ tokens }) => {
      const token = tokens.get(path);
      return token !== undefined && tokenKind(token) === "raw";
    });
    for (const { theme, tokens } of raw) {
      const token = tokens.get(path);
      if (token === undefined) continue;
      findings.add({
        rule: "TOKEN-005",
        path,
        message: `The base style token ${path} is a raw token${themesNote([theme], tokenSet.themes)}; base styles take role tokens.`,
        ...where(token),
      });
    }
  }
  return findings.list;
}

/** TOKEN-006: no two tokens have the same custom property name. */
export function checkCustomPropertyNames(tokenSet: TokenSet): TokenFinding[] {
  const findings = new Findings();
  const byName = new Map<string, TokenDefinition>();
  for (const token of allDefinitions(tokenSet).values()) {
    const name = customPropertyName(token.path);
    const other = byName.get(name);
    if (other === undefined) byName.set(name, token);
    else
      findings.add({
        rule: "TOKEN-006",
        path: token.path,
        message: `${token.path} and ${other.path} have the same custom property name, ${name}.`,
        ...where(token),
      });
  }
  return findings.list;
}

/** Every path any file defines, with its first definition, in resolution order. */
function allDefinitions(tokenSet: TokenSet): Map<string, TokenDefinition> {
  const all = new Map<string, TokenDefinition>();
  for (const file of tokenSet.files)
    for (const token of file.tokens) if (!all.has(token.path)) all.set(token.path, token);
  return all;
}

/** TOKEN-002 to TOKEN-006 on a resolved token set (TOKEN-001 is `resolveTokenSet`'s). */
export function checkTokenSet(tokenSet: TokenSet): TokenFinding[] {
  return [
    ...checkReferences(tokenSet),
    ...checkRawAndRole(tokenSet),
    ...checkPlacement(tokenSet),
    ...checkBaseStyles(tokenSet),
    ...checkCustomPropertyNames(tokenSet),
  ];
}
