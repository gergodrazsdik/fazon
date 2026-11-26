// SPDX-License-Identifier: GPL-3.0-or-later
// The agent call connected to the loop, against the fake Claude Code: no real `claude -p` runs.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeClaude, gitRepository } from "../agent/test-support.js";
import { resolveConfig } from "../config/load.js";
import type { ConfigFile } from "../config/types.js";
import { readRunRecord, runRecordProblems } from "../records/run-record.js";
import { agentLoopCall, noSelfChecks, type AgentLoopCallOptions } from "./agent-call.js";
import { runAgent, type AgentRunOptions } from "./run.js";
import { loopSettings } from "./settings.js";
import type { LoopCallInput } from "./types.js";

const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);

let claude: string;
beforeAll(async () => {
  claude = await fakeClaude();
});
afterAll(() => rm(path.dirname(claude), { recursive: true, force: true }));

let repo: string;
let runDir: string;
beforeEach(async () => {
  repo = await gitRepository({
    "package.json": "{}\n",
    "specs/badge.md": "---\nname: Badge\n---\n",
    "src/components/badge/Badge.vue": "<template />\n",
  });
  runDir = path.join(repo, ".fazon/runs/20261126T120000Z-badge-3f9a");
});
afterEach(() => rm(repo, { recursive: true, force: true }));

const log = async () =>
  JSON.parse(await readFile(path.join(runDir, "fake.json"), "utf8")) as { args: string[]; prompt: string };

function connection(env: Record<string, string>, overrides: Partial<AgentLoopCallOptions> = {}) {
  return agentLoopCall({
    repo,
    scope: { directory: "src/components/badge", patterns: ["*.vue", "*.ts", "*.css"] },
    selfChecks: { commands: ["pnpm exec vue-tsc --noEmit"], cacheDirectories: [] },
    prompt: (input) => `Iteration ${String(input.iteration)}; $${input.budgetUsd.toFixed(2)} left.`,
    command: claude,
    env: { PATH: process.env.PATH, FAKE_CLAUDE_LOG: path.join(runDir, "fake.json"), ...env },
    killGraceMs: 200,
    ...overrides,
  });
}

function input(overrides: Partial<LoopCallInput> = {}): LoopCallInput {
  return {
    runId: "20261126T120000Z-badge-3f9a",
    runDir,
    iteration: 1,
    model: "claude-sonnet-5-5",
    budgetUsd: 7.5,
    callMinutes: 20,
    transcript: "calls/1.jsonl",
    left: { iterations: 5, budgetUsd: 7.5, runMinutes: 90 },
    findings: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A propose run's options. */
function proposeRun(file: Partial<ConfigFile> = {}): AgentRunOptions {
  return {
    kind: "propose",
    id: "20261126T120000Z-badge-3f9a",
    runDir,
    component: "Badge",
    settings: loopSettings(resolveConfig({ fazon: 0, adapter: "vue", image, ...file }).config),
    versions: { framework: "0.0.0", adapter: "0.0.0", claudeCode: "2.1.332", image },
    proposal: "specs/badge.md",
  };
}

describe("the agent call as the loop's call", () => {
  it("passes the loop's model, effort, budget and call-time cap, and the prompt", async () => {
    const { call, results } = connection({});
    const result = await call(input({ effort: "high", iteration: 2 }));
    const { args, prompt } = await log();
    expect(prompt).toBe("Iteration 2; $7.50 left.");
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-sonnet-5-5", "--effort", "high"]));
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("7.5");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Edit,Write,Bash");
    expect(args).not.toContain("--json-schema");
    expect(results[0]?.call.transcript).toBe("calls/2.jsonl");
    expect(result).toEqual({
      end: "completed",
      tokens: { input: 11, output: 22, cacheRead: 300, cacheWrite: 40 },
      costUsd: 0.4321,
      costEstimated: false,
      filesChanged: [],
      violations: [],
      handEdits: [],
    });
  });

  it("maps the files the agent changed, inside and outside its paths", async () => {
    const { call } = connection({
      FAKE_CLAUDE_EDITS: JSON.stringify({
        "src/components/badge/Badge.vue": "<template><span /></template>\n",
        "package.json": "{ }\n",
      }),
    });
    const result = await call(input());
    expect(result.filesChanged).toEqual(["src/components/badge/Badge.vue"]);
    expect(result.violations).toEqual(["package.json"]);
  });

  it("records a person's changes between two calls as the second call's hand edits", async () => {
    const { call } = connection({});
    expect((await call(input())).handEdits).toEqual([]);
    await writeFile(path.join(repo, "src/components/badge/Badge.vue"), "<template><b /></template>\n");
    expect((await call(input({ iteration: 2 }))).handEdits).toEqual(["src/components/badge/Badge.vue"]);
    expect((await call(input({ iteration: 3 }))).handEdits).toEqual([]);
  });

  it("reads a FAZON-NEEDS line of the final message", async () => {
    const { call } = connection({ FAKE_CLAUDE_RESULT: "Stopped.\nFAZON-NEEDS dependency: date-fns\n" });
    expect((await call(input())).need).toEqual({ kind: "dependency", message: "date-fns" });
  });

  it("estimates the cost from the config's prices when Claude Code reports none", async () => {
    const { call } = connection(
      { FAKE_CLAUDE: "crash" },
      { prices: { "claude-sonnet-5-5": { input: 3, output: 15 } } },
    );
    const result = await call(input());
    expect(result.end).toBe("error");
    expect(result.costEstimated).toBe(true);
    expect(result.message).toMatch(/exited with code 2/);
  });

  it("ends at Claude Code's budget limit, and at the call-time cap", async () => {
    expect((await connection({ FAKE_CLAUDE: "budget" }).call(input())).end).toBe("budget");
    const started = Date.now();
    const timed = await connection({ FAKE_CLAUDE: "hang" }).call(input({ callMinutes: 0.005 }));
    expect(timed.end).toBe("call-time");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("a call that only reads, with an answer", () => {
  const answerSchema = { type: "object", properties: { props: { type: "object" } } };

  function reading(env: Record<string, string>, answer: AgentLoopCallOptions["answer"]) {
    return connection(env, {
      scope: { directory: "src/components/badge", patterns: [] },
      selfChecks: noSelfChecks,
      access: "read",
      jsonSchema: answerSchema,
      ...(answer === undefined ? {} : { answer }),
    });
  }

  it("has only the reading tools, the answer's schema, and settings that allow no edit or command", async () => {
    const { call } = reading({}, undefined);
    await call(input());
    const { args } = await log();
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "")).toEqual(answerSchema);
    const settings = JSON.parse(await readFile(path.join(runDir, "calls/1.settings.json"), "utf8")) as {
      permissions: { allow: string[]; deny: string[] };
      sandbox: { filesystem: { allowWrite: string[] } };
    };
    expect(settings.permissions.allow).toEqual(["Read", "Glob", "Grep"]);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Edit", "Bash"]));
    expect(settings.sandbox.filesystem.allowWrite).toEqual([]);
  });

  it("gives the answer the structured output and the final message", async () => {
    const seen: unknown[] = [];
    const { call } = reading(
      { FAKE_CLAUDE_STRUCTURED: '{"props":{}}', FAKE_CLAUDE_RESULT: "Here it is." },
      (result) => {
        seen.push(result.structuredOutput, result.finalText);
        return undefined;
      },
    );
    expect((await call(input())).end).toBe("completed");
    expect(seen).toEqual([{ props: {} }, "Here it is."]);
  });

  it("ends the call in error when the answer can't be used", async () => {
    const { call, returned } = reading({ FAKE_CLAUDE_RESULT: "No JSON here." }, () => "the answer has no API");
    const result = await call(input());
    expect(result).toMatchObject({ end: "error", message: "the answer has no API" });
    expect(returned).toEqual([result]);
  });

  it("makes any file the call changes a violation, and doesn't read the answer then", async () => {
    let asked = false;
    const { call } = reading({ FAKE_CLAUDE_EDITS: JSON.stringify({ "specs/badge.md": "changed\n" }) }, () => {
      asked = true;
      return undefined;
    });
    const result = await call(input());
    expect(result).toMatchObject({ end: "completed", violations: ["specs/badge.md"], filesChanged: [] });
    expect(asked).toBe(false);
  });
});

describe("a propose run through the loop", () => {
  it("passes with its one call, and records the call and the proposal", async () => {
    const { call } = connection(
      { FAKE_CLAUDE_STRUCTURED: '{"props":{}}' },
      { access: "read", answer: () => undefined },
    );
    const outcome = await runAgent(proposeRun(), { call });
    expect(outcome.record).toMatchObject({
      kind: "propose",
      status: "passed",
      proposal: { path: "specs/badge.md" },
      iterations: [{ n: 1, outcome: "pass", call: { end: "completed", costUsd: 0.4321 } }],
      totals: { iterations: 1, costUsd: 0.4321 },
    });
    expect(runRecordProblems(outcome.record)).toEqual([]);
    expect(await readRunRecord(runDir)).toEqual(outcome.record);
  });

  it("needs a person when the answer can't be used: its one call is spent", async () => {
    const { call } = connection({}, { access: "read", answer: () => "no API" });
    const outcome = await runAgent(proposeRun(), { call });
    expect(outcome.record).toMatchObject({ status: "needs-a-person", reason: "iterations" });
    expect(outcome.record.iterations[0]?.call.end).toBe("error");
  });

  it("needs a person at the budget limit, with the reason budget", async () => {
    const { call } = connection({ FAKE_CLAUDE: "budget" }, { access: "read" });
    const outcome = await runAgent(proposeRun({ loop: { budgetUsd: 0.5 } }), { call });
    expect(outcome.record).toMatchObject({ status: "needs-a-person", reason: "budget" });
  });

  it("needs a person at the call-time cap", async () => {
    const { call } = connection({ FAKE_CLAUDE: "hang" }, { access: "read" });
    const outcome = await runAgent(proposeRun({ loop: { callMinutes: 0.005 } }), { call });
    expect(outcome.record).toMatchObject({ status: "needs-a-person", reason: "iterations" });
    expect(outcome.record.iterations[0]?.call.end).toBe("call-time");
  });
});
