// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireRunLock, readRunLock, runLockFile } from "./run-lock.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-lock-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const now = () => new Date("2026-11-26T12:00:00Z");

describe("the run lock", () => {
  it("is taken in .fazon/locks/<component>.json and removed on release", async () => {
    const lock = await acquireRunLock(root, "badge", "run-1", { pid: 4242, now });
    expect(lock.acquired).toBe(true);
    expect(runLockFile(root, "badge")).toBe(path.join(root, ".fazon/locks/badge.json"));
    expect(JSON.parse(await readFile(runLockFile(root, "badge"), "utf8"))).toEqual({
      run: "run-1",
      pid: 4242,
      started: "2026-11-26T12:00:00.000Z",
    });
    if (lock.acquired) await lock.release();
    expect(await readRunLock(root, "badge")).toBeUndefined();
  });

  it("refuses while a running process holds it, for that component only", async () => {
    const first = await acquireRunLock(root, "badge", "run-1", { pid: 4242, isRunning: () => true, now });
    expect(first.acquired).toBe(true);
    const second = await acquireRunLock(root, "badge", "run-2", { pid: 4343, isRunning: () => true });
    expect(second).toEqual({
      acquired: false,
      holder: { run: "run-1", pid: 4242, started: "2026-11-26T12:00:00.000Z" },
    });
    expect((await acquireRunLock(root, "link", "run-3", { pid: 4343 })).acquired).toBe(true);
  });

  it("takes over a lock whose process is gone, or that can't be read", async () => {
    await acquireRunLock(root, "badge", "run-1", { pid: 4242 });
    const taken = await acquireRunLock(root, "badge", "run-2", { pid: 4343, isRunning: () => false });
    expect(taken.acquired).toBe(true);
    expect((await readRunLock(root, "badge"))?.run).toBe("run-2");

    await mkdir(path.join(root, ".fazon/locks"), { recursive: true });
    await writeFile(runLockFile(root, "link"), "not JSON");
    expect((await acquireRunLock(root, "link", "run-3", { isRunning: () => true })).acquired).toBe(true);
  });

  it("is held by this process while its run goes on", async () => {
    const lock = await acquireRunLock(root, "badge", "run-1");
    expect((await acquireRunLock(root, "badge", "run-2")).acquired).toBe(false);
    if (lock.acquired) await lock.release();
    expect((await acquireRunLock(root, "badge", "run-2")).acquired).toBe(true);
  });

  it("leaves a lock another run took over when the first is released", async () => {
    const first = await acquireRunLock(root, "badge", "run-1", { pid: 4242 });
    await acquireRunLock(root, "badge", "run-2", { pid: 4343, isRunning: () => false });
    if (first.acquired) await first.release();
    expect((await readRunLock(root, "badge"))?.run).toBe("run-2");
  });
});
