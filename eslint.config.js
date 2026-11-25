// SPDX-License-Identifier: GPL-3.0-or-later
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/", "**/coverage/", "docs/", "**/node_modules/"] },
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
