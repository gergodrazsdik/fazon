// SPDX-License-Identifier: GPL-3.0-or-later
// The rendered checks' fixture tests (`*.rendered.test.ts`). They need the verifier image's
// Chromium, so `just test-rendered` runs them inside the image (scripts/test-rendered.sh), with the
// repository mounted read-only; plain `just test` leaves them out.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (pkg: string) => fileURLToPath(new URL(`packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  // The repository is read-only in the container: caches go to the temporary directory.
  cacheDir: join(tmpdir(), "fazon-vitest-rendered"),
  resolve: {
    alias: { "@fazon/core": source("core") },
  },
  test: {
    include: ["packages/*/src/**/*.rendered.test.ts"],
    // One browser, pages one after another: renders don't compete for the CPU.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
