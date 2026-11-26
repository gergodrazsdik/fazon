// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon verify` end to end in the verifier image: `just test-verify` (scripts/test-verify.sh). It
// needs a container runtime and the image, so it stays out of `just check`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fazon/core": fileURLToPath(new URL("../../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["e2e/**/*.test.ts"],
    globalSetup: [fileURLToPath(new URL("../../core/scripts/copy-schemas.ts", import.meta.url))],
    testTimeout: 30 * 60_000,
    hookTimeout: 10 * 60_000,
    fileParallelism: false,
  },
});
