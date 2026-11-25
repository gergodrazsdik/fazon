// SPDX-License-Identifier: GPL-3.0-or-later
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (pkg: string) => fileURLToPath(new URL(`packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against the sources of the workspace packages, without a build first.
    alias: {
      "@fazon/core": source("core"),
      "@fazon/adapter-vue": source("adapter-vue"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // @fazon/core reads the JSON Schemas from its dist/schemas/; this copies them from docs/spec/schemas/.
    globalSetup: ["packages/core/scripts/copy-schemas.ts"],
  },
});
