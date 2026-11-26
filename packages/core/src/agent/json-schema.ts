// SPDX-License-Identifier: GPL-3.0-or-later
// The JSON Schema given to Claude Code as `--json-schema` (docs/spec/agent-permissions.md#the-headless-call).
// Claude Code 2.1.332 compiles it as draft-07 in strict mode: it rejects the 2020-12 `$schema`
// reference and keywords such as `unevaluatedProperties`. The harness validates the answer against
// the full schema afterwards, so the copy Claude Code gets may be looser, never stricter.
import type { JsonSchema } from "../adapter.js";

/**
 * A draft-07 copy of a 2020-12 schema for Claude Code: without `$schema` and
 * `unevaluatedProperties`, with `$defs` as `definitions` (and the `$ref`s into them), and
 * `dependentRequired` as `dependencies`.
 */
export function claudeCodeJsonSchema(schema: JsonSchema): JsonSchema {
  return convert(schema) as JsonSchema;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || key === "unevaluatedProperties") continue;
    if (key === "dependentRequired") out.dependencies = value;
    else if (key === "$defs") out.definitions = convert(value);
    else if (key === "$ref" && typeof value === "string") out.$ref = value.replace(/^#\/\$defs\//, "#/definitions/");
    else out[key] = convert(value);
  }
  return out;
}
