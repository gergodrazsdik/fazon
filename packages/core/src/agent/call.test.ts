// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validateWithSchema } from "../validation/validate.js";
import { claudeArguments, runAgentCall, type AgentCallOptions } from "./call.js";
import { StreamJsonReader } from "./output.js";
import { handEdits, takeSnapshot } from "./snapshot.js";
import { fakeClaude, gitRepository, isRunning, writeFiles } from "./test-support.js";

let claude: string;
beforeAll(async () => {
  claude = await fakeClaude();
});
afterAll(() => rm(path.dirname(claude), { recursive: true, force: true }));

let repo: string;
let runDirectory: string;
beforeEach(async () => {
  repo = await gitRepository({
    "package.json": "{}\n",
    "src/components/button/generated/stories.json": "{}\n",
  });
  runDirectory = path.join(repo, ".fazon/runs/20261126T120000Z-button-3f9a");
});
afterEach(() => rm(repo, { recursive: true, force: true }));

function options(env: Record<string, string>, overrides: Partial<AgentCallOptions> = {}): AgentCallOptions {
  return {
    repo,
    prompt: "Generate Button.\nIteration 1 of 5; $10.00 left.",
    scope: { directory: "src/components/button", patterns: ["*.vue", "*.ts", "*.css"] },
    selfChecks: { commands: ["pnpm exec vue-tsc --noEmit"], cacheDirectories: [] },
    model: "claude-sonnet-5-5",
    timeoutMs: 20_000,
    runDirectory,
    iteration: 1,
    command: claude,
    env: { PATH: process.env.PATH, FAKE_CLAUDE_LOG: path.join(runDirectory, "fake.json"), ...env },
    ...overrides,
  };
}

const log = async () =>
  JSON.parse(await readFile(path.join(runDirectory, "fake.json"), "utf8")) as {
    args: string[];
    prompt: string;
    cwd: string;
  };

/** The call as the run record's `$defs.call` would hold it: an iteration with only the call. */
function callProblems(call: unknown) {
  return validateWithSchema("run-record", {
    fazon: 0,
    id: "20261126T120000Z-button-3f9a",
    kind: "generate",
    component: "Button",
    status: "running",
    started: "2026-11-26T12:00:00Z",
    versions: { framework: "0.0.0", claudeCode: "2.1.332", image: "x@sha256:" + "0".repeat(64) },
    config: {
      caps: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20 },
      models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
      escalateAfter: 2,
      judgePolicy: "advisory",
    },
    iterations: [{ n: 1, call, outcome: "fail" }],
    handEdits: [],
    totals: { iterations: 1, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 0, escalated: false },
  });
}

describe("the claude call's arguments", () => {
  it("are print mode, stream-json, the settings, no prompts, the tools, no MCP or session, the model, effort and budget", () => {
    expect(
      claudeArguments({
        settingsFile: "/r/calls/1.settings.json",
        model: "claude-opus-5-5",
        effort: "high",
        maxBudgetUsd: 7.123456,
      }),
    ).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--settings",
      "/r/calls/1.settings.json",
      "--restricted",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--tools",
      "Read,Glob,Grep,Edit,Write,Bash",
      "--disallowed-tools",
      "WebFetch,WebSearch,Agent,Task,NotebookEdit,mcp__*",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
      "--max-budget-usd",
      "7.1234",
    ]);
    expect(claudeArguments({ settingsFile: "s.json", model: "m" })).not.toContain("--effort");
  });
});

describe("an agent call with a fake claude", () => {
  it("records a successful call: cost, tokens, model, transcript, files changed, version and session", async () => {
    const result = await runAgentCall(
      options(
        {
          FAKE_CLAUDE: "success",
          FAKE_CLAUDE_EDITS: JSON.stringify({ "src/components/button/Button.vue": "<template />" }),
        },
        { effort: "medium", maxBudgetUsd: 10 },
      ),
    );
    expect(result.call).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
      end: "completed",
      costUsd: 0.4321,
      tokens: { input: 11, output: 22, cacheRead: 300, cacheWrite: 40 },
      transcript: "calls/1.jsonl",
      filesChanged: ["src/components/button/Button.vue"],
    });
    expect(result.call.costEstimated).toBeUndefined();
    expect(result.call.durationSeconds).toBeGreaterThan(0);
    expect(result).toMatchObject({
      violations: [],
      claudeCodeVersion: "2.1.332",
      sessionId: "session-1",
      costKnown: true,
      interrupted: false,
      exitCode: 0,
    });
    expect(result.error).toBeUndefined();
    expect(callProblems(result.call)).toEqual([]);

    const { args, prompt, cwd } = await log();
    expect(prompt).toBe("Generate Button.\nIteration 1 of 5; $10.00 left.");
    expect(cwd).toBe(repo);
    expect(args).toContain("--max-budget-usd");
    const settings = JSON.parse(await readFile(path.join(runDirectory, "calls/1.settings.json"), "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(args[args.indexOf("--settings") + 1]).toBe(path.join(runDirectory, "calls/1.settings.json"));
    expect(settings.permissions.allow).toContain("Bash(pnpm exec vue-tsc --noEmit)");

    const transcript = (await readFile(path.join(runDirectory, "calls/1.jsonl"), "utf8")).trim().split("\n");
    expect(transcript.map((line) => (JSON.parse(line) as { type: string }).type)).toEqual([
      "system",
      "assistant",
      "assistant",
      "result",
    ]);
  });

  it("marks the cost as estimated under a subscription login", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "success", FAKE_CLAUDE_KEY_SOURCE: "none" }));
    expect(result.call).toMatchObject({ costUsd: 0.4321, costEstimated: true });
  });

  it("ends as budget when Claude Code stops at its limit, with the cost it reports", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "budget" }, { maxBudgetUsd: 0.4 }));
    expect(result.call).toMatchObject({ end: "budget", costUsd: 0.4321 });
    expect(result.exitCode).toBe(1);
  });

  it("stops a call at the call-time cap, with the commands it started, and estimates its cost from the tokens", async () => {
    const childFile = path.join(runDirectory, "child.pid");
    const result = await runAgentCall(
      options(
        { FAKE_CLAUDE: "hang", FAKE_CLAUDE_CHILD: childFile },
        { timeoutMs: 1500, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      ),
    );
    expect(result.call.end).toBe("call-time");
    expect(result.call.durationSeconds).toBeGreaterThanOrEqual(1.4);
    expect(result.call.durationSeconds).toBeLessThan(10);
    expect(result.call.tokens).toEqual({ input: 10, output: 20, cacheRead: 300, cacheWrite: 40 });
    expect(result.call.costUsd).toBeCloseTo((10 * 3 + 20 * 15 + 300 * 0.3 + 40 * 3.75) / 1_000_000, 10);
    expect(result.call.costEstimated).toBe(true);
    expect(result.costKnown).toBe(true);
    expect(result.exitCode).toBeNull();
    const child = Number(await readFile(childFile, "utf8"));
    await expect.poll(() => isRunning(child), { timeout: 5000 }).toBe(false);
  });

  it("kills a call that ignores SIGTERM after the grace period", async () => {
    const result = await runAgentCall(
      options({ FAKE_CLAUDE: "hang", FAKE_CLAUDE_STUBBORN: "1" }, { timeoutMs: 1000, killGraceMs: 300 }),
    );
    expect(result.call.end).toBe("call-time");
    expect(result.call.durationSeconds).toBeLessThan(10);
  });

  it("stops a call when the run is interrupted", async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 800);
    const result = await runAgentCall(options({ FAKE_CLAUDE: "hang" }, { signal: controller.signal }));
    expect(result).toMatchObject({ interrupted: true, call: { end: "error" }, error: "The call was stopped." });
  });

  it("without a result or a price, records no cost and says it isn't known", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "crash" }));
    expect(result.call).toMatchObject({
      end: "error",
      costUsd: 0,
      costEstimated: true,
      tokens: { input: 0, output: 0 },
    });
    expect(result.costKnown).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.error).toBe(
      "Claude Code exited with code 2 without reporting a result. Its standard error: Error: something broke",
    );
    expect(result.claudeCodeVersion).toBe("2.1.332");
  });

  it("ends in error on output that isn't stream-json", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "malformed" }));
    expect(result.call.end).toBe("error");
    expect(result.error).toBe(
      "Claude Code exited with code 0 without reporting a result; 1 line wasn't JSON, the first: this isn't JSON",
    );
  });

  it("ends in error on an error result, even with exit code 0", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "error-result" }));
    expect(result.call).toMatchObject({ end: "error", costUsd: 0.4321 });
    expect(result.error).toBe(
      "Claude Code ended the call with error_during_execution (exit code 0): The model is overloaded",
    );
  });

  it("ends in error when Claude Code doesn't start", async () => {
    const result = await runAgentCall(options({}, { command: path.join(path.dirname(claude), "absent") }));
    expect(result.call.end).toBe("error");
    expect(result.error).toContain("isn't installed");
  });

  it("stops a call whose tools or MCP servers show it didn't get its permissions (PERM-001)", async () => {
    const result = await runAgentCall(options({ FAKE_CLAUDE: "web" }));
    expect(result.call.end).toBe("error");
    expect(result.error).toBe(
      "The call didn't start with its permissions (PERM-001): it has tools it must not have: WebFetch; it has MCP servers: github.",
    );
    expect(result.call.durationSeconds).toBeLessThan(10);
  });

  it("lists changes outside the allowed paths as violations, without reverting them (PERM-002)", async () => {
    const edits = {
      "src/components/button/Button.vue": "<template />",
      "src/components/button/generated/stories.json": "[]",
      "src/components/button/notes.md": "",
      "package.json": '{"dependencies":{"left-pad":"1.3.0"}}',
    };
    const result = await runAgentCall(options({ FAKE_CLAUDE: "success", FAKE_CLAUDE_EDITS: JSON.stringify(edits) }));
    expect(result.violations).toEqual([
      "package.json",
      "src/components/button/generated/stories.json",
      "src/components/button/notes.md",
    ]);
    expect(result.call.filesChanged).toEqual([
      "package.json",
      "src/components/button/Button.vue",
      "src/components/button/generated/stories.json",
      "src/components/button/notes.md",
    ]);
    expect(await readFile(path.join(repo, "package.json"), "utf8")).toBe(edits["package.json"]);
  });

  it("gives the snapshot after the call, for the hand edits before the next one (PERM-005)", async () => {
    const first = await runAgentCall(
      options({
        FAKE_CLAUDE: "success",
        FAKE_CLAUDE_EDITS: JSON.stringify({ "src/components/button/Button.vue": "1" }),
      }),
    );
    await writeFiles(repo, { "src/components/button/Button.vue": "fixed by hand", "src/tokens.css": "" });
    const before = await takeSnapshot(repo);
    expect(handEdits(first.after, before, 1)).toEqual({
      after: 1,
      files: ["src/components/button/Button.vue", "src/tokens.css"],
    });
    const second = await runAgentCall(options({ FAKE_CLAUDE: "success" }, { iteration: 2, before }));
    expect(second.call.filesChanged).toEqual([]);
    expect(second.call.transcript).toBe("calls/2.jsonl");
  });
});

describe("the stream-json reader", () => {
  it("reads events split across chunks, and a last line without a newline", () => {
    const reader = new StreamJsonReader();
    const init = JSON.stringify({
      type: "system",
      subtype: "init",
      claude_code_version: "2.1.332",
      tools: [],
      mcp_servers: [],
    });
    const result = JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 1.5 });
    reader.push(init.slice(0, 10));
    reader.push(`${init.slice(10)}\n${result.slice(0, 5)}`);
    reader.push(result.slice(5));
    reader.end();
    expect(reader.init?.claudeCodeVersion).toBe("2.1.332");
    expect(reader.result).toMatchObject({ subtype: "success", costUsd: 1.5, isError: false });
    expect(reader.malformed.lines).toBe(0);
  });

  it("falls back to the result's usage without modelUsage", () => {
    const reader = new StreamJsonReader();
    reader.push(
      `${JSON.stringify({ type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 6 } })}\n`,
    );
    expect(reader.result?.tokens).toEqual({ input: 5, output: 6, cacheRead: 0, cacheWrite: 0 });
  });
});
