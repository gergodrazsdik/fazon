// SPDX-License-Identifier: GPL-3.0-or-later
// The Claude Code settings the harness writes for each agent call (docs/spec/agent-permissions.md#the-headless-call):
// edits only in the component's directory, outside `generated/`, for the adapter's patterns; Bash
// only for the self-check commands; no web, MCP servers or subagents; the sandbox on, with no
// network; secrets and the harness's directories unreadable. Keys confirmed against Claude Code 2.1.332.
import { glob } from "node:fs/promises";
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

/**
 * The settings of one agent call (PERM-001). Permission rules use paths relative to the working
 * directory (`./…`), because a rule starting with `/` is anchored at the settings file's directory;
 * the sandbox's filesystem paths are absolute.
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
        denyWrite: [input.repo, absolute(path.posix.join(directory, generatedDirectory))],
        denyRead: [...unreadableDirectories, ...(input.secretFiles ?? [])].map(absolute),
      },
    },
    disableAllHooks: true,
    disableClaudeAiConnectors: true,
    enableAllProjectMcpServers: false,
  };
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
