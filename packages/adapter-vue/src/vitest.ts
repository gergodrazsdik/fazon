// SPDX-License-Identifier: GPL-3.0-or-later
// `@fazon/adapter-vue/vitest`: the Vitest setup a consumer's vitest.config.ts uses
// (docs/spec/adapter-boundary.md#contract-tests). Browser mode in Chromium through Playwright, in
// the rendering conditions of docs/spec/story-matrix.md#rendering, and the `fazonVueApi` browser
// command the generated contract tests call, which reads the component's API on the server.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { storyViewport } from "@fazon/core";
import { playwright } from "@vitest/browser-playwright";
import type { ViteUserConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import type { VueApiFile } from "./api.js";
import { apiFileName } from "./generate.js";
import { apiDifferences, createVueApiReader, type ReadComponentApi, type VueApiReader } from "./reader.js";

/** What `fazonVueApi` returns to the contract test. */
export interface VueApiReading {
  /** The API of each single-file component api.json names, as its file declares it, keyed as in api.json. */
  readonly components: Record<string, ReadComponentApi>;
  /** How it differs from api.json, a sentence each; empty when it matches. */
  readonly differences: string[];
}

declare module "vitest/browser" {
  interface BrowserCommands {
    /** The API of the components the test's `generated/api.json` names, as their files declare it. */
    fazonVueApi: () => Promise<VueApiReading>;
  }
}

export interface FazonVitestOptions {
  /** The components directory, relative to the root (`paths.components`); `src/components` by default. */
  readonly components?: string;
  /** The TypeScript configuration that includes the components, relative to the root; `tsconfig.json` by default. */
  readonly tsconfig?: string;
  /**
   * Setup files, relative to the root; by default `.storybook/vitest.setup.ts`, which applies the
   * Storybook preview to the stories the contract tests render.
   */
  readonly setupFiles?: readonly string[];
  /** Run the browser headless; `true` by default. */
  readonly headless?: boolean;
}

const readers = new Map<string, VueApiReader>();

/** One reader per TypeScript configuration, kept for the test run, so later reads reuse its program. */
function reader(tsconfig: string): VueApiReader {
  let found = readers.get(tsconfig);
  if (found === undefined) {
    found = createVueApiReader({ tsconfig });
    readers.set(tsconfig, found);
  }
  return found;
}

/**
 * The `fazonVueApi` browser command: reads `api.json` next to the calling test, in the component's
 * `generated/` directory, and returns the API of each single-file component it names, as the
 * component's files declare it, with how it differs from api.json.
 * @param tsconfig the TypeScript configuration, relative to the project's root
 */
export function fazonVueApiCommand(tsconfig = "tsconfig.json"): BrowserCommand<[], VueApiReading> {
  return async ({ testPath, project }) => {
    if (testPath === undefined) throw new Error("fazonVueApi runs only from a test file.");
    const generated = path.dirname(testPath);
    const api = JSON.parse(await readFile(path.join(generated, apiFileName), "utf8")) as VueApiFile;
    const read = reader(path.resolve(project.config.root, tsconfig));
    const components = read.readComponent(path.dirname(generated), api.components);
    return { components, differences: apiDifferences(api.components, components) };
  };
}

/** Vitest's `test` configuration, as `defineConfig` from `vitest/config` takes it. */
export type VitestTestConfig = NonNullable<ViteUserConfig["test"]>;

/**
 * Vitest's `test` configuration for a Vue library Fazon maintains: browser mode in headless
 * Chromium at the stories' viewport (1024 by 768, device scale factor 2) with reduced motion, the
 * `fazonVueApi` command, and the component and contract tests (`<components>/**\/*.test.ts`).
 * Use it as `test` in vitest.config.ts, with `@vitejs/plugin-vue` in `plugins`. (Vitest reads the
 * browser configuration before plugins' `config` hooks run, so this isn't a plugin.)
 */
export function fazonVitest(options: FazonVitestOptions = {}): VitestTestConfig {
  const components = options.components ?? "src/components";
  return {
    include: [`${components}/**/*.test.ts`],
    setupFiles: [...(options.setupFiles ?? [".storybook/vitest.setup.ts"])],
    browser: {
      enabled: true,
      headless: options.headless ?? true,
      provider: playwright({
        contextOptions: { deviceScaleFactor: storyViewport.scale, reducedMotion: "reduce" },
      }),
      instances: [{ browser: "chromium" }],
      viewport: { width: storyViewport.width, height: storyViewport.height },
      commands: { fazonVueApi: fazonVueApiCommand(options.tsconfig) },
    },
  };
}
