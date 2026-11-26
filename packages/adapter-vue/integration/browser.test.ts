// SPDX-License-Identifier: GPL-3.0-or-later
// The generated contract tests run in Vitest's browser mode with the adapter's Vitest and Storybook
// setup, as a consumer's repository runs them: a scratch project with the hand-written example
// components (test-fixtures/vue-project/), the golden generated and configuration files, and the
// built package. Needs `pnpm run build` and Chromium for Playwright 1.65.1 (`just test-browser`).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const modules = path.join(packageRoot, "node_modules");
const fixtures = path.join(packageRoot, "test-fixtures");
const golden = path.join(fixtures, "golden");

/** A stand-in for the `lucide-static` package: the one icon the Button stories use, and a license. */
const lucideLicense = "ISC License (a stand-in for the browser integration test)\n";
const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>\n`;

/** A component test of the scratch project: the stories render in the verifier's conditions. */
const conditionsTest = `import { composeStories } from "@storybook/vue3-vite";
import { expect, it } from "vitest";
import * as stories from "./generated/Button.stories";

it("renders a story in the verifier's conditions", async () => {
  const [story] = Object.values(composeStories(stories));
  if (story === undefined) throw new Error("no story");
  await story.run();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(getComputedStyle(document.documentElement).getPropertyValue("--fz-color-surface-base")).not.toBe("");
  expect(document.querySelector("[data-fazon-frame]")).not.toBeNull();
  expect([window.innerWidth, window.innerHeight, window.devicePixelRatio]).toEqual([1024, 768, 2]);
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
});
`;

interface AssertionResult {
  readonly fullName: string;
  readonly status: string;
  readonly failureMessages: readonly string[];
}

let project: string;

/** The environment without the variables this Vitest run sets, which would confuse the one it starts. */
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST") && name !== "TEST" && name !== "NODE_ENV"),
);

/** Every file under a directory, by its path relative to it. */
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

/** Runs Vitest in the scratch project and returns each test's result, by its full name. */
async function vitest(...filters: string[]): Promise<Map<string, AssertionResult>> {
  const output = path.join(project, "results.json");
  await rm(output, { force: true });
  // Vitest exits with 1 when a test fails; the results say which, and its output says why when there are none.
  const { stdout, stderr } = await run(
    process.execPath,
    [path.join(modules, "vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${output}`, ...filters],
    { cwd: project, env: { ...environment, CI: "1" } },
  ).catch((error: unknown) => error as { stdout: string; stderr: string });
  const results = existsSync(output)
    ? (JSON.parse(await readFile(output, "utf8")) as {
        testResults: { assertionResults: AssertionResult[]; message?: string }[];
      })
    : { testResults: [] };
  if (results.testResults.length === 0) throw new Error(`Vitest ran no test files:\n${stdout}\n${stderr}`);
  const byName = new Map<string, AssertionResult>();
  for (const file of results.testResults) {
    if (file.assertionResults.length === 0) throw new Error(`A test file failed to run: ${file.message ?? ""}`);
    for (const result of file.assertionResults) byName.set(result.fullName, result);
  }
  return byName;
}

beforeAll(async () => {
  if (!existsSync(path.join(packageRoot, "dist/vitest.js"))) {
    throw new Error("Build the packages first: pnpm run build (just test-browser does).");
  }
  project = await mkdtemp(path.join(tmpdir(), "fazon-vue-browser-"));
  await cp(path.join(fixtures, "vue-project"), project, { recursive: true });
  for (const file of await files(golden)) {
    const target = path.join(project, file.replace(/\.golden$/, ""));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(golden, file), target);
  }
  await writeFile(path.join(project, "src/components/button/conditions.test.ts"), conditionsTest);
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify({ name: "fazon-browser-test", private: true, type: "module" }, null, 2)}\n`,
  );
  // What the scaffold's Vite configuration holds for Storybook: the Vue plugin.
  await writeFile(
    path.join(project, "vite.config.ts"),
    'import vue from "@vitejs/plugin-vue";\nimport { defineConfig } from "vite";\n\nexport default defineConfig({ plugins: [vue()] });\n',
  );

  // node_modules: the adapter's dependencies, the adapter itself, and the icon set's stand-in.
  const nodeModules = path.join(project, "node_modules");
  await mkdir(path.join(nodeModules, "@fazon"), { recursive: true });
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    if (entry.name.startsWith("@")) {
      await mkdir(path.join(nodeModules, entry.name), { recursive: true });
      for (const scoped of await readdir(path.join(modules, entry.name))) {
        await symlink(path.join(modules, entry.name, scoped), path.join(nodeModules, entry.name, scoped), "dir");
      }
    } else {
      await symlink(path.join(modules, entry.name), path.join(nodeModules, entry.name), "dir");
    }
  }
  await symlink(packageRoot, path.join(nodeModules, "@fazon/adapter-vue"), "dir");
  const lucide = path.join(nodeModules, "lucide-static");
  await mkdir(path.join(lucide, "icons"), { recursive: true });
  await writeFile(path.join(lucide, "package.json"), '{ "name": "lucide-static", "version": "0.0.0" }\n');
  await writeFile(path.join(lucide, "LICENSE"), lucideLicense);
  await writeFile(path.join(lucide, "icons/check.svg"), checkIcon);
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("the contract tests in Vitest's browser mode", () => {
  it("pass for components that match their approved API and render cleanly", async () => {
    const results = await vitest();
    const failed = [...results.values()].filter((result) => result.status !== "passed");
    expect(failed).toEqual([]);
    for (const component of ["Button", "Dialog", "Tabs"]) {
      expect(results.get(`${component}: contract-api matches the approved API in api.json`)?.status).toBe("passed");
      const renders = [...results.keys()].filter((name) => name.startsWith(`${component}: contract-render `));
      expect(renders.length).toBeGreaterThan(0);
    }
    expect(results.get("renders a story in the verifier's conditions")?.status).toBe("passed");
  });

  it("fail contract-api when a component drifts from its approved API, naming the difference", async () => {
    const file = path.join(project, "src/components/button/Button.vue");
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace('size: "md"', 'size: "lg"'));
    try {
      const results = await vitest("src/components/button/generated");
      const api = results.get("Button: contract-api matches the approved API in api.json");
      expect(api?.status).toBe("failed");
      expect(api?.failureMessages.join("\n")).toContain(
        'Button: the prop size has the default "lg"; the approved API says "md".',
      );
      const renders = [...results.values()].filter((result) => result.fullName.startsWith("Button: contract-render "));
      expect(renders.length).toBeGreaterThan(0);
      expect(renders.every((result) => result.status === "passed")).toBe(true);
    } finally {
      await writeFile(file, original);
    }
  });
});

describe("the themes module", () => {
  it("is what the preview takes the themes and the default theme from", async () => {
    const themes = path.join(project, ".storybook/generated/themes.ts");
    const original = await readFile(themes, "utf8");
    const test = path.join(project, "src/components/button/theme.test.ts");
    await writeFile(
      themes,
      original
        .replace('["light", "dark"]', '["dark", "light"]')
        .replace('defaultTheme = "light"', 'defaultTheme = "dark"'),
    );
    await writeFile(test, conditionsTest.replace('toBe("light")', 'toBe("dark")'));
    try {
      const results = await vitest("src/components/button/theme.test.ts");
      expect(results.get("renders a story in the verifier's conditions")?.status).toBe("passed");
    } finally {
      await writeFile(themes, original);
      await rm(test);
    }
  });
});

describe("the Storybook setup", () => {
  it("builds the generated stories, with the icon set's license notice", async () => {
    const output = path.join(project, "storybook-static");
    await run(
      process.execPath,
      [path.join(modules, "storybook/dist/bin/dispatcher.js"), "build", "--quiet", "--output-dir", output],
      { cwd: project, env: { ...environment, CI: "1", STORYBOOK_DISABLE_TELEMETRY: "1" } },
    );
    expect(await readFile(path.join(output, "licenses/lucide-static.txt"), "utf8")).toBe(lucideLicense);
    const index = JSON.parse(await readFile(path.join(output, "index.json"), "utf8")) as {
      entries: Record<string, { title: string }>;
    };
    const titles = new Set(Object.values(index.entries).map((entry) => entry.title));
    expect([...titles].sort()).toEqual(["Button", "Dialog", "Tabs"]);
  });
});
