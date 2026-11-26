// SPDX-License-Identifier: GPL-3.0-or-later
// The end-to-end test's consumer repository: a component library with the example Button spec, the
// example library's token set, a Button styled with role tokens, the Vue adapter's configuration
// files, and node_modules linked to the framework's workspace (the built packages and the Vue
// adapter's development dependencies), as `fazon init` and `fazon sync` would set it up.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { configFiles, lintConfigFiles } from "@fazon/adapter-vue";

const run = promisify(execFile);

export const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const adapterRoot = path.join(workspace, "packages/adapter-vue");
const examples = path.join(workspace, "docs/spec");
export const cliBin = path.join(workspace, "packages/cli/dist/bin.js");

/** A stand-in for the `lucide-static` package: the icon the Button stories use, and a license. */
export const lucideLicense = "ISC License (a stand-in for the end-to-end test)\n";
/** A spec with no API and no component yet, which `fazon sync` gives only its manifest and API. */
const badgeSpec = `---
fazon: 0
name: Badge
tier: primitive
summary: Labels an item with a short status.
---

## Purpose

Labels an item with a short status, such as New.

## Behaviour

- Not interactive.

## Never

- Never used as a button.
`;
const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>\n`;

const packageJson = {
  name: "fazon-e2e-library",
  version: "0.0.0",
  description: "The component library of Fazon's end-to-end test.",
  license: "MIT",
  type: "module",
  files: ["dist"],
  sideEffects: ["**/*.css"],
  exports: {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./style.css": "./dist/style.css",
  },
  peerDependencies: { vue: "^3.5.0" },
};

// The library build: Vite's library mode, with the declarations a scaffold would generate written
// by hand, as the test only needs them to resolve.
const viteConfig = `import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "declarations",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "index.d.ts",
          source: 'import type { DefineComponent } from "vue";\\nexport declare const Button: DefineComponent;\\n',
        });
      },
    },
  ],
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index", cssFileName: "style" },
    rollupOptions: { external: ["vue"] },
  },
});
`;

const tsconfig = {
  compilerOptions: {
    target: "es2022",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["es2022", "dom", "dom.iterable"],
    types: ["vite/client"],
    strict: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["env.d.ts", "src", ".storybook"],
};

const env = `declare module "*.svg?raw" {
  const svg: string;
  export default svg;
}
`;

/** The behaviour test the spec's Behaviour section asks for, with the helper the scaffold pins (vitest-browser-vue). */
export const behaviourTest = `import { expect, it } from "vitest";
import { render } from "vitest-browser-vue";
import Button from "./Button.vue";

it("emits click when activated", async () => {
  const screen = await render(Button, { slots: { default: () => "Save" } });
  await screen.getByRole("button", { name: "Save" }).click();
  expect(screen.emitted("click")).toHaveLength(1);
});

it("blocks activation while loading, and stays focusable", async () => {
  const screen = await render(Button, { props: { loading: true }, slots: { default: () => "Save" } });
  const button = screen.getByRole("button");
  // aria-disabled makes Playwright wait for the button to be enabled, so the click is forced.
  await button.click({ force: true });
  expect(screen.emitted("click")).toBeUndefined();
  await expect.element(button).toHaveAttribute("aria-busy", "true");
  // Not natively disabled, so it keeps focus (toBeEnabled counts aria-disabled as disabled).
  const element = button.element() as HTMLButtonElement;
  expect(element.disabled).toBe(false);
  element.focus();
  expect(document.activeElement).toBe(element);
});
`;

/**
 * The example repository's fix to its token set (F-0013), which the M0 draft copied here predates:
 * the dark theme's text colour for actions is blue 200, not blue 400, so a ghost button's text on
 * the active surface has a contrast of 6.03 instead of 3.28, above axe's 4.5 for body text.
 */
async function applyTokenFixes(tokens: string): Promise<void> {
  const file = path.join(tokens, "themes/dark.json");
  const dark = JSON.parse(await readFile(file, "utf8")) as {
    color: { text: { action: { $value: string } } };
  };
  if (dark.color.text.action.$value !== "{color.blue.400}") {
    throw new Error(`The draft's dark color.text.action changed to ${dark.color.text.action.$value}; review the fix.`);
  }
  dark.color.text.action.$value = "{color.blue.200}";
  await writeFile(file, `${JSON.stringify(dark, null, 2)}\n`);
}

export interface ProjectOptions {
  /** The verifier image, by digest, for fazon.yaml. */
  readonly image: string;
  /**
   * The directory to write the project into, inside the workspace; a new temporary directory in
   * the parent when it isn't given.
   */
  readonly directory?: string;
}

/** Writes the project and returns its path. */
export async function createProject(options: ProjectOptions, parent = tmpdir()): Promise<string> {
  const root = options.directory ?? (await mkdtemp(path.join(parent, "fazon-e2e-")));
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };

  // The token prefix gives the components their prefixed names (FzButton, ADR 0022).
  await write(
    "fazon.yaml",
    `fazon: 0\nadapter: vue\nimage: ${options.image}\ntokens:\n  prefix: fz\njudge:\n  policy: off\n`,
  );
  await write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  await write("vite.config.ts", viteConfig);
  await write("tsconfig.json", `${JSON.stringify(tsconfig, null, 2)}\n`);
  await write("env.d.ts", env);
  await write("src/index.ts", 'import "./tokens.css";\n');
  await write(".gitignore", "node_modules/\ndist/\n.fazon/\nfazon.local.yaml\n");
  await write("specs/button.md", await readFile(path.join(examples, "examples/specs/valid/button.md"), "utf8"));
  // A component with a spec but no code yet, as between its spec and its first generate run: the
  // checks pass it over until its root file exists.
  await write("specs/badge.md", badgeSpec);
  await cp(path.join(examples, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  await applyTokenFixes(path.join(root, "tokens"));
  await cp(new URL("library/Button.vue", import.meta.url), path.join(root, "src/components/button/Button.vue"));
  await write("src/components/button/Button.test.ts", behaviourTest);
  for (const file of await configFiles({
    components: "src/components",
    tokensCss: "src/tokens.css",
    icons: "lucide",
  })) {
    await write(file.path, file.content);
  }
  for (const [file, text] of Object.entries(lintConfigFiles())) await write(file, text);

  await linkModules(root);
  await sync(root);
  return root;
}

/**
 * node_modules: the Vue adapter's dependencies, the framework's packages, and the icon set's
 * stand-in. The links are relative, so they resolve wherever the workspace is mounted.
 */
async function linkModules(root: string): Promise<void> {
  const link = (target: string, at: string) => symlink(path.relative(path.dirname(at), target), at, "dir");
  const modules = path.join(root, "node_modules");
  const from = path.join(adapterRoot, "node_modules");
  await mkdir(path.join(modules, "@fazon"), { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === ".bin" || entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      await mkdir(path.join(modules, entry.name), { recursive: true });
      for (const scoped of await readdir(path.join(from, entry.name))) {
        await link(path.join(from, entry.name, scoped), path.join(modules, entry.name, scoped)).catch(
          (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          },
        );
      }
    } else {
      await link(path.join(from, entry.name), path.join(modules, entry.name));
    }
  }
  await link(adapterRoot, path.join(modules, "@fazon/adapter-vue"));
  await link(path.join(workspace, "packages/cli"), path.join(modules, "fazon"));
  // The command a package manager would install for the CLI's `bin`.
  await mkdir(path.join(modules, ".bin"), { recursive: true });
  await writeFile(
    path.join(modules, ".bin/fazon"),
    '#!/bin/sh\nexec node "$(dirname "$0")/../fazon/dist/bin.js" "$@"\n',
    { mode: 0o755 },
  );
  const lucide = path.join(modules, "lucide-static");
  await mkdir(path.join(lucide, "icons"), { recursive: true });
  await writeFile(path.join(lucide, "package.json"), '{ "name": "lucide-static", "version": "0.0.0" }\n');
  await writeFile(path.join(lucide, "LICENSE"), lucideLicense);
  await writeFile(path.join(lucide, "icons/check.svg"), checkIcon);
}

/**
 * Seeds one defect per check into the project's Button, its entry file and a new source file;
 * returns the `<check>/<rule>` each one breaks, besides `visual/changed` once it has baselines.
 */
export async function seedDefects(root: string): Promise<string[]> {
  const vue = path.join(root, "src/components/button/Button.vue");
  const original = await readFile(vue, "utf8");
  const seeded = original
    // test: contract-api, a default that differs from the approved API
    .replace('size: "md"', 'size: "lg"')
    // a11y: spec-aria, an attribute the spec lists that no story shows any more
    .replace(`:aria-disabled="props.loading ? 'true' : undefined"`, "")
    // lint and tokens: raw-value
    .replace("</style>", '.button[data-variant="ghost"] {\n  border-color: #2050d0;\n}\n</style>')
    // layout: clipped-text
    .replace(
      "</style>",
      '.button[data-size="sm"] {\n  max-inline-size: 4ch;\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n</style>',
    );
  if (seeded === original) throw new Error("The Button changed: none of the seeded defects applies.");
  await writeFile(vue, seeded);
  // build: types
  await writeFile(path.join(root, "src/components/button/seed.ts"), 'export const size: number = "md";\n');
  // package: export, an entry that leaves the component out (and build: generated, as sync wrote it)
  const entry = path.join(root, "src/index.ts");
  await writeFile(entry, (await readFile(entry, "utf8")).replace(/^export \{ default as Button \}.*\n/m, ""));
  return [
    "build/types",
    "build/generated",
    "lint/raw-value",
    "test/contract-api",
    "package/export",
    "a11y/spec-aria",
    "tokens/raw-value",
    "layout/clipped-text",
  ];
}

async function sync(root: string): Promise<void> {
  await run(process.execPath, [cliBin, "sync"], { cwd: root });
}
