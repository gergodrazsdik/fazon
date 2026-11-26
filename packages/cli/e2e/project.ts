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
}

/** Writes the project into a new temporary directory and returns its path. */
export async function createProject(options: ProjectOptions, parent = tmpdir()): Promise<string> {
  const root = await mkdtemp(path.join(parent, "fazon-e2e-"));
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
  const lucide = path.join(modules, "lucide-static");
  await mkdir(path.join(lucide, "icons"), { recursive: true });
  await writeFile(path.join(lucide, "package.json"), '{ "name": "lucide-static", "version": "0.0.0" }\n');
  await writeFile(path.join(lucide, "LICENSE"), lucideLicense);
  await writeFile(path.join(lucide, "icons/check.svg"), checkIcon);
}

async function sync(root: string): Promise<void> {
  await run(process.execPath, [cliBin, "sync"], { cwd: root });
}
