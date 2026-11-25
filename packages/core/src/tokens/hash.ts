// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { TokenSet } from "./types.js";

/** A file's hash: SHA-256 of its text with line endings normalised to LF, as `sha256:<hex>` (docs/spec/records.md#hashes). */
export function hashText(text: string): string {
  return `sha256:${createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex")}`;
}

/**
 * The token set's hash (docs/spec/records.md#hashes): the hash of a text with one line per file,
 * `<path> <file hash>`, each ending in LF: the resolver document, then each token file in
 * resolution order, with paths relative to the resolver document. A file named more than once is
 * listed where it first appears.
 */
export function hashTokenSet(tokenSet: TokenSet): string {
  const lines = [`${basename(tokenSet.resolverFile)} ${hashText(tokenSet.resolverText)}`];
  const seen = new Set<string>();
  for (const file of tokenSet.files) {
    if (seen.has(file.ref)) continue;
    seen.add(file.ref);
    lines.push(`${file.ref} ${hashText(file.text)}`);
  }
  return hashText(lines.map((line) => `${line}\n`).join(""));
}
