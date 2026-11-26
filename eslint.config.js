// SPDX-License-Identifier: GPL-3.0-or-later
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Local, gitignored directories: agents' worktrees (.claude/worktrees) and run records (.fazon) are never linted.
  { ignores: ["**/dist/", "**/coverage/", "docs/", "**/node_modules/", ".claude/", "**/.fazon/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.js", "*.ts"], defaultProject: "tsconfig.base.json" },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The verifier's smoke test runs inside the image with its own dependencies (verifier/smoke/package.json);
    // it isn't part of the TypeScript workspace, so it is linted as plain JavaScript.
    files: ["verifier/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    // Callbacks passed to page.evaluate() run in the browser, so both sets of globals apply.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // ADAPTER-001 (docs/spec/adapter-boundary.md#rules): the core never imports framework code.
    files: ["packages/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["vue", "vue/*", "@vue/*", "reka-ui", "reka-ui/*", "@fazon/adapter-*", "fazon", "fazon/*"],
              message: "The core never imports a framework, an adapter or the CLI (ADAPTER-001).",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
