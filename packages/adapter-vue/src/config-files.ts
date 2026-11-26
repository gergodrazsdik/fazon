// SPDX-License-Identifier: GPL-3.0-or-later
// The Vitest and Storybook configuration files a consumer's repository needs for the generated
// stories and contract tests (docs/spec/adapter-boundary.md#what-fazon-init-writes-for-vue):
// `fazon init` writes them when they don't exist yet. They import the adapter's setup entries,
// and the preview imports the themes module `fazon sync` writes from the token set.
import path from "node:path";
import { generatedDirectory, type IconSet, type SetupFile, type ThemesInput } from "@fazon/core";
import { formatTypeScript } from "./generate.js";
import { template } from "./template.js";

export interface ConfigFilesInput {
  /** The components directory (`paths.components`), relative to the repository root. */
  readonly components: string;
  /** The token set's CSS (`paths.tokensCss`), relative to the repository root. */
  readonly tokensCss: string;
  /** The library's own stylesheets the stories need, such as the one that loads its font, relative to the root. */
  readonly styles?: readonly string[];
  /** The fixture icon set (`icons`). */
  readonly icons: IconSet;
}

/** A configuration file, by its path from the repository root. */
export type ConfigFile = SetupFile;

/** The Storybook configuration directory. */
export const storybookDirectory = ".storybook";

/** The themes module `fazon sync` writes, relative to the repository root. */
export const themesFilePath = `${storybookDirectory}/${generatedDirectory}/themes.ts`;

/** A file's import specifier from `.storybook/`. */
function fromStorybook(file: string): string {
  const relative = path.posix.relative(storybookDirectory, file);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** `vitest.config.ts`, and `main.ts`, `preview.ts` and `vitest.setup.ts` in `.storybook/`. */
export async function configFiles(input: ConfigFilesInput): Promise<ConfigFile[]> {
  const config = template("config.ts.tmpl");
  const components = JSON.stringify(input.components);
  const imports = [input.tokensCss, ...(input.styles ?? [])]
    .map((file) => config.fill("style-import", { path: fromStorybook(file) }))
    .join("\n");
  const files: [string, string][] = [
    ["vitest.config.ts", config.fill("vitest-config", { components })],
    [
      `${storybookDirectory}/main.ts`,
      config.fill("storybook-main", { components, icons: JSON.stringify(input.icons) }),
    ],
    [
      `${storybookDirectory}/preview.ts`,
      config.fill("storybook-preview", { imports, themes: fromStorybook(themesFilePath).replace(/\.ts$/, "") }),
    ],
    [`${storybookDirectory}/vitest.setup.ts`, config.fill("vitest-setup")],
  ];
  return Promise.all(files.map(async ([file, text]) => ({ path: file, content: await formatTypeScript(text) })));
}

/**
 * `.storybook/generated/themes.ts`, which `fazon sync` writes: the token set's themes, the default
 * first, as `themes`, and the default theme as `defaultTheme`, for the preview's theme switch.
 */
export async function themesFile(input: ThemesInput): Promise<SetupFile> {
  const text = template("themes.ts.tmpl").fill("file", {
    themes: JSON.stringify(input.themes),
    defaultTheme: JSON.stringify(input.defaultTheme),
  });
  return { path: themesFilePath, content: await formatTypeScript(text) };
}
