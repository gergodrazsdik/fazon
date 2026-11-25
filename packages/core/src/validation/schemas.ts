// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";

/** The JSON Schemas of docs/spec/schemas/, by the file name without `.schema.json`. */
export const schemaNames = [
  "baselines",
  "calibration-record",
  "cli-output",
  "config",
  "config-local",
  "judge-plan",
  "judge-result",
  "provenance",
  "run-record",
  "spec",
  "story-manifest",
  "token-resolver",
  "tokens",
] as const;

export type SchemaName = (typeof schemaNames)[number];

// packages/core/scripts/copy-schemas.ts puts them here. This module sits two levels below the
// package root both as src/validation/schemas.ts (tests) and as dist/validation/schemas.js.
const directory = new URL("../../dist/schemas/", import.meta.url);

/** Reads one schema as the package carries it. */
export function readSchema(name: SchemaName): Record<string, unknown> {
  const url = new URL(`${name}.schema.json`, directory);
  let text: string;
  try {
    text = readFileSync(url, "utf8");
  } catch (cause) {
    throw new Error(
      `@fazon/core: the schema ${name} is missing at ${url.pathname}; in the Fazon repository, run 'just build'.`,
      { cause },
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}
