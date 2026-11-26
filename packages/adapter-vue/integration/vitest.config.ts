// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue adapter's browser integration tests: `just test-browser`. They run the built package
// (dist/) in a scratch Vue project, with Vitest's browser mode in Chromium, so they stay out of
// `just check`, which needs no browser.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["integration/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
