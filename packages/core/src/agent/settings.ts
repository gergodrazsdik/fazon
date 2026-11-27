// SPDX-License-Identifier: GPL-3.0-or-later
// The Claude Code settings the harness writes for each agent call (docs/spec/agent-permissions.md#the-headless-call):
// edits only in the component's directory, outside `generated/`, for the adapter's patterns; Bash
// only for the self-check commands; no web, MCP servers or subagents; the sandbox on, with no
// network and shell writes only in the component's directory and the self-checks' caches; secrets
// and the harness's directories unreadable. Keys confirmed against Claude Code 2.1.332.
import { glob, readdir } from "node:fs/promises";
import path from "node:path";
import type { SelfChecks } from "../adapter.js";
import { generatedDirectory } from "../sync/sync.js";
import { trimSlashes, type AgentScope } from "./snapshot.js";

/** The built-in tools the agent has (`--tools`): reading, searching, editing files, and the shell for the self-checks. */
export const agentTools = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"] as const;

/** The built-in tools of a call that only reads, such as a propose call: no edits and no shell. */
export const readOnlyTools = ["Read", "Glob", "Grep"] as const;

/** What a call may do: edit its component's files and run the self-checks, or only read. */
export type AgentAccess = "edit" | "read";

/**
 * Tools denied outright (`--disallowed-tools`), in case a tool list grows: web access, subagents
 * (the Agent tool, which Claude Code also reports as `Task`), notebooks, and every MCP tool.
 */
export const deniedTools = ["WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit", "mcp__*"] as const;

/** Directories at the repository root the agent can't read: CI, Claude Code's own config, and the harness's run files. */
export const unreadableDirectories = [".github", ".claude", ".fazon"] as const;

/** Files the agent can't read, at any depth: environment files, keys and certificates. */
export const unreadableFiles = [
  ".env*",
  "*.pem",
  "*.key",
  "*.crt",
  "*.cer",
  "*.der",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa*",
  "id_dsa*",
  "id_ecdsa*",
  "id_ed25519*",
] as const;

/** What the settings of one agent call are made from. */
export interface AgentSettingsInput {
  /** The repository root, absolute: the call's working directory. */
  readonly repo: string;
  /** The component's directory and the adapter's file patterns. */
  readonly scope: AgentScope;
  /** The adapter's self-check commands for the component. */
  readonly selfChecks: SelfChecks;
  /**
   * The secret files in the repository, relative to its root (`findSecretFiles`). Claude Code's
   * sandbox on Linux ignores glob patterns in its filesystem rules, so they are also denied by path.
   */
  readonly secretFiles?: readonly string[];
  /**
   * The paths the sandbox denies writes to, relative to the repository's root (`findWriteDenied`):
   * everything that exists next to the component's directory, the cache directories and their
   * parents. Without them, or for a call that only reads, the whole repository is denied.
   */
  readonly writeDenied?: readonly string[];
  /** `read` for a call that may change nothing, as a propose call; `edit` by default. */
  readonly access?: AgentAccess;
}

/** The settings file passed with `--settings`: only the keys the harness sets. */
export interface AgentSettings {
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly defaultMode: "dontAsk";
    readonly disableBypassPermissionsMode: "disable";
  };
  readonly sandbox: {
    readonly enabled: true;
    readonly failIfUnavailable: true;
    readonly autoAllowBashIfSandboxed: false;
    readonly allowUnsandboxedCommands: false;
    readonly network: { readonly allowedDomains: readonly string[] };
    readonly filesystem: {
      readonly allowWrite: readonly string[];
      readonly denyWrite: readonly string[];
      readonly denyRead: readonly string[];
    };
  };
  readonly disableAllHooks: true;
  readonly disableClaudeAiConnectors: true;
  readonly enableAllProjectMcpServers: false;
}

/** A path relative to the working directory, as a Read or Edit permission rule writes it (`./src/…`). */
function relativeRule(tool: "Read" | "Edit", file: string): string {
  return `${tool}(./${file})`;
}

/** The directories the sandbox lets a call's shell commands write to, relative to the repository's root. */
export function writableDirectories(scope: AgentScope, selfChecks: SelfChecks): string[] {
  return [trimSlashes(scope.directory), ...selfChecks.cacheDirectories.map(trimSlashes)];
}

/**
 * The settings of one agent call (PERM-001). Permission rules use paths relative to the working
 * directory (`./…`), because a rule starting with `/` is anchored at the settings file's directory;
 * the sandbox's filesystem paths are absolute.
 *
 * The sandbox lets shell commands write in the working directory, the repository, unless a path is
 * denied, and on Linux a denied directory stays denied below it, even where `allowWrite` names a
 * narrower path (F-0029). So an edit call doesn't deny the repository as a whole: it denies what
 * exists beside the writable directories (`writeDenied`), and `generated/` inside the component's.
 */
export function agentSettings(input: AgentSettingsInput): AgentSettings {
  const directory = trimSlashes(input.scope.directory);
  const absolute = (relative: string) => path.join(input.repo, relative);
  const readOnly = input.access === "read";
  const allow = [
    "Read",
    "Glob",
    "Grep",
    ...(readOnly
      ? []
      : [
          ...input.scope.patterns.map((pattern) => relativeRule("Edit", `${directory}/${pattern}`)),
          ...input.selfChecks.commands.map((command) => `Bash(${command})`),
        ]),
  ];
  const deny = [
    // A call that only reads may edit nothing and run nothing; Edit rules cover the Write tool too.
    ...(readOnly ? ["Edit", "Bash"] : []),
    relativeRule("Edit", `${directory}/${generatedDirectory}/**`),
    ...unreadableDirectories.flatMap((name) => [
      relativeRule("Read", `${name}/**`),
      relativeRule("Edit", `${name}/**`),
    ]),
    ...unreadableFiles.map((pattern) => `Read(${pattern})`),
    ...deniedTools,
  ];
  return {
    permissions: { allow, deny, defaultMode: "dontAsk", disableBypassPermissionsMode: "disable" },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
      filesystem: {
        allowWrite: readOnly ? [] : [absolute(directory), ...input.selfChecks.cacheDirectories.map(absolute)],
        denyWrite: [
          ...(readOnly || input.writeDenied === undefined ? [input.repo] : input.writeDenied.map(absolute)),
          absolute(path.posix.join(directory, generatedDirectory)),
        ],
        denyRead: [...unreadableDirectories, ...(input.secretFiles ?? [])].map(absolute),
      },
    },
    disableAllHooks: true,
    disableClaudeAiConnectors: true,
    enableAllProjectMcpServers: false,
  };
}

/**
 * What the sandbox denies writes to so that only `writable` (directories relative to the repository's
 * root) and what's below them can be written: every entry that exists in `writable`'s parent
 * directories, from the root down, other than `writable` and their parents, sorted. A path that
 * doesn't exist yet can't be denied (the sandbox on Linux skips it); the snapshots after the call
 * catch a file it creates there unless git ignores it (PERM-002).
 */
export async function findWriteDenied(repo: string, writable: readonly string[]): Promise<string[]> {
  const allowed = new Set(writable.map(trimSlashes));
  const denied: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(path.join(repo, directory));
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = directory === "" ? entry : `${directory}/${entry}`;
      if (allowed.has(relative)) continue;
      if ([...allowed].some((target) => target.startsWith(`${relative}/`))) await visit(relative);
      else denied.push(relative);
    }
  };
  await visit("");
  return denied.sort();
}

/** Directories `findSecretFiles` doesn't look in. */
const notSearched = new Set(["node_modules", ".git"]);

/** The files in the repository that match `unreadableFiles`, outside `node_modules/` and `.git/`, sorted. */
export async function findSecretFiles(repo: string): Promise<string[]> {
  const found: string[] = [];
  for await (const file of glob(
    unreadableFiles.map((pattern) => `**/${pattern}`),
    { cwd: repo, exclude: (name) => notSearched.has(path.basename(name)) },
  )) {
    found.push(file.split(path.sep).join("/"));
  }
  return [...new Set(found)].sort();
}
