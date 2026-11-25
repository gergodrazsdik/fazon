// SPDX-License-Identifier: GPL-3.0-or-later
import { isMap, isNode, isPair, isScalar, LineCounter, parseDocument } from "yaml";
import type { PathSegment } from "./validation/validate.js";

/** A YAML text, parsed, with a way back from a path in its data to a line in the text. */
export interface YamlSource {
  /** The data; `undefined` when the text has errors. */
  readonly data: unknown;
  /** Syntax errors, and constructs the data can't hold such as duplicate keys or unknown tags. */
  readonly errors: readonly { readonly message: string; readonly line?: number }[];
  /** The 1-based line of the value at a path, or of `key` in the mapping there; the nearest existing ancestor's otherwise. */
  readonly lineOf: (segments: readonly PathSegment[], key?: string) => number | undefined;
}

/** Parses YAML 1.2 (the core schema: no dates, no `yes`/`no` booleans). */
export function parseYaml(text: string): YamlSource {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true, logLevel: "silent" });
  const lineAt = (offset: number) => lineCounter.linePos(offset).line;
  const errors = [...document.errors, ...document.warnings].map((error) => ({
    message: error.message,
    line: lineAt(error.pos[0]),
  }));

  return {
    data: errors.length === 0 ? (document.toJS() as unknown) : undefined,
    errors,
    lineOf(segments, key) {
      for (let length = segments.length; length >= 0; length--) {
        const path = segments.slice(0, length);
        const node: unknown = length === 0 ? document.contents : document.getIn(path, true);
        if (!isNode(node)) {
          continue;
        }
        if (key !== undefined && length === segments.length && isMap(node)) {
          const pair = node.items.find((item) => isPair(item) && isScalar(item.key) && item.key.value === key);
          const keyNode: unknown = pair?.key;
          if (isNode(keyNode) && keyNode.range) {
            return lineAt(keyNode.range[0]);
          }
        }
        if (node.range) {
          return lineAt(node.range[0]);
        }
      }
      return undefined;
    },
  };
}
