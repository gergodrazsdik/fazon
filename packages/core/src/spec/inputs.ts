// SPDX-License-Identifier: GPL-3.0-or-later
// What the SPEC rules need besides the specs: the token set's tokens (SPEC-011), the icon set's
// names (SPEC-009) and the consumer's adapter's extension schema (SPEC-013). The CLI reads them
// and passes the adapter in; the core never imports an adapter.
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Adapter } from "../adapter.js";
import type { Config, IconSet } from "../config/types.js";
import { tokenKind } from "../tokens/reference.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { TokenSet } from "../tokens/types.js";

/** The token set's token paths, and which of them are role tokens. */
export interface SpecTokens {
  readonly paths: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
}

/**
 * The inputs of the SPEC rules beyond the specs. A rule skips the part that needs an input left
 * out: SPEC-009 checks no icon names without `icons`, SPEC-011 no token names without `tokens`,
 * and SPEC-013 no block against an adapter's schema without `adapter`.
 */
export interface SpecCheckInputs {
  readonly tokens?: SpecTokens;
  /** The icon set's names: the SVG files' names without `.svg`. */
  readonly icons?: ReadonlySet<string>;
  /** The adapter `adapter` in fazon.yaml names. */
  readonly adapter?: Pick<Adapter, "id" | "extensionSchema">;
}

/** The inputs, and for each one that couldn't be read, a sentence saying what wasn't checked. */
export interface SpecCheckSetup {
  readonly inputs: SpecCheckInputs;
  readonly skipped: readonly { readonly input: "tokens" | "icons"; readonly message: string }[];
}

/** The token paths and role tokens of a resolved token set, from every set and theme. */
export function specTokens(tokenSet: TokenSet): SpecTokens {
  const paths = new Set<string>();
  const roles = new Set<string>();
  for (const file of tokenSet.files) {
    for (const token of file.tokens) {
      paths.add(token.path);
      if (tokenKind(token) === "role") roles.add(token.path);
    }
  }
  return { paths, roles };
}

/** The directory an icon set's SVG files are in, or undefined when it can't be found. */
export function iconDirectory(root: string, icons: IconSet): string | undefined {
  if (icons !== "lucide") return path.resolve(root, icons.path);
  try {
    const manifest = createRequire(path.join(root, "package.json")).resolve("lucide-static/package.json");
    return path.join(path.dirname(manifest), "icons");
  } catch {
    return undefined;
  }
}

/** The names of an icon set's icons, or undefined when its directory can't be read. */
export async function readIconNames(root: string, icons: IconSet): Promise<ReadonlySet<string> | undefined> {
  const directory = iconDirectory(root, icons);
  if (directory === undefined) return undefined;
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return new Set(
      entries.filter((entry) => entry.isFile() && entry.name.endsWith(".svg")).map((entry) => entry.name.slice(0, -4)),
    );
  } catch {
    return undefined;
  }
}

/**
 * Reads the inputs of the SPEC rules for a repository: its token set and icon set, as fazon.yaml
 * names them, and the adapter's extension schema. What can't be read is left out and listed.
 * @param root the repository root
 * @param adapter the adapter `adapter` in fazon.yaml names; undefined when the CLI has none of that ID
 */
export async function readSpecCheckInputs(
  root: string,
  config: Pick<Config, "paths" | "icons">,
  adapter: Pick<Adapter, "id" | "extensionSchema"> | undefined,
): Promise<SpecCheckSetup> {
  const skipped: { input: "tokens" | "icons"; message: string }[] = [];
  let tokens: SpecTokens | undefined;
  try {
    const { tokenSet } = await resolveTokenSet(path.join(root, config.paths.tokens));
    if (tokenSet !== undefined) tokens = specTokens(tokenSet);
  } catch {
    // Reported below, as a token set that can't be resolved.
  }
  if (tokens === undefined) {
    skipped.push({
      input: "tokens",
      message: `The token set at ${config.paths.tokens} can't be resolved, so token names weren't checked (SPEC-011). Run 'fazon sync' to see why.`,
    });
  }
  const icons = await readIconNames(root, config.icons);
  if (icons === undefined) {
    const where =
      config.icons === "lucide" ? "the lucide-static package isn't installed" : `${config.icons.path} can't be read`;
    skipped.push({
      input: "icons",
      message: `The icon set can't be read (${where}), so icon names weren't checked (SPEC-009).`,
    });
  }
  return {
    inputs: {
      ...(tokens === undefined ? {} : { tokens }),
      ...(icons === undefined ? {} : { icons }),
      ...(adapter === undefined ? {} : { adapter }),
    },
    skipped,
  };
}
