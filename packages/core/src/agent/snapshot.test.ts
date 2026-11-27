// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile } from "node:child_process";
import { chmod, rm, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles, handEdits, isAllowedPath, takeSnapshot, violations, type AgentScope } from "./snapshot.js";
import { gitRepository, writeFiles } from "./test-support.js";

const scope: AgentScope = { directory: "src/components/button", patterns: ["*.vue", "*.ts", "*.css"] };

let repo: string;
beforeEach(async () => {
  repo = await gitRepository({
    ".gitignore": "node_modules/\n*.log\n",
    "package.json": "{}\n",
    "src/components/button/Button.vue": "<template />\n",
    "src/components/button/generated/stories.json": "{}\n",
    "node_modules/x/index.js": "",
  });
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe("snapshots", () => {
  it("cover tracked and untracked files, but not ignored files or .fazon/", async () => {
    await writeFiles(repo, { ".fazon/runs/x/run.json": "{}", "debug.log": "" });
    const snapshot = await takeSnapshot(repo);
    expect([...snapshot.files.keys()]).toEqual([
      ".gitignore",
      "package.json",
      "src/components/button/Button.vue",
      "src/components/button/generated/stories.json",
    ]);
  });

  it("see added, removed and changed files, a changed executable bit and a changed link", async () => {
    await symlink("package.json", path.join(repo, "link"));
    const before = await takeSnapshot(repo);
    await writeFiles(repo, { "src/components/button/Button.vue": "<template><button /></template>\n", "new.ts": "" });
    await unlink(path.join(repo, "src/components/button/generated/stories.json"));
    await chmod(path.join(repo, "package.json"), 0o755);
    await unlink(path.join(repo, "link"));
    await symlink(".gitignore", path.join(repo, "link"));
    await writeFiles(repo, { "node_modules/x/index.js": "changed", ".fazon/runs/x/run.json": "{}" });
    expect(changedFiles(before, await takeSnapshot(repo))).toEqual([
      "link",
      "new.ts",
      "package.json",
      "src/components/button/Button.vue",
      "src/components/button/generated/stories.json",
    ]);
  });

  it("make the changes between calls a hand edit, after the iteration before them (PERM-005)", async () => {
    const afterCall = await takeSnapshot(repo);
    expect(handEdits(afterCall, await takeSnapshot(repo), 1)).toBeUndefined();
    await writeFiles(repo, { "src/components/button/Button.vue": "edited by hand\n", "README.md": "" });
    expect(handEdits(afterCall, await takeSnapshot(repo), 1)).toEqual({
      after: 1,
      files: ["README.md", "src/components/button/Button.vue"],
    });
  });

  it("leave out the sandbox's stubs that git doesn't track, so they make no hand edit (F-0031)", async () => {
    const afterCall = await takeSnapshot(repo);
    // What Claude Code's sandbox mounts over the protected paths that don't exist, while it runs.
    await writeFiles(repo, {
      ".mcp.json": "",
      ".claude/agents": "",
      ".claude/skills/x": "",
      ".bashrc": "",
      ".vscode/settings.json": "",
    });
    const beforeNextCall = await takeSnapshot(repo);
    expect([...beforeNextCall.files.keys()].filter((file) => file.startsWith("."))).toEqual([".gitignore"]);
    expect(handEdits(afterCall, beforeNextCall, 1)).toBeUndefined();
  });

  it("keep a tracked file under a stub path, such as a committed .claude/settings.json", async () => {
    const tracked = await gitRepository({ ".claude/settings.json": "{}\n", "package.json": "{}\n" });
    try {
      await promisify(execFile)("git", ["add", "-A"], { cwd: tracked });
      const before = await takeSnapshot(tracked);
      expect([...before.files.keys()]).toEqual([".claude/settings.json", "package.json"]);
      await writeFiles(tracked, { ".claude/settings.json": '{ "changed": true }\n' });
      expect(changedFiles(before, await takeSnapshot(tracked))).toEqual([".claude/settings.json"]);
    } finally {
      await rm(tracked, { recursive: true, force: true });
    }
  });

  it("fail when the directory isn't a git repository", async () => {
    await rm(path.join(repo, ".git"), { recursive: true });
    await expect(takeSnapshot(path.join(repo, "src"))).rejects.toThrow("Can't list the repository's files with git");
  });
});

describe("the allowed paths (PERM-002, PERM-003)", () => {
  it("are the adapter's patterns in the component's directory, outside generated/", () => {
    expect(isAllowedPath("src/components/button/Button.vue", scope)).toBe(true);
    expect(isAllowedPath("src/components/button/Button.test.ts", scope)).toBe(true);
    expect(isAllowedPath("src/components/button/generated/Button.stories.ts", scope)).toBe(false);
    expect(isAllowedPath("src/components/button/notes.md", scope)).toBe(false);
    expect(isAllowedPath("src/components/button/nested/Inner.vue", scope)).toBe(false);
    expect(isAllowedPath("src/components/button-group/ButtonGroup.vue", scope)).toBe(false);
    expect(isAllowedPath("src/components/link/Link.vue", scope)).toBe(false);
    expect(isAllowedPath("src/index.ts", scope)).toBe(false);
    expect(isAllowedPath("src/components/button/Button.vue", { ...scope, directory: "src/components/button/" })).toBe(
      true,
    );
  });

  it("make every other changed file a violation", () => {
    expect(
      violations(
        ["package.json", "src/components/button/Button.vue", "src/components/button/generated/api.json"],
        scope,
      ),
    ).toEqual(["package.json", "src/components/button/generated/api.json"]);
  });
});
