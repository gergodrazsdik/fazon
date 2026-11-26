// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the agent call's tests: a temporary git repository and a fake `claude` executable,
// so no test runs the real Claude Code. Not exported from the package.
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A temporary git repository with `files` (path → content), none of them committed. */
export async function gitRepository(files: Readonly<Record<string, string>>): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), "fazon-agent-"));
  await new Promise<void>((resolve, reject) => {
    execFile("git", ["init", "--quiet", "."], { cwd: repo }, (error) => {
      if (error === null) resolve();
      else reject(new Error(`git init failed: ${error.message}`));
    });
  });
  await writeFiles(repo, files);
  return repo;
}

export async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

/**
 * The fake Claude Code. `FAKE_CLAUDE` picks what it does:
 *
 * - `success`: the init event, one assistant message reported twice (once per content block), and a successful result;
 * - `budget`: a result with `error_max_budget_usd`, exit 1;
 * - `crash`: the init event, a message on standard error, exit 2 without a result;
 * - `malformed`: a line that isn't JSON, exit 0;
 * - `error-result`: a successful-looking exit with `error_during_execution`;
 * - `hang`: the init event and an assistant message, then it starts a child process (its PID in
 *   `FAKE_CLAUDE_CHILD`) and waits; with `FAKE_CLAUDE_STUBBORN` it ignores SIGTERM;
 * - `web`: an init event that lists WebFetch and an MCP server, then it waits.
 *
 * It first writes the files in `FAKE_CLAUDE_EDITS` (JSON, path → content, relative to its working
 * directory), and logs its arguments, standard input and working directory to `FAKE_CLAUDE_LOG`.
 * `--version` prints `FAKE_CLAUDE_VERSION`.
 */
const script = String.raw`#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const env = process.env;
if (process.argv.includes("--version")) {
  process.stdout.write((env.FAKE_CLAUDE_VERSION || "2.1.332") + " (Claude Code)\n");
  process.exit(0);
}
const mode = env.FAKE_CLAUDE || "success";
const print = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const init = (extra) => print({
  type: "system", subtype: "init", session_id: "session-1", claude_code_version: "2.1.332",
  model: "claude-sonnet-5-5", apiKeySource: env.FAKE_CLAUDE_KEY_SOURCE || "ANTHROPIC_API_KEY",
  permissionMode: "dontAsk", tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"], mcp_servers: [], ...extra,
});
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 };
const assistant = () => print({ type: "assistant", message: { id: "msg-1", model: "claude-sonnet-5-5", usage } });
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (env.FAKE_CLAUDE_LOG) {
    fs.writeFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt: input, cwd: process.cwd() }));
  }
  for (const [file, content] of Object.entries(JSON.parse(env.FAKE_CLAUDE_EDITS || "{}"))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const result = (subtype, extra) => print({
    type: "result", subtype, is_error: subtype !== "success", duration_ms: 1200, num_turns: 3,
    session_id: "session-1", total_cost_usd: 0.4321, usage,
    modelUsage: {
      "claude-sonnet-5-5": { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 40, costUSD: 0.4, costBasis: "list" },
      "claude-haiku-4-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0321, costBasis: "list" },
    },
    ...extra,
  });
  switch (mode) {
    case "success":
      init(); assistant(); assistant(); result("success", { result: "Done." }); process.exit(0);
    case "budget":
      init(); assistant(); result("error_max_budget_usd", { errors: ["Budget limit reached"] }); process.exit(1);
    case "error-result":
      init(); result("error_during_execution", { errors: ["The model is overloaded"] }); process.exit(0);
    case "crash":
      init(); process.stderr.write("Error: something broke\n"); process.exit(2);
    case "malformed":
      process.stdout.write("this isn't JSON\n"); process.exit(0);
    case "web":
      init({ tools: ["Read", "WebFetch"], mcp_servers: [{ name: "github", status: "connected" }] });
      setInterval(() => undefined, 1000);
      break;
    case "hang": {
      if (env.FAKE_CLAUDE_STUBBORN) process.on("SIGTERM", () => undefined);
      init(); assistant();
      const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
      if (env.FAKE_CLAUDE_CHILD) fs.writeFileSync(env.FAKE_CLAUDE_CHILD, String(child.pid));
      setInterval(() => undefined, 1000);
      break;
    }
    default:
      process.exit(9);
  }
});
`;

/** Writes the fake `claude` into a new temporary directory and returns its path. */
export async function fakeClaude(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "fazon-fake-claude-"));
  const file = path.join(directory, "claude");
  await writeFile(file, script);
  await chmod(file, 0o755);
  return file;
}

/** Whether a process is still running. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
