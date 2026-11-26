// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodePng, encodePng } from "../checks/visual.js";
import { compareWithBase, componentCheckStatuses, gitBlobId, ociPlatform, optimizePng } from "./details.js";
import { finishRecord } from "./in-image.js";
import { listRunIds, newRunId, readRunRecord, runDirectory, writeRunRecord, type CheckResult } from "./run-record.js";
import { exampleButton, png, runningRecord } from "./test-support.js";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("run records", () => {
  it("are named by their start time, label and four hex digits, and sort by time", async () => {
    expect(newRunId(new Date("2026-11-25T16:40:12.345Z"), "verify", () => "3f9a")).toBe("20261125T164012Z-verify-3f9a");
    root = await mkdtemp(path.join(tmpdir(), "fazon-runs-"));
    for (const id of ["20261125T164012Z-verify-3f9a", "20261126T080000Z-button-0001", "notes"]) {
      await mkdir(runDirectory(root, id), { recursive: true });
    }
    expect(await listRunIds(root)).toEqual(["20261126T080000Z-button-0001", "20261125T164012Z-verify-3f9a"]);
  });

  it("are written whole, only when valid against the schema (RECORD-001, RECORD-002)", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-runs-"));
    const id = "20261126T100000Z-verify-abcd";
    const dir = runDirectory(root, id);
    await writeRunRecord(dir, runningRecord(id));
    expect(await readRunRecord(dir)).toEqual(runningRecord(id));
    expect(await readdir(dir)).toEqual(["run.json"]);
    await expect(writeRunRecord(dir, runningRecord(id, { status: "failed" as "passed" }))).rejects.toThrow(
      /isn't valid/,
    );
    expect(JSON.parse(await readFile(path.join(dir, "run.json"), "utf8"))).toMatchObject({ status: "running" });
  });

  it("end as passed, or as needing a person with check-error when a check couldn't run", () => {
    const record = runningRecord("20261126T100000Z-verify-abcd");
    const pass: CheckResult = { check: "build", status: "pass", durationSeconds: 1, findings: [] };
    const fail: CheckResult = {
      check: "lint",
      status: "fail",
      durationSeconds: 1,
      findings: [{ check: "lint", rule: "raw-value", message: "a literal", blocking: true }],
    };
    const ended = new Date("2026-11-26T10:01:00Z");
    expect(finishRecord(record, [pass], ended)).toMatchObject({
      status: "passed",
      ended: "2026-11-26T10:01:00Z",
      verification: { checks: [pass], captures: "captures" },
      totals: { durationSeconds: 60 },
    });
    expect(finishRecord(record, [pass, fail], ended)).not.toHaveProperty("reason");
    expect(finishRecord(record, [pass, fail], ended).status).toBe("needs-a-person");
    expect(finishRecord(record, [{ ...pass, status: "error" }], ended)).toMatchObject({
      status: "needs-a-person",
      reason: "check-error",
    });
  });
});

describe("a component's check statuses", () => {
  it("count its own findings and those of no component, not another component's", async () => {
    const button = await exampleButton();
    const tabs = await exampleButton({ name: "tabs", directory: "src/components/tabs", specFile: "specs/tabs.md" });
    const finding = (file: string | undefined) => ({
      check: "lint" as const,
      rule: "raw-value",
      message: "m",
      ...(file === undefined ? {} : { file }),
      blocking: true,
    });
    const lint = (file?: string): CheckResult => ({
      check: "lint",
      status: "fail",
      durationSeconds: 0,
      findings: [finding(file)],
    });
    expect(componentCheckStatuses([lint("src/components/tabs/Tabs.vue")], button, [button, tabs])).toEqual({
      lint: "pass",
    });
    expect(componentCheckStatuses([lint("src/components/button/Button.vue")], button, [button, tabs])).toEqual({
      lint: "fail",
    });
    expect(componentCheckStatuses([lint()], button, [button, tabs])).toEqual({ lint: "fail" });
    const skipped: CheckResult = { check: "package", status: "skipped", durationSeconds: 0, findings: [] };
    expect(componentCheckStatuses([skipped], button, [button])).toEqual({ package: "skipped" });
  });
});

describe("baselines against a ref", () => {
  it("are added, changed, removed or renamed, by their blob", () => {
    const base = new Map([
      ["light/button/a.png", "1"],
      ["light/button/b.png", "2"],
      ["light/button/old.png", "3"],
      ["dark/button/gone.png", "4"],
      ["fazon.json", "5"],
    ]);
    const current = new Map([
      ["light/button/a.png", "1"],
      ["light/button/b.png", "9"],
      ["light/button/new.png", "3"],
      ["dark/tabs/x.png", "4"],
      ["fazon.json", "6"],
    ]);
    expect(compareWithBase(base, current)).toEqual([
      { path: "dark/button/gone.png", mark: "removed" },
      { path: "dark/tabs/x.png", mark: "added" },
      { path: "light/button/b.png", mark: "changed" },
      { path: "light/button/new.png", mark: "renamed", from: "light/button/old.png" },
    ]);
  });

  it("are compared by git's blob IDs", () => {
    expect(gitBlobId(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobId(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("PNG optimisation", () => {
  it("keeps every pixel, and never makes a file larger", () => {
    const original = png(64, 48, { x: 3, y: 4, rgb: [10, 20, 30] });
    const optimized = optimizePng(original);
    expect(decodePng(optimized)).toEqual(decodePng(original));
    expect(optimized.byteLength).toBeLessThanOrEqual(original.byteLength);
  });

  it("keeps transparency", () => {
    const data = new Uint8Array(4 * 4 * 4).fill(0);
    data.set([255, 0, 0, 128], 0);
    const original = encodePng({ width: 4, height: 4, data });
    expect(decodePng(optimizePng(original))).toEqual(decodePng(original));
  });
});

it("names the platform as OCI does", () => {
  expect(ociPlatform("linux", "x64")).toBe("linux/amd64");
  expect(ociPlatform("darwin", "arm64")).toBe("darwin/arm64");
});
