// SPDX-License-Identifier: GPL-3.0-or-later
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configDefaults, loadConfig, resolveConfig } from "./load.js";
import type { Config } from "./types.js";

const examples = fileURLToPath(new URL("../../../../docs/spec/examples/config/", import.meta.url));
const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const minimal = `fazon: 0\nadapter: vue\nimage: ${image}\n`;

const defaulted: Config = {
  fazon: 0,
  adapter: "vue",
  image,
  ...configDefaults,
  tokens: {},
  effort: {},
  prices: {},
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-config-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(file: string, text: string) {
  await writeFile(path.join(root, file), text);
}

describe("loadConfig", () => {
  it("applies every default to a minimal file", async () => {
    await write("fazon.yaml", minimal);
    expect(await loadConfig(root, { ci: false })).toEqual({ ok: true, config: defaulted, overrides: [] });
  });

  it("reads the minimal and full examples to the same config: the full one lists the defaults", async () => {
    await copyFile(path.join(examples, "minimal", "fazon.yaml"), path.join(root, "fazon.yaml"));
    const fromMinimal = await loadConfig(root, { ci: false });
    await copyFile(path.join(examples, "full", "fazon.yaml"), path.join(root, "fazon.yaml"));
    const fromFull = await loadConfig(root, { ci: false });
    expect(fromMinimal.ok).toBe(true);
    expect(fromFull).toEqual(fromMinimal);
  });

  it("merges the defaults, then fazon.yaml, then fazon.local.yaml, and lists the local keys", async () => {
    await write("fazon.yaml", `${minimal}loop:\n  iterations: 3\n  budgetUsd: 5\njudge:\n  policy: blocking\n`);
    await copyFile(path.join(examples, "local", "fazon.local.yaml"), path.join(root, "fazon.local.yaml"));
    const result = await loadConfig(root, { ci: false });
    expect(result).toEqual({
      ok: true,
      config: {
        ...defaulted,
        loop: { ...defaulted.loop, iterations: 3, budgetUsd: 3 },
        judge: { ...defaulted.judge, policy: "blocking", localPolicy: "off" },
      },
      overrides: ["loop.budgetUsd", "judge.localPolicy"],
    });
  });

  it("reports a missing fazon.yaml, with how to make one", async () => {
    const result = await loadConfig(root, { ci: false });
    expect(result).toEqual({
      ok: false,
      missing: true,
      localInCi: false,
      findings: [
        expect.objectContaining({ rule: "CONFIG-001", hint: expect.stringContaining("fazon init") as string }),
      ],
    });
  });

  it("refuses unknown keys, at their line", async () => {
    await write("fazon.yaml", `${minimal}loops:\n  iterations: 3\n`);
    expect(await loadConfig(root, { ci: false })).toEqual({
      ok: false,
      missing: false,
      localInCi: false,
      findings: [{ rule: "CONFIG-001", file: "fazon.yaml", path: "$", line: 4, message: "unknown key 'loops'" }],
    });
  });

  it("reports YAML errors at their line", async () => {
    await write("fazon.yaml", `${minimal}adapter: vue\n`);
    const result = await loadConfig(root, { ci: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.findings[0]).toMatchObject({ rule: "CONFIG-001", file: "fazon.yaml", line: 4 });
  });

  it("refuses a path with ..", async () => {
    await write("fazon.yaml", `${minimal}paths:\n  specs: ../specs\n`);
    const result = await loadConfig(root, { ci: false });
    expect(!result.ok && result.findings[0]).toMatchObject({ path: "$.paths.specs", line: 5 });
  });

  it("says what a local file may hold when it sets something else", async () => {
    await write("fazon.yaml", minimal);
    await write("fazon.local.yaml", "fazon: 0\npaths:\n  specs: other\njudge:\n  policy: off\n");
    const result = await loadConfig(root, { ci: false });
    expect(!result.ok && result.findings).toEqual([
      {
        rule: "CONFIG-004",
        file: "fazon.local.yaml",
        path: "$",
        line: 2,
        message: "fazon.local.yaml can't set paths",
        hint: "It may hold only fazon, loop, models, effort and judge.localPolicy; set paths in fazon.yaml.",
      },
      {
        rule: "CONFIG-004",
        file: "fazon.local.yaml",
        path: "$.judge",
        line: 5,
        message: "fazon.local.yaml can't set judge.policy",
        hint: "It may hold only fazon, loop, models, effort and judge.localPolicy; set judge.policy in fazon.yaml.",
      },
    ]);
  });

  it("refuses a local file in CI, and says how to proceed", async () => {
    await write("fazon.yaml", minimal);
    await write("fazon.local.yaml", "fazon: 0\n");
    expect((await loadConfig(root, { ci: false })).ok).toBe(true);
    const result = await loadConfig(root, { ci: true });
    expect(result).toEqual({
      ok: false,
      missing: false,
      localInCi: true,
      findings: [
        expect.objectContaining({
          rule: "CONFIG-004",
          file: "fazon.local.yaml",
          hint: expect.stringContaining("Remove fazon.local.yaml") as string,
        }),
      ],
    });
  });
});

describe("resolveConfig", () => {
  it("keeps effort and prices from the files", () => {
    const { config } = resolveConfig(
      { fazon: 0, adapter: "vue", image, effort: { judge: "high" }, prices: { "claude-x": { input: 1, output: 2 } } },
      { fazon: 0, effort: { generator: "low" } },
    );
    expect(config.effort).toEqual({ judge: "high", generator: "low" });
    expect(config.prices).toEqual({ "claude-x": { input: 1, output: 2 } });
  });
});
