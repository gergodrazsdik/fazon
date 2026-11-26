// SPDX-License-Identifier: GPL-3.0-or-later
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claudeCodeStatus,
  ClaudeCodeVersionError,
  compareVersions,
  minimumClaudeCodeVersion,
  parseClaudeCodeVersion,
  readClaudeCodeVersion,
  requireClaudeCode,
} from "./version.js";
import { fakeClaude } from "./test-support.js";

describe("the minimum Claude Code version (T-0094)", () => {
  it("is 2.1.332 (ADR 0023)", () => {
    expect(minimumClaudeCodeVersion).toBe("2.1.332");
  });

  it("reads the version from 'claude --version'", () => {
    expect(parseClaudeCodeVersion("2.1.332 (Claude Code)\n")).toBe("2.1.332");
    expect(parseClaudeCodeVersion("  10.0.1\nmore")).toBe("10.0.1");
    expect(parseClaudeCodeVersion("Claude Code 2.1.332")).toBeUndefined();
  });

  it("compares versions by number, not as text", () => {
    expect(compareVersions("2.1.331", "2.1.332")).toBeLessThan(0);
    expect(compareVersions("2.1.1000", "2.1.332")).toBeGreaterThan(0);
    expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
    expect(compareVersions("2.1.332", "2.1.332")).toBe(0);
  });

  it("is ok from the minimum up, outdated below it, missing without output, unreadable otherwise", () => {
    expect(claudeCodeStatus("2.1.332 (Claude Code)")).toEqual({ state: "ok", version: "2.1.332" });
    expect(claudeCodeStatus("2.2.0 (Claude Code)")).toEqual({ state: "ok", version: "2.2.0" });
    expect(claudeCodeStatus("2.1.331 (Claude Code)")).toEqual({ state: "outdated", version: "2.1.331" });
    expect(claudeCodeStatus(undefined)).toEqual({ state: "missing" });
    expect(claudeCodeStatus("nightly\n")).toEqual({ state: "unreadable", output: "nightly" });
  });

  it("refuses an older, missing or unreadable Claude Code before an agent command starts", async () => {
    await expect(requireClaudeCode(() => Promise.resolve("2.1.332 (Claude Code)"))).resolves.toBe("2.1.332");
    const old = requireClaudeCode(() => Promise.resolve("2.1.300 (Claude Code)"));
    await expect(old).rejects.toBeInstanceOf(ClaudeCodeVersionError);
    await expect(old).rejects.toThrow("Claude Code 2.1.300 is older than 2.1.332");
    await expect(requireClaudeCode(() => Promise.resolve(undefined))).rejects.toMatchObject({
      status: { state: "missing" },
      hint: "Install it: https://code.claude.com/docs/en/setup",
    });
  });

  describe("with an executable", () => {
    let claude: string;
    beforeAll(async () => {
      claude = await fakeClaude();
    });
    afterAll(() => rm(path.dirname(claude), { recursive: true, force: true }));

    it("runs '<command> --version'", async () => {
      await expect(readClaudeCodeVersion(claude)).resolves.toBe("2.1.332 (Claude Code)\n");
      await expect(requireClaudeCode(() => readClaudeCodeVersion(claude))).resolves.toBe("2.1.332");
    });

    it("gives undefined when the command doesn't exist", async () => {
      await expect(readClaudeCodeVersion(path.join(path.dirname(claude), "absent"))).resolves.toBeUndefined();
    });
  });
});
