// SPDX-License-Identifier: GPL-3.0-or-later
// docs/spec/schemas/ is the single source of truth for the JSON Schemas. This copies them into
// packages/core/dist/schemas/, where @fazon/core reads them at runtime and the published package
// carries them. The root build runs it with Node; Vitest runs it as its global setup, so the tests
// always see the current schemas without a build.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../docs/spec/schemas/", import.meta.url));
const target = fileURLToPath(new URL("../dist/schemas/", import.meta.url));

export function copySchemas(): void {
  // Start empty, so a schema removed from docs/ doesn't linger in the package.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(source)) {
    if (file.endsWith(".schema.json")) {
      copyFileSync(source + file, target + file);
    }
  }
}

/** Vitest's global setup hook. */
export function setup(): void {
  copySchemas();
}

if (import.meta.main) {
  copySchemas();
}
