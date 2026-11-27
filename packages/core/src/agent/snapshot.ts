// SPDX-License-Identifier: GPL-3.0-or-later
// Snapshots of the working tree around each agent call (docs/spec/agent-permissions.md#hand-edits):
// a change during a call outside the allowed paths is a violation (PERM-002, PERM-003); a change
// between calls is a hand edit (PERM-005).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { generatedDirectory } from "../sync/sync.js";

/**
 * The state of a repository's files: every file git tracks or would track (tracked files, and
 * untracked files that aren't ignored), outside `.fazon/` and the sandbox's stub paths when git
 * doesn't track them (`sandboxStubPaths`), by path relative to the repository root with `/`
 * separators. Ignored files, such as `node_modules/` and build output, aren't covered.
 */
export interface Snapshot {
  /** A fingerprint of each file that exists: its kind, its executable bit and the SHA-256 of its content or link target. */
  readonly files: ReadonlyMap<string, string>;
}

/** The files the agent may write: its component's directory, outside `generated/`, for the adapter's patterns. */
export interface AgentScope {
  /** The component's directory, relative to the repository root, with `/` separators: `src/components/button`. */
  readonly directory: string;
  /** Glob patterns, relative to the directory, of the files the agent may write (the adapter's `componentFiles().patterns`). */
  readonly patterns: readonly string[];
}

/** Paths the snapshot leaves out: the harness's own run files. */
const harnessDirectory = ".fazon/";

/**
 * Paths Claude Code's sandbox protects inside the working directory. While a sandboxed command
 * runs, the sandbox mounts a stub over each one that doesn't exist, and it removes the stubs
 * afterwards; a snapshot taken in between would list them, and the next one wouldn't, which read
 * as a hand edit (F-0031). The snapshot leaves them out when git doesn't track them: the agent
 * can't write them (agent-permissions.md), so they say nothing about the run.
 */
export const sandboxStubPaths: readonly string[] = [
  ".bash_profile",
  ".bashrc",
  ".claude",
  ".gitconfig",
  ".gitmodules",
  ".idea",
  ".mcp.json",
  ".profile",
  ".ripgreprc",
  ".vscode",
  ".zprofile",
  ".zshrc",
];

/** Whether an untracked file is under one of the sandbox's stub paths. */
export function isSandboxStub(file: string): boolean {
  return sandboxStubPaths.some((stub) => file === stub || file.startsWith(`${stub}/`));
}

/** How many files are read at once. */
const parallelReads = 32;

/** The files git lists in `repo`: tracked (`--cached`), or untracked but not ignored (`--others`). */
function listFiles(repo: string, which: "--cached" | "--others"): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["ls-files", "-z", which, "--exclude-standard"],
      { cwd: repo, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error(`Can't list the repository's files with git in ${repo}: ${error.message}`));
          return;
        }
        resolve(stdout.split("\0").filter((file) => file !== ""));
      },
    );
  });
}

async function fingerprint(repo: string, file: string): Promise<string | undefined> {
  const full = path.join(repo, file);
  try {
    const stats = await lstat(full);
    if (stats.isSymbolicLink()) return `link:${await readlink(full)}`;
    if (stats.isDirectory()) return "directory";
    const hash = createHash("sha256")
      .update(await readFile(full))
      .digest("hex");
    return `${(stats.mode & 0o111) === 0 ? "file" : "exec"}:${hash}`;
  } catch (error) {
    // A tracked file that was deleted is absent from the snapshot.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Takes a snapshot of the repository's files (see `Snapshot` for what it covers). */
export async function takeSnapshot(repo: string): Promise<Snapshot> {
  const tracked = await listFiles(repo, "--cached");
  const untracked = (await listFiles(repo, "--others")).filter((file) => !isSandboxStub(file));
  const listed = [...new Set([...tracked, ...untracked])].filter((file) => !file.startsWith(harnessDirectory)).sort();
  const files = new Map<string, string>();
  for (let start = 0; start < listed.length; start += parallelReads) {
    const batch = listed.slice(start, start + parallelReads);
    const prints = await Promise.all(batch.map((file) => fingerprint(repo, file)));
    batch.forEach((file, i) => {
      const print = prints[i];
      if (print !== undefined) files.set(file, print);
    });
  }
  return { files };
}

/** The files added, removed or changed from one snapshot to the next, sorted. */
export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const changed = new Set<string>();
  for (const [file, print] of before.files) {
    if (after.files.get(file) !== print) changed.add(file);
  }
  for (const file of after.files.keys()) {
    if (!before.files.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

/** Whether the agent may write `file` (relative to the repository root): in its component's directory, outside `generated/`, of one of the patterns. */
export function isAllowedPath(file: string, scope: AgentScope): boolean {
  const prefix = `${trimSlashes(scope.directory)}/`;
  if (!file.startsWith(prefix)) return false;
  const relative = file.slice(prefix.length);
  if (relative === generatedDirectory || relative.startsWith(`${generatedDirectory}/`)) return false;
  return scope.patterns.some((pattern) => path.posix.matchesGlob(relative, pattern));
}

/** A directory without trailing `/`s. */
export function trimSlashes(directory: string): string {
  let end = directory.length;
  while (end > 0 && directory[end - 1] === "/") end--;
  return directory.slice(0, end);
}

/** The changed files the agent wasn't allowed to write (PERM-002, PERM-003), sorted. */
export function violations(changed: readonly string[], scope: AgentScope): string[] {
  return changed.filter((file) => !isAllowedPath(file, scope));
}

/** The run record's hand edit for the changes a person made between calls, after iteration `after`; `undefined` when nothing changed (PERM-005). */
export function handEdits(
  afterCall: Snapshot,
  beforeNextCall: Snapshot,
  after: number,
): { readonly after: number; readonly files: readonly string[] } | undefined {
  const files = changedFiles(afterCall, beforeNextCall);
  return files.length === 0 ? undefined : { after, files };
}
