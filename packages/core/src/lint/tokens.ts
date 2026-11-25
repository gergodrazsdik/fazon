// SPDX-License-Identifier: GPL-3.0-or-later
// The token index the lint rules read: from options, or from the consumer's fazon.yaml. Built
// once per resolver and prefix in a process, as a lint run calls the rules for every file.
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { buildTokens, TokenSetError, type TokenIndex } from "../tokens/build.js";
import { resolveTokenSet } from "../tokens/resolve.js";

/** Options of Fazon's token lint rules. */
export interface TokenLintOptions {
  /** The repository root: where fazon.yaml is, and what `tokens` is relative to. Default: the working directory. */
  readonly root?: string;
  /** The resolver document. Default: `paths.tokens` from fazon.yaml. */
  readonly tokens?: string;
  /** The custom property prefix. Default: `tokens.prefix` from fazon.yaml, or none. */
  readonly prefix?: string;
  /** A token index that is already built, such as `fazon verify`'s; `root`, `tokens` and `prefix` are then ignored. */
  readonly index?: TokenIndex;
}

const cache = new Map<string, Promise<TokenIndex>>();

/**
 * The token index for the options: `options.index`, or the token set built from the resolver
 * document and prefix, which come from the options or from fazon.yaml. Rejects when fazon.yaml or
 * the token set can't be read or breaks its rules; the `lint` check then ends as an error.
 */
export async function loadTokenIndex(options: TokenLintOptions = {}): Promise<TokenIndex> {
  if (options.index !== undefined) return options.index;
  const root = path.resolve(options.root ?? process.cwd());
  let { tokens, prefix } = options;
  if (tokens === undefined || prefix === undefined) {
    const config = await loadConfig(root, { ci: false });
    if (!config.ok) {
      const problems = config.findings.map((f) => `  ${f.rule} ${f.file}: ${f.message}`).join("\n");
      throw new Error(
        `Fazon's lint rules can't read the token set's location from fazon.yaml in ${root}:\n${problems}`,
      );
    }
    tokens ??= config.config.paths.tokens;
    prefix ??= config.config.tokens.prefix ?? "";
  }
  const resolver = path.resolve(root, tokens);
  const key = `${resolver}\0${prefix}`;
  let index = cache.get(key);
  if (index === undefined) {
    index = buildIndex(resolver, prefix);
    cache.set(key, index);
    // A failed build isn't cached, so a fixed token set is read again.
    void index.catch(() => cache.delete(key));
  }
  return index;
}

async function buildIndex(resolver: string, prefix: string): Promise<TokenIndex> {
  const { tokenSet, findings } = await resolveTokenSet(resolver);
  if (tokenSet === undefined) throw new TokenSetError(findings);
  return (await buildTokens(tokenSet, { prefix })).index;
}
