// SPDX-License-Identifier: GPL-3.0-or-later
// `@fazon/adapter-vue/storybook`: the Storybook configuration a consumer's .storybook/main.ts uses
// (docs/spec/adapter-boundary.md#stories): the Vue and Vite framework, the generated story files,
// and the icon set's license notice in the static build (docs/spec/licensing.md#lucide). The
// browser half, with the `theme` global, is `@fazon/adapter-vue/storybook/preview`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StorybookConfig } from "@storybook/vue3-vite";
import type { Plugin } from "vite";
import { generatedDirectory, type IconSet } from "@fazon/core";

export interface FazonStorybookOptions {
  /** The components directory, relative to the repository root (`paths.components`); `src/components` by default. */
  readonly components?: string;
  /** The Storybook configuration directory, relative to the repository root; `.storybook` by default. */
  readonly configDir?: string;
  /** The fixture icon set (`icons` in fazon.yaml); for `lucide`, the default, the static build gets its license notice. */
  readonly icons?: IconSet;
}

/** Where the static build holds the Lucide icons' license notice. */
export const iconLicenseFile = "licenses/lucide-static.txt";

/**
 * The Storybook configuration: `@storybook/vue3-vite` without docgen (the stories need none),
 * every component's `generated/*.stories.ts`, no telemetry, and, for Lucide, its license notice.
 * Spread it into the exported configuration to add more.
 */
export function fazonStorybook(options: FazonStorybookOptions = {}): StorybookConfig {
  const components = options.components ?? "src/components";
  const configDir = options.configDir ?? ".storybook";
  const directory = path.posix.relative(configDir, components) || ".";
  return {
    framework: { name: "@storybook/vue3-vite", options: { docgen: false } },
    stories: [{ directory, files: `*/${generatedDirectory}/*.stories.ts`, titlePrefix: "" }],
    core: { disableTelemetry: true },
    viteFinal(config) {
      if (options.icons !== undefined && options.icons !== "lucide") return config;
      return { ...config, plugins: [...(config.plugins ?? []), lucideLicense()] };
    },
  };
}

/**
 * Copies the license of the `lucide-static` package the stories import their icons from into the
 * static build, as `licenses/lucide-static.txt`. Nothing is copied when the package isn't
 * installed, as no story can import an icon then.
 */
export function lucideLicense(): Plugin {
  let root = process.cwd();
  return {
    name: "fazon:lucide-license",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      const license = findPackageFile(root, "lucide-static", "LICENSE");
      if (license !== undefined) {
        this.emitFile({ type: "asset", fileName: iconLicenseFile, source: readFileSync(license, "utf8") });
      }
    },
  };
}

/** A file of an installed package, looked up in the `node_modules` directories from `start` up. */
function findPackageFile(start: string, name: string, file: string): string | undefined {
  for (let directory = path.resolve(start); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name, file);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(directory) === directory) return undefined;
  }
}
