// SPDX-License-Identifier: GPL-3.0-or-later
// The run lock (docs/spec/records.md#the-fazon-directory): one agent run per component at a time.
// `fazon propose`, `generate` and `feedback` take `.fazon/locks/<component>.json` before their run
// starts and remove it when the run ends; a lock whose process is gone is stale and taken over.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where the locks live, relative to the repository root. */
export const locksDirectory = ".fazon/locks";

/** What a lock file holds. */
export interface RunLock {
  /** The run holding it. */
  readonly run: string;
  /** The process running it, on this machine. */
  readonly pid: number;
  /** UTC, ISO 8601. */
  readonly started: string;
}

export type RunLockResult =
  | {
      readonly acquired: true;
      /** Removes the lock, if it's still this run's. */
      readonly release: () => Promise<void>;
    }
  | { readonly acquired: false; readonly holder: RunLock };

export interface RunLockOptions {
  /** This process's ID; `process.pid` by default. */
  readonly pid?: number;
  /** Whether a process is running; `process.kill(pid, 0)` by default. */
  readonly isRunning?: (pid: number) => boolean;
  readonly now?: () => Date;
}

/** A component's lock file, absolute. */
export function runLockFile(root: string, component: string): string {
  return path.join(root, locksDirectory, `${component}.json`);
}

/** Reads a lock; `undefined` when there's none, or it can't be read as one (a stale lock). */
export async function readRunLock(root: string, component: string): Promise<RunLock | undefined> {
  let text: string;
  try {
    text = await readFile(runLockFile(root, component), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const lock = JSON.parse(text) as Partial<RunLock>;
    if (typeof lock.run === "string" && typeof lock.pid === "number" && typeof lock.started === "string") {
      return { run: lock.run, pid: lock.pid, started: lock.started };
    }
  } catch {
    // not JSON: stale
  }
  return undefined;
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes the component's run lock for `run`. Refuses while another run holds it and its process
 * still runs; a lock left by a process that's gone (a crash), or one that can't be read, is removed
 * and taken over.
 * @param component the component's kebab-case name
 */
export async function acquireRunLock(
  root: string,
  component: string,
  run: string,
  options: RunLockOptions = {},
): Promise<RunLockResult> {
  const pid = options.pid ?? process.pid;
  const isRunning = options.isRunning ?? processRunning;
  const file = runLockFile(root, component);
  const lock: RunLock = { run, pid, started: (options.now?.() ?? new Date()).toISOString() };
  await mkdir(path.dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
      return {
        acquired: true,
        release: async () => {
          const current = await readRunLock(root, component);
          if (current?.run === run && current.pid === pid) await rm(file, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = await readRunLock(root, component);
    if (holder !== undefined && isRunning(holder.pid)) return { acquired: false, holder };
    await rm(file, { force: true });
  }
  const holder = await readRunLock(root, component);
  return { acquired: false, holder: holder ?? { run: "unknown", pid: 0, started: lock.started } };
}
