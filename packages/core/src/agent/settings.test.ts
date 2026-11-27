// SPDX-License-Identifier: GPL-3.0-or-later
import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { agentSettings, findSecretFiles, findWriteDenied, writableDirectories } from "./settings.js";
import { gitRepository } from "./test-support.js";

const selfChecks = {
  commands: [
    "pnpm exec vue-tsc --noEmit",
    "pnpm exec eslint src/components/button",
    'pnpm exec stylelint "src/components/button/**/*.{vue,css}"',
  ],
  cacheDirectories: ["node_modules/.vite"],
};

describe("the agent call's settings (PERM-001)", () => {
  const settings = agentSettings({
    repo: "/work/repo",
    scope: { directory: "src/components/button", patterns: ["*.vue", "*.ts"] },
    selfChecks,
    secretFiles: ["config/id_ed25519"],
    writeDenied: ["package.json", "src/main.ts", "src/components/link", "node_modules/.pnpm", "node_modules/vue"],
  });

  it("allow reading, edits of the adapter's patterns in the component's directory, and exactly the self-checks", () => {
    expect(settings.permissions.allow).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Edit(./src/components/button/*.vue)",
      "Edit(./src/components/button/*.ts)",
      "Bash(pnpm exec vue-tsc --noEmit)",
      "Bash(pnpm exec eslint src/components/button)",
      'Bash(pnpm exec stylelint "src/components/button/**/*.{vue,css}")',
    ]);
    expect(settings.permissions.defaultMode).toBe("dontAsk");
  });

  it("deny generated/, the harness's and CI's directories, secrets, the web, subagents and MCP tools", () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        "Edit(./src/components/button/generated/**)",
        "Read(./.github/**)",
        "Read(./.claude/**)",
        "Read(./.fazon/**)",
        "Edit(./.fazon/**)",
        "Read(.env*)",
        "Read(*.pem)",
        "Read(*.key)",
        "WebFetch",
        "WebSearch",
        "Agent",
        "Task",
        "mcp__*",
      ]),
    );
  });

  it("turn the sandbox on with no network, writes only in the component's directory and the caches, and no way out", () => {
    // The repository isn't denied as a whole: on Linux that deny wins over the narrower allows (F-0029).
    expect(settings.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
      filesystem: {
        allowWrite: ["/work/repo/src/components/button", "/work/repo/node_modules/.vite"],
        denyWrite: [
          "/work/repo/package.json",
          "/work/repo/src/main.ts",
          "/work/repo/src/components/link",
          "/work/repo/node_modules/.pnpm",
          "/work/repo/node_modules/vue",
          "/work/repo/src/components/button/generated",
        ],
        denyRead: ["/work/repo/.github", "/work/repo/.claude", "/work/repo/.fazon", "/work/repo/config/id_ed25519"],
      },
    });
    expect(settings).toMatchObject({
      disableAllHooks: true,
      disableClaudeAiConnectors: true,
      enableAllProjectMcpServers: false,
    });
  });
});

describe("the sandbox's denied writes", () => {
  const scope = { directory: "src/components/button", patterns: ["*.vue"] };

  it("cover the whole repository without the paths beside the writable ones, and for a call that only reads", () => {
    for (const input of [
      { repo: "/work/repo", scope, selfChecks },
      { repo: "/work/repo", scope, selfChecks, access: "read" as const, writeDenied: ["package.json"] },
    ]) {
      expect(agentSettings(input).sandbox.filesystem.denyWrite).toEqual([
        "/work/repo",
        "/work/repo/src/components/button/generated",
      ]);
    }
  });

  it("are what exists beside the writable directories and their parents, from the root down", async () => {
    const repo = await gitRepository({
      "package.json": "{}",
      "specs/button.yaml": "",
      "src/main.ts": "",
      "src/components/button/Button.vue": "",
      "src/components/button/generated/stories.json": "",
      "src/components/link/Link.vue": "",
      "node_modules/.pnpm/vue/index.js": "",
      "node_modules/.vite/deps/x.js": "",
      "node_modules/vue/index.js": "",
    });
    try {
      const writable = writableDirectories(
        { directory: "src/components/button/", patterns: ["*.vue"] },
        { commands: [], cacheDirectories: ["node_modules/.vite", "node_modules/.vite-temp"] },
      );
      expect(writable).toEqual(["src/components/button", "node_modules/.vite", "node_modules/.vite-temp"]);
      expect(await findWriteDenied(repo, writable)).toEqual([
        ".git",
        "node_modules/.pnpm",
        "node_modules/vue",
        "package.json",
        "specs",
        "src/components/link",
        "src/main.ts",
      ]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("findSecretFiles", () => {
  it("finds keys at any depth, outside node_modules", async () => {
    // Key names the test's own sandbox lets it write; `.env*`, `*.pem` and `*.key` match the same way.
    const repo = await gitRepository({
      id_rsa: "",
      "config/deploy/id_ed25519": "",
      "config/deploy/id_ed25519.pub": "",
      "node_modules/pkg/id_rsa": "",
      "src/index.ts": "",
    });
    try {
      expect(await findSecretFiles(repo)).toEqual([
        "config/deploy/id_ed25519",
        "config/deploy/id_ed25519.pub",
        "id_rsa",
      ]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
