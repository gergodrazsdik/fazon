// SPDX-License-Identifier: GPL-3.0-or-later
// The minimum Claude Code version this framework version runs the agent with (ADR 0021, ADR 0023):
// `propose`, `generate` and `feedback` refuse an older one, and `fazon doctor` reports it.
import { execFile } from "node:child_process";

/** The oldest Claude Code the agent call is built and tested against (ADR 0023). Raised on purpose, in its own pull request. */
export const minimumClaudeCodeVersion = "2.1.332";

/** The program the harness runs as Claude Code, unless told otherwise. */
export const claudeCodeCommand = "claude";

/** What `claude --version` says about the installed Claude Code, against the minimum. */
export type ClaudeCodeStatus =
  | { readonly state: "ok"; readonly version: string }
  | { readonly state: "outdated"; readonly version: string }
  | { readonly state: "missing" }
  | { readonly state: "unreadable"; readonly output: string };

const versionPattern = /^(\d+)\.(\d+)\.(\d+)/;

/** The `major.minor.patch` version at the start of `claude --version`'s first line, such as `2.1.332 (Claude Code)`. */
export function parseClaudeCodeVersion(output: string): string | undefined {
  const line = output.trim().split("\n")[0]?.trim() ?? "";
  return versionPattern.exec(line)?.[0];
}

/** Compares two `major.minor.patch` versions: negative when `a` is older, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => (versionPattern.exec(version) ?? []).slice(1, 4).map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The status of the installed Claude Code from what `claude --version` printed: `undefined`
 * when it didn't run, as when it isn't installed.
 */
export function claudeCodeStatus(output: string | undefined): ClaudeCodeStatus {
  if (output === undefined) return { state: "missing" };
  const version = parseClaudeCodeVersion(output);
  if (version === undefined) return { state: "unreadable", output: output.trim().split("\n")[0]?.trim() ?? "" };
  return compareVersions(version, minimumClaudeCodeVersion) < 0
    ? { state: "outdated", version }
    : { state: "ok", version };
}

/** Runs `<command> --version` and returns its standard output, or `undefined` when it doesn't run or exits non-zero. */
export function readClaudeCodeVersion(command: string = claudeCodeCommand): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, ["--version"], { timeout: 15_000, windowsHide: true }, (error, stdout) => {
      resolve(error === null ? stdout : undefined);
    });
  });
}

/** Claude Code is missing, older than the minimum, or its version can't be read: the agent commands refuse to start. */
export class ClaudeCodeVersionError extends Error {
  readonly status: Exclude<ClaudeCodeStatus, { state: "ok" }>;
  /** How to fix it. */
  readonly hint: string;

  constructor(status: Exclude<ClaudeCodeStatus, { state: "ok" }>) {
    super(claudeCodeProblem(status));
    this.name = "ClaudeCodeVersionError";
    this.status = status;
    this.hint =
      status.state === "missing"
        ? "Install it: https://code.claude.com/docs/en/setup"
        : `Update it with 'claude update' to ${minimumClaudeCodeVersion} or later.`;
  }
}

/** What's wrong with a Claude Code status that isn't `ok`, as one sentence without a final stop. */
export function claudeCodeProblem(status: Exclude<ClaudeCodeStatus, { state: "ok" }>): string {
  switch (status.state) {
    case "missing":
      return "Claude Code isn't installed, or 'claude --version' doesn't run";
    case "outdated":
      return `Claude Code ${status.version} is older than ${minimumClaudeCodeVersion}, the minimum this version of Fazon needs`;
    case "unreadable":
      return `Claude Code's version can't be read from 'claude --version', which printed '${status.output}'`;
  }
}

/**
 * Checks the installed Claude Code before an agent command starts (`propose`, `generate`,
 * `feedback`): returns its version, or throws when it's missing or older than the minimum.
 * @throws ClaudeCodeVersionError
 */
export async function requireClaudeCode(
  read: () => Promise<string | undefined> = () => readClaudeCodeVersion(),
): Promise<string> {
  const status = claudeCodeStatus(await read());
  if (status.state !== "ok") throw new ClaudeCodeVersionError(status);
  return status.version;
}
