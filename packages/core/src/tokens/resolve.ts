// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "./reference.js";
import type { TokenDefinition, TokenFile, TokenFileSource, TokenFinding, TokenSet } from "./types.js";

/** The schemas a token set is validated against: docs/spec/schemas/<name>.schema.json. */
export type TokenSchemaName = "tokens" | "token-resolver";

/** Reads a text file; resolves to undefined when the file doesn't exist. */
export type ReadTextFile = (file: string) => Promise<string | undefined>;

/** Validates a parsed file against a schema and returns TOKEN-001 findings. */
export type ValidateTokenData = (
  schema: TokenSchemaName,
  data: unknown,
  file: string,
) => readonly TokenFinding[] | Promise<readonly TokenFinding[]>;

export interface ResolveTokenSetOptions {
  /** Reads the resolver document and the token files. Default: the file system, as UTF-8. */
  readonly readFile?: ReadTextFile;
  /** Schema validation (TOKEN-001). */
  readonly validate?: ValidateTokenData;
}

export interface ResolveTokenSetResult {
  /** The resolved token set; undefined when it breaks TOKEN-001. */
  readonly tokenSet: TokenSet | undefined;
  /** TOKEN-001 findings. The other rules run on a resolved set: `checkTokenSet`. */
  readonly findings: readonly TokenFinding[];
}

/** Reads a UTF-8 file from disk; undefined when it doesn't exist. */
export const readTextFile: ReadTextFile = async (file) => {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
};

// TODO(step 2): wire the default to core's schema validator (Ajv, docs/spec/schemas/), which reports
// TOKEN-001 for a resolver document or token file that isn't valid against its schema.
const noValidation: ValidateTokenData = () => [];

const themeRef = "#/modifiers/theme";
const setRef = /^#\/sets\/(.+)$/;

/**
 * Reads a resolver document and the token files it names, and resolves them: the sets in
 * `resolutionOrder`, then each context of the `theme` modifier (docs/spec/tokens.md#files).
 * Checks TOKEN-001; the other rules need the resolved set (`checkTokenSet`).
 */
export async function resolveTokenSet(
  resolverFile: string,
  options: ResolveTokenSetOptions = {},
): Promise<ResolveTokenSetResult> {
  const read = options.readFile ?? readTextFile;
  const validate = options.validate ?? noValidation;
  const findings: TokenFinding[] = [];
  const problem = (message: string, file: string, path = ""): void => {
    findings.push({ rule: "TOKEN-001", path, message, file });
  };

  const resolverText = await read(resolverFile);
  if (resolverText === undefined) {
    problem("The resolver document does not exist.", resolverFile);
    return { tokenSet: undefined, findings };
  }
  const resolver = parseJson(resolverText, resolverFile, problem);
  if (resolver === undefined) return { tokenSet: undefined, findings };
  findings.push(...(await validate("token-resolver", resolver, resolverFile)));

  const layout = readLayout(resolver, resolverFile, problem);
  if (layout === undefined) return { tokenSet: undefined, findings };

  const files: TokenFile[] = [];
  const cache = new Map<string, { text: string; tokens: TokenDefinition[] } | undefined>();
  for (const { ref, source } of layout.refs) {
    if (ref.startsWith("/") || ref.split(/[\\/]/).includes("..")) {
      problem(`The file reference ${ref} must be a relative path inside the resolver's directory.`, resolverFile);
      continue;
    }
    const file = join(dirname(resolverFile), ref);
    if (!cache.has(file)) cache.set(file, await readTokenFile(file, read, validate, findings, problem));
    const entry = cache.get(file);
    if (entry !== undefined) files.push({ ref, file, text: entry.text, source, tokens: entry.tokens });
  }

  if (findings.length > 0) return { tokenSet: undefined, findings };
  return {
    tokenSet: { resolverFile, resolverText, files, themes: layout.themes, defaultTheme: layout.defaultTheme },
    findings,
  };
}

type Problem = (message: string, file: string, path?: string) => void;

function parseJson(text: string, file: string, problem: Problem): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    problem(`The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, file);
    return undefined;
  }
}

interface Layout {
  refs: { ref: string; source: TokenFileSource }[];
  themes: string[];
  defaultTheme: string;
}

/** The parts of the resolver document the pipeline reads, checked as far as it needs them. */
function readLayout(resolver: unknown, file: string, problem: Problem): Layout | undefined {
  if (!isRecord(resolver)) {
    problem("The resolver document is not a JSON object.", file);
    return undefined;
  }
  const sets = isRecord(resolver.sets) ? resolver.sets : {};
  const theme = isRecord(resolver.modifiers) && isRecord(resolver.modifiers.theme) ? resolver.modifiers.theme : {};
  const contexts = isRecord(theme.contexts) ? theme.contexts : undefined;
  const order = Array.isArray(resolver.resolutionOrder) ? resolver.resolutionOrder : undefined;
  if (contexts === undefined) problem("The resolver document has no theme modifier with contexts.", file);
  if (order === undefined) problem("The resolver document has no resolutionOrder.", file);
  if (contexts === undefined || order === undefined) return undefined;

  const themes = Object.keys(contexts);
  const defaultTheme = typeof theme.default === "string" ? theme.default : "";
  if (!themes.includes(defaultTheme)) {
    problem(`The theme modifier's default "${defaultTheme}" is not one of its contexts.`, file);
  }

  const refs: Layout["refs"] = [];
  const sources = (list: unknown, where: string, source: TokenFileSource): void => {
    if (!Array.isArray(list) || list.length === 0) {
      problem(`${where} names no token files.`, file);
      return;
    }
    for (const item of list) {
      const ref = isRecord(item) ? item.$ref : undefined;
      if (typeof ref === "string") refs.push({ ref, source });
      else problem(`${where} has a source without a $ref.`, file);
    }
  };

  let themeSeen = false;
  for (const [index, entry] of (order as unknown[]).entries()) {
    const ref = isRecord(entry) ? entry.$ref : undefined;
    if (typeof ref !== "string") {
      problem(`resolutionOrder[${String(index)}] has no $ref.`, file);
    } else if (ref === themeRef) {
      if (themeSeen) problem(`resolutionOrder names ${themeRef} more than once.`, file);
      else if (index !== order.length - 1) problem(`resolutionOrder must name ${themeRef} last.`, file);
      themeSeen = true;
    } else {
      const name = setRef.exec(ref)?.[1];
      const set = name === undefined ? undefined : sets[name];
      if (name === undefined || !isRecord(set)) {
        problem(`resolutionOrder names ${ref}, which is not a set of the resolver document.`, file);
      } else {
        sources(set.sources, `The set ${name}`, { kind: "set", set: name });
      }
    }
  }
  if (!themeSeen) problem(`resolutionOrder does not name ${themeRef}.`, file);
  for (const name of themes) sources(contexts[name], `The theme context ${name}`, { kind: "theme", theme: name });
  return { refs, themes, defaultTheme };
}

async function readTokenFile(
  file: string,
  read: ReadTextFile,
  validate: ValidateTokenData,
  findings: TokenFinding[],
  problem: Problem,
): Promise<{ text: string; tokens: TokenDefinition[] } | undefined> {
  const text = await read(file);
  if (text === undefined) {
    problem("The token file does not exist.", file);
    return undefined;
  }
  const data = parseJson(text, file, problem);
  if (data === undefined) return undefined;
  findings.push(...(await validate("tokens", data, file)));
  if (!isRecord(data)) {
    problem("The token file is not a JSON object.", file);
    return undefined;
  }
  const tokens: TokenDefinition[] = [];
  const walk = (group: Record<string, unknown>, prefix: string[]): void => {
    for (const [name, node] of Object.entries(group)) {
      if (name.startsWith("$")) continue;
      const path = [...prefix, name].join(".");
      if (isRecord(node) && "$value" in node) {
        if (typeof node.$type === "string") tokens.push({ path, type: node.$type, value: node.$value, file });
        else problem("The token has no $type.", file, path);
      } else if (isRecord(node)) {
        walk(node, [...prefix, name]);
      } else {
        problem("The entry is neither a token nor a group.", file, path);
      }
    }
  };
  walk(data, []);
  return { text, tokens };
}

/** The files that apply in a theme: every set's files, then the theme context's. */
export function filesOfTheme(tokenSet: TokenSet, theme: string): TokenFile[] {
  return tokenSet.files.filter((f) => f.source.kind === "set" || f.source.theme === theme);
}

/** A theme's tokens by path, merged in resolution order: a later definition replaces an earlier one. */
export function tokensOfTheme(tokenSet: TokenSet, theme: string): Map<string, TokenDefinition> {
  const merged = new Map<string, TokenDefinition>();
  for (const file of filesOfTheme(tokenSet, theme)) for (const token of file.tokens) merged.set(token.path, token);
  return merged;
}
