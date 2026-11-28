// SPDX-License-Identifier: GPL-3.0-or-later
// The Vitest setup without a browser: its configuration, and the `fazonVueApi` command called as
// Vitest calls it, from a contract test in the example components (test-fixtures/vue-project/).
// integration/browser.test.ts runs it in Chromium.
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserCommandContext } from "vitest/node";
import type { VueApiFile } from "./api.js";
import { fazonVitest, fazonVueApiCommand } from "./vitest.js";
import { fixtures, golden } from "./test-support.js";

// vue-component-meta is slow under load: the 5 s default timed out in full runs (F-0033).
vi.setConfig({ testTimeout: 30_000 });

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let project: string;

beforeAll(async () => {
  project = await mkdtemp(path.join(tmpdir(), "fazon-vitest-"));
  await cp(fileURLToPath(new URL("vue-project/", fixtures)), project, { recursive: true });
  await symlink(path.join(packageRoot, "node_modules"), path.join(project, "node_modules"), "dir");
  await cp(
    fileURLToPath(new URL("src/components/dialog/generated/api.json.golden", golden)),
    path.join(project, "src/components/dialog/generated/api.json"),
    { recursive: true },
  );
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("fazonVitest", () => {
  it("runs the components' tests in Chromium at the stories' viewport, with the API command", () => {
    const config = fazonVitest();
    expect(config.include).toEqual(["src/components/**/*.test.ts"]);
    expect(config.setupFiles).toEqual([".storybook/vitest.setup.ts"]);
    expect(config.browser).toMatchObject({
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      viewport: { width: 1024, height: 768 },
      provider: { name: "playwright", options: { contextOptions: { deviceScaleFactor: 2, reducedMotion: "reduce" } } },
    });
    expect(Object.keys(config.browser?.commands ?? {})).toEqual(["fazonVueApi"]);
  });

  it("takes the components directory and the setup files", () => {
    const config = fazonVitest({ components: "lib/ui", setupFiles: ["test/setup.ts"], headless: false });
    expect(config.include).toEqual(["lib/ui/**/*.test.ts"]);
    expect(config.setupFiles).toEqual(["test/setup.ts"]);
    expect(config.browser?.headless).toBe(false);
  });
});

describe("the fazonVueApi command", () => {
  it("reads the components the calling test's api.json names, with no differences when they match", async () => {
    const command = fazonVueApiCommand();
    const context = {
      testPath: path.join(project, "src/components/dialog/generated/dialog.contract.test.ts"),
      project: { config: { root: project } },
    } as unknown as BrowserCommandContext;
    const approved = JSON.parse(
      await readFile(path.join(project, "src/components/dialog/generated/api.json"), "utf8"),
    ) as VueApiFile;
    expect(await command(context)).toEqual({ components: approved.components, differences: [] });
  });

  it("runs only from a test file", async () => {
    const command = fazonVueApiCommand();
    const context = { testPath: undefined, project: { config: { root: project } } } as unknown as BrowserCommandContext;
    await expect(async () => command(context)).rejects.toThrow("fazonVueApi runs only from a test file.");
  });
});
