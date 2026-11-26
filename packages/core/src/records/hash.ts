// SPDX-License-Identifier: GPL-3.0-or-later
// The hashes the run record and provenance file store (docs/spec/records.md#hashes). A file's hash
// and the token set's are in ../tokens/hash.ts; this module adds the approved API's.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Spec } from "../spec/types.js";
import { hashText } from "../tokens/hash.js";

/**
 * The canonical JSON form of a value (RFC 8785, the JSON Canonicalization Scheme): no whitespace,
 * object keys sorted by their UTF-16 code units, numbers and strings as ECMAScript serialises
 * them. Object members whose value is `undefined` are left out, as JSON.stringify leaves them out.
 * @throws Error on a value JSON can't hold: a non-finite number, a bigint, a function or a symbol
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`${String(value)} has no JSON form.`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item: unknown) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
      }
      const members = Object.entries(value as Record<string, unknown>)
        .filter(([, member]) => member !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${members.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
    }
    default:
      throw new Error(`A ${typeof value} has no JSON form.`);
  }
}

/** The spec fields that make up its API (docs/spec/spec-format.md#approval). */
const apiFields = ["props", "events", "slots", "methods", "forward", "form", "parts", "extensions"] as const;
/** The part fields that aren't part of the API. */
const partFieldsOutsideApi: ReadonlySet<string> = new Set(["states", "produce", "a11y"]);

/**
 * The spec's API, the part the developer approves: `props`, `events`, `slots`, `methods`,
 * `forward`, `form`, `parts` without their `states`, `produce` and `a11y`, and `extensions`.
 */
export function approvedApi(spec: Spec): Record<string, unknown> {
  const api: Record<string, unknown> = {};
  for (const field of apiFields) {
    const value = spec[field];
    if (value === undefined) continue;
    if (field === "parts") {
      api[field] = Object.fromEntries(
        Object.entries(spec.parts ?? {}).map(([name, part]) => [
          name,
          Object.fromEntries(Object.entries(part).filter(([key]) => !partFieldsOutsideApi.has(key))),
        ]),
      );
    } else {
      api[field] = value;
    }
  }
  return api;
}

/** The approved API's hash: SHA-256 of its canonical JSON (RFC 8785), as `sha256:<hex>`. */
export function hashApi(spec: Spec): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(approvedApi(spec)), "utf8")
    .digest("hex")}`;
}

/** A file's hash (the spec, the conventions doc, the config): its text with line endings normalised to LF. */
export async function hashFile(file: string): Promise<string> {
  return hashText(await readFile(file, "utf8"));
}
