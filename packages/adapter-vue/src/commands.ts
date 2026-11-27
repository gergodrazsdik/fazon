// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue adapter's source-check commands (docs/spec/adapter-boundary.md#commands), which
// `fazon verify` runs in the verifier image, the self-check commands the agent may run on the
// host, and the `test` rule of each test.
import {
  generatedDirectory,
  type SelfChecks,
  type SourceCommands,
  type SourceCommandsInput,
  type TestRule,
} from "@fazon/core";

/**
 * `vite build` in library mode, `vue-tsc --noEmit`, `storybook build`, ESLint and Stylelint on
 * the components' files, `vitest run` in browser mode on the components' tests and contract tests,
 * and the package packed as it would be published. The image carries npm but not pnpm, so the
 * package is packed with `npm pack`, without running its scripts: the build has already run.
 */
export function sourceCommands(input: SourceCommandsInput): SourceCommands {
  return {
    compile: [{ package: "vite", args: ["build"] }],
    types: { package: "vue-tsc", args: ["--noEmit", "--pretty", "false"] },
    storybook: { package: "storybook", args: ["build", "--quiet", "--output-dir", input.storybookDir] },
    eslint: {
      package: "eslint",
      args: ["--format", "json", "--output-file", input.reports.eslint, "--no-warn-ignored", ...input.components],
    },
    stylelint: {
      package: "stylelint",
      args: [
        ...input.components.map((directory) => `${directory}/**/*.{vue,css}`),
        "--formatter",
        "json",
        "--output-file",
        input.reports.stylelint,
        "--allow-empty-input",
      ],
    },
    test: {
      package: "vitest",
      args: ["run", "--reporter=json", `--outputFile=${input.reports.test}`, ...input.components],
    },
    pack: { program: "npm", args: ["pack", "--ignore-scripts", "--json", "--pack-destination", input.packDir] },
    // Are the Types Wrong's esm-only profile with bundler resolution, which reads the `.vue` files' declarations.
    typesResolutions: ["bundler"],
  };
}

/** The generated contract tests are `contract-api` and `contract-render`; every other test is a behaviour test. */
export function testRule(file: string, name: string): TestRule {
  const contract = file.split("/").includes(generatedDirectory) && file.endsWith(".contract.test.ts");
  if (!contract) return "behaviour";
  return name.includes("contract-api") ? "contract-api" : "contract-render";
}

/**
 * Where the self-checks write: Vite's bundled config and dependency cache, Vitest's cache, other
 * tools' caches, and the screenshots Vitest's browser mode takes of failed tests (`.vitest/`).
 */
const selfCheckCaches = [
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "node_modules/.vitest-cache",
  "node_modules/.cache",
  ".vitest",
] as const;

/**
 * The self-check commands for the component in `directory` (docs/spec/adapter-boundary.md#commands),
 * run on the host with the dependencies the developer installed: `vue-tsc`, ESLint and Stylelint
 * on the component's files, and its tests.
 */
export function selfChecks(directory: string): SelfChecks {
  return {
    commands: [
      "pnpm exec vue-tsc --noEmit",
      `pnpm exec eslint ${directory}`,
      `pnpm exec stylelint "${directory}/**/*.{vue,css}"`,
      `pnpm exec vitest run ${directory}`,
    ],
    cacheDirectories: [...selfCheckCaches],
  };
}
