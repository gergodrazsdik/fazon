// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckFinding, CheckId } from "../checks/types.js";
import { resolveConfig } from "../config/load.js";
import type { ConfigFile } from "../config/types.js";
import {
  runRecordProblems,
  type CheckResult,
  type JudgeSummary,
  type RunInputs,
  type RunRecord,
} from "../records/run-record.js";
import { lastFindings, runAgent, type AgentRunOptions } from "./run.js";
import { loopSettings, type LoopSettings } from "./settings.js";
import type { LoopCallInput, LoopCallResult, ChecksInput, JudgeInput, LoopDependencies } from "./types.js";

const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const checkIds: readonly CheckId[] = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"];

function settings(file: Partial<ConfigFile> = {}): LoopSettings {
  return loopSettings(resolveConfig({ fazon: 0, adapter: "vue", image, ...file }).config);
}

/** Every check passes, with the given results in place of their check's. */
function checks(...overrides: CheckResult[]): CheckResult[] {
  return checkIds.map(
    (check) => overrides.find((o) => o.check === check) ?? { check, status: "pass", durationSeconds: 1, findings: [] },
  );
}

function finding(check: CheckId, rule: string, extra: Partial<CheckFinding> = {}): CheckFinding {
  return { check, rule, message: `${check}/${rule} found something.`, blocking: true, ...extra };
}

/** A failing check with one finding. */
function failing(check: CheckId, rule: string, extra: Partial<CheckFinding> = {}): CheckResult {
  return { check, status: "fail", durationSeconds: 1, findings: [finding(check, rule, extra)] };
}

function errored(check: CheckId): CheckResult {
  return { check, status: "error", durationSeconds: 1, message: `${check} couldn't run.`, findings: [] };
}

type ScriptedCall = Partial<LoopCallResult> & {
  /** Minutes the call takes on the fake clock; 5 by default. */
  readonly minutes?: number;
  /** Aborts the run's signal during the call. */
  readonly interrupt?: boolean;
};

interface Harness {
  readonly dependencies: LoopDependencies;
  readonly calls: LoopCallInput[];
  readonly checkPhases: ChecksInput[];
  readonly judged: JudgeInput[];
  readonly written: RunRecord[];
  readonly controller: AbortController;
  /** Minutes since the run started on the fake clock. */
  readonly minutes: () => number;
}

/**
 * Fakes for every dependency: a clock that only moves when a call (5 minutes by default) or a
 * check phase (2 minutes) runs, scripted call results and check phases (every check passes once
 * the script runs out), and a writer that checks each record against the schema.
 */
function harness(
  script: {
    calls?: ScriptedCall[];
    phases?: CheckResult[][];
    judge?: (JudgeSummary | undefined)[];
    inputs?: RunInputs[];
    refresh?: () => void;
  } = {},
): Harness {
  const start = Date.parse("2026-11-26T10:00:00Z");
  let time = start;
  const calls: LoopCallInput[] = [];
  const checkPhases: ChecksInput[] = [];
  const judged: JudgeInput[] = [];
  const written: RunRecord[] = [];
  const controller = new AbortController();
  const inputs = [...(script.inputs ?? [])];
  const dependencies: LoopDependencies = {
    now: () => new Date(time),
    signal: controller.signal,
    call: (input) => {
      calls.push(input);
      const scripted = script.calls?.[calls.length - 1] ?? {};
      time += (scripted.minutes ?? 5) * 60_000;
      if (scripted.interrupt === true) controller.abort();
      return Promise.resolve({
        end: "completed",
        tokens: { input: 1000, cacheRead: 5000, output: 100 },
        costUsd: 1,
        costEstimated: false,
        filesChanged: ["src/components/button/Button.vue"],
        violations: [],
        handEdits: [],
        ...scripted,
      });
    },
    checks: (input) => {
      checkPhases.push(input);
      time += 2 * 60_000;
      return Promise.resolve({
        checks: script.phases?.[checkPhases.length - 1] ?? checks(),
        captures: input.captures,
      });
    },
    refreshGenerated: () => {
      script.refresh?.();
      return Promise.resolve();
    },
    judge: (input) => {
      judged.push(input);
      return Promise.resolve(script.judge?.[judged.length - 1]);
    },
    ...(script.inputs === undefined
      ? {}
      : { inputs: () => Promise.resolve(inputs.length > 1 ? (inputs.shift() ?? {}) : (inputs[0] ?? {})) }),
    writeRecord: (record) => {
      expect(runRecordProblems(record)).toEqual([]);
      written.push(record);
      return Promise.resolve();
    },
  };
  return { dependencies, calls, checkPhases, judged, written, controller, minutes: () => (time - start) / 60_000 };
}

function options(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    kind: "generate",
    id: "20261126T100000Z-button-3f9a",
    runDir: "/repo/.fazon/runs/20261126T100000Z-button-3f9a",
    component: "Button",
    settings: settings(),
    versions: { framework: "0.1.0", adapter: "0.1.0", claudeCode: "2.1.332", image },
    ...overrides,
  };
}

/** A copy of an object without one of its optional members. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("a generate run", () => {
  it("passes with its first passing iteration, and records the call and its checks (LOOP-005)", async () => {
    const h = harness({ inputs: [{ spec: hash("a"), api: hash("b") }] });
    let refreshed = 0;
    const outcome = await runAgent(options(), {
      ...h.dependencies,
      refreshGenerated: () => {
        refreshed += 1;
        return Promise.resolve();
      },
    });
    const { record } = outcome;
    expect(refreshed).toBe(1);
    expect(record).toMatchObject({
      kind: "generate",
      component: "Button",
      status: "passed",
      started: "2026-11-26T10:00:00Z",
      ended: "2026-11-26T10:07:00Z",
      inputs: { spec: hash("a"), api: hash("b") },
      config: { caps: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20 }, escalateAfter: 2 },
      handEdits: [],
      totals: {
        iterations: 1,
        agentCostUsd: 1,
        judgeCostUsd: 0,
        costUsd: 1,
        costEstimated: false,
        tokens: { input: 1000, cacheRead: 5000, output: 100 },
        durationSeconds: 420,
        escalated: false,
      },
    });
    expect(record).not.toHaveProperty("reason");
    expect(record.totals).not.toHaveProperty("overrunUsd");
    expect(record.iterations).toEqual([
      {
        n: 1,
        call: {
          model: "claude-sonnet-5-5",
          started: "2026-11-26T10:00:00Z",
          durationSeconds: 300,
          end: "completed",
          tokens: { input: 1000, cacheRead: 5000, output: 100 },
          costUsd: 1,
          costEstimated: false,
          transcript: "calls/1.jsonl",
          filesChanged: ["src/components/button/Button.vue"],
        },
        violations: [],
        verification: { checks: checks(), captures: "captures/1" },
        outcome: "pass",
      },
    ]);
    expect(h.calls[0]).toMatchObject({
      iteration: 1,
      model: "claude-sonnet-5-5",
      budgetUsd: 10,
      callMinutes: 20,
      transcript: "calls/1.jsonl",
      left: { iterations: 5, budgetUsd: 10, runMinutes: 90 },
      findings: [],
    });
    expect(h.calls[0]).not.toHaveProperty("effort");
    expect(h.checkPhases).toMatchObject([{ iteration: 1, captures: "captures/1" }]);
    expect(outcome.findings).toEqual([]);
  });

  it("is rewritten after the start, each call, each check phase and the end (ADR 0013)", async () => {
    const h = harness({ phases: [checks(failing("lint", "raw-value"))] });
    await runAgent(options(), h.dependencies);
    expect(h.written.map((r) => [r.status, r.iterations.map((i) => i.outcome).join(",")])).toEqual([
      ["running", ""],
      ["running", "stopped"], // after call 1: its outcome isn't known yet
      ["running", "stopped"], // after its checks
      ["running", "fail"],
      ["running", "fail,stopped"], // after call 2
      ["running", "fail,stopped"],
      ["passed", "fail,pass"],
    ]);
    expect(h.written[1]?.iterations[0]).not.toHaveProperty("verification");
  });

  it("writes run.json into the run's directory by default, valid against the schema (RECORD-001)", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-loop-"));
    const h = harness();
    const outcome = await runAgent(options({ runDir: root }), without(h.dependencies, "writeRecord"));
    const onDisk = JSON.parse(await readFile(path.join(root, "run.json"), "utf8")) as unknown;
    expect(onDisk).toEqual(outcome.record);
    expect(runRecordProblems(onDisk)).toEqual([]);
  });

  it("escalates after the configured failed iterations, and records each call's model and effort (LOOP-003)", async () => {
    const h = harness({
      phases: [checks(failing("lint", "raw-value")), checks(failing("layout", "target-size"))],
    });
    const run = options({ settings: settings({ effort: { escalation: "high" } }) });
    const { record } = await runAgent(run, h.dependencies);
    expect(record.status).toBe("passed");
    expect(record.iterations.map((i) => [i.call.model, i.call.effort, i.outcome])).toEqual([
      ["claude-sonnet-5-5", undefined, "fail"],
      ["claude-sonnet-5-5", undefined, "fail"],
      ["claude-opus-5-5", "high", "pass"],
    ]);
    expect(h.calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(h.calls[2]?.effort).toBe("high");
    expect(record.totals.escalated).toBe(true);
    // Each prompt gets the previous iteration's blocking findings.
    expect(h.calls.map((c) => c.findings.map((f) => f.rule))).toEqual([[], ["raw-value"], ["target-size"]]);
    expect(h.calls[1]?.previous?.outcome).toBe("fail");
  });

  it("escalates after a different threshold when the config sets one", async () => {
    const h = harness({ phases: [checks(failing("lint", "raw-value"))] });
    const { record } = await runAgent(options({ settings: settings({ loop: { escalateAfter: 1 } }) }), h.dependencies);
    expect(record.iterations.map((i) => i.call.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
  });

  it("ends as needs a person at the iteration cap, with the last iteration's findings (LOOP-001)", async () => {
    const lint = checks(failing("lint", "raw-value"));
    const h = harness({ phases: [lint, lint, lint, lint, lint] });
    const outcome = await runAgent(options(), h.dependencies);
    expect(outcome.record).toMatchObject({ status: "needs-a-person", reason: "iterations" });
    expect(h.calls).toHaveLength(5);
    expect(h.calls.map((c) => c.left.iterations)).toEqual([5, 4, 3, 2, 1]);
    expect(outcome.findings.map((f) => f.rule)).toEqual(["raw-value"]);
  });

  it("gives each call the budget left as its limit, stops at the budget cap and records the overrun", async () => {
    const lint = checks(failing("lint", "raw-value"));
    const h = harness({
      calls: [{ costUsd: 4 }, { costUsd: 4 }, { costUsd: 4.5 }],
      phases: [lint, lint, lint],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(h.calls.map((c) => c.budgetUsd)).toEqual([10, 6, 2]);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "budget" });
    expect(record.totals).toMatchObject({ iterations: 3, agentCostUsd: 12.5, costUsd: 12.5, overrunUsd: 2.5 });
  });

  it("starts no call once the budget is spent exactly", async () => {
    const h = harness({ calls: [{ costUsd: 10 }], phases: [checks(failing("lint", "raw-value"))] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(h.calls).toHaveLength(1);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "budget" });
    expect(record.totals).not.toHaveProperty("overrunUsd");
  });

  it("checks the run-time cap before each call", async () => {
    const lint = checks(failing("lint", "raw-value"));
    // 43-minute calls and 2-minute check phases: 90 minutes after two iterations.
    const h = harness({ calls: [{ minutes: 43 }, { minutes: 43 }], phases: [lint, lint] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(h.calls.map((c) => c.left.runMinutes)).toEqual([90, 45]);
    expect(h.calls).toHaveLength(2);
    expect(h.checkPhases).toHaveLength(2);
    expect(h.minutes()).toBe(90);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "run-time" });
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "fail"]);
  });

  it("checks the run-time cap before each check phase: the iteration is stopped unchecked", async () => {
    const h = harness({ calls: [{ minutes: 95 }] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(h.checkPhases).toHaveLength(0);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "run-time" });
    expect(record.iterations[0]).toMatchObject({ outcome: "stopped" });
    expect(record.iterations[0]).not.toHaveProperty("verification");
  });

  it("fails an iteration whose call hit the call-time cap, without checks, and goes on (LOOP-002)", async () => {
    const h = harness({
      calls: [
        { end: "call-time", minutes: 20 },
        { end: "error", message: "Claude Code exited 1" },
      ],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.status).toBe("passed");
    expect(record.iterations.map((i) => [i.call.end, i.outcome, i.verification === undefined])).toEqual([
      ["call-time", "fail", true],
      ["error", "fail", true],
      ["completed", "pass", false],
    ]);
    expect(h.checkPhases.map((p) => p.iteration)).toEqual([3]);
    // Failed calls count toward escalation.
    expect(record.iterations[2]?.call.model).toBe("claude-opus-5-5");
    expect(h.calls[1]?.previous?.call.end).toBe("call-time");
  });

  it("ends as needs a person on a permission violation, without checks (PERM-002)", async () => {
    const h = harness({ calls: [{ violations: ["package.json", "src/index.ts"] }] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "violation" });
    expect(record.iterations[0]).toMatchObject({ violations: ["package.json", "src/index.ts"], outcome: "fail" });
    expect(h.checkPhases).toHaveLength(0);
  });

  it.each([
    ["dependency", "date-fns for the calendar grid"],
    ["shared-code", "a focus-trap helper in src/shared"],
  ] as const)("ends as needs a person when the agent needs %s", async (kind, message) => {
    const h = harness({ calls: [{ need: { kind, message } }] });
    const outcome = await runAgent(options(), h.dependencies);
    expect(outcome.record).toMatchObject({ status: "needs-a-person", reason: kind });
    expect(outcome.need).toEqual({ kind, message });
    expect(h.checkPhases).toHaveLength(0);
  });

  it("ends as needs a person when the same check ends in error in two check phases in a row", async () => {
    const h = harness({
      calls: [{}, { end: "call-time" }],
      phases: [checks(errored("a11y")), checks(errored("a11y"))],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "check-error" });
    // An unchecked iteration in between doesn't break the row.
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "fail", "fail"]);
  });

  it("goes on when different checks end in error, or an error isn't repeated", async () => {
    const h = harness({ phases: [checks(errored("a11y")), checks(errored("build")), checks()] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.status).toBe("passed");
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "fail", "pass"]);
  });

  it("fails an iteration with a skipped check", async () => {
    const skipped: CheckResult = { check: "visual", status: "skipped", durationSeconds: 0, findings: [] };
    const h = harness({ phases: [checks(skipped)] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "pass"]);
  });

  it("is stopped when the developer interrupts it, keeping the record", async () => {
    const h = harness({ calls: [{}, { interrupt: true }], phases: [checks(failing("lint", "raw-value"))] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.status).toBe("stopped");
    expect(record).not.toHaveProperty("reason");
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "stopped"]);
    expect(record.totals.costUsd).toBe(2);
    expect(h.checkPhases).toHaveLength(1);

    const before = harness();
    before.controller.abort();
    const early = await runAgent(options(), before.dependencies);
    expect(early.record).toMatchObject({ status: "stopped", iterations: [] });
    expect(before.calls).toHaveLength(0);
  });

  it("is stopped when interrupted during a check phase", async () => {
    const h = harness();
    const stopping: LoopDependencies = {
      ...h.dependencies,
      checks: (input) => {
        h.controller.abort();
        return Promise.resolve({ checks: checks(), captures: input.captures });
      },
    };
    const { record } = await runAgent(options(), stopping);
    expect(record.status).toBe("stopped");
    expect(record.iterations[0]?.outcome).toBe("stopped");
    expect(record.iterations[0]?.verification?.checks).toHaveLength(8);
  });
});

describe("the spec's example", () => {
  it("comes out with the example record's iterations, models and totals", async () => {
    const examplePath = new URL("../../../../docs/spec/examples/records/run.json", import.meta.url);
    const example = JSON.parse(await readFile(examplePath, "utf8")) as RunRecord;
    const [one, two, three] = example.iterations;
    if (one === undefined || two === undefined || three === undefined) throw new Error("the example has 3 iterations");
    const h = harness({
      calls: example.iterations.map((i) => ({ costUsd: i.call.costUsd, tokens: i.call.tokens })),
      phases: [
        [...(one.verification?.checks ?? [])],
        [...(two.verification?.checks ?? [])],
        [...(three.verification?.checks ?? [])],
      ],
      judge: [three.verification?.judge],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.status).toBe(example.status);
    expect(record.iterations.map((i) => [i.call.model, i.outcome])).toEqual(
      example.iterations.map((i) => [i.call.model, i.outcome]),
    );
    expect(without(record.totals, "durationSeconds")).toEqual(without(example.totals, "durationSeconds"));
  });
});

describe("what blocks", () => {
  it("doesn't block on the component's own visual diffs; they stay in the record, not blocking", async () => {
    const own = failing("visual", "changed", { story: "button--label--default", theme: "light" });
    const h = harness({ phases: [checks(own)] });
    const outcome = await runAgent(options(), h.dependencies);
    expect(outcome.record.status).toBe("passed");
    const visual = outcome.record.iterations[0]?.verification?.checks.find((c) => c.check === "visual");
    expect(visual?.findings).toEqual([{ ...own.findings[0], blocking: false }]);
  });

  it("blocks on another component's visual diffs, and on orphans only when they aren't the component's", async () => {
    const other = failing("visual", "changed", { story: "badge--default", theme: "light" });
    const orphan: CheckResult = {
      check: "visual",
      status: "fail",
      durationSeconds: 1,
      findings: [
        finding("visual", "orphan", { file: "light/button/old.png" }),
        finding("visual", "orphan", { file: "light/button-group/old.png" }),
      ],
    };
    const h = harness({ phases: [checks(other), checks(orphan)] });
    const outcome = await runAgent(options(), h.dependencies);
    expect(outcome.record.iterations.map((i) => i.outcome)).toEqual(["fail", "fail", "pass"]);
    expect(h.calls[1]?.findings).toEqual(other.findings);
    expect(h.calls[2]?.findings.map((f) => f.file)).toEqual(["light/button-group/old.png"]);
  });

  it("doesn't block on a finding an exemption waived", async () => {
    const waived = failing("a11y", "color-contrast", { exempt: 0, blocking: false });
    const h = harness({ phases: [checks(waived)] });
    expect((await runAgent(options(), h.dependencies)).record.status).toBe("passed");
  });
});

describe("the judge hook", () => {
  const summary = (fail: number, blocking: boolean): JudgeSummary => ({
    calls: 3,
    costUsd: 0.5,
    tokens: { input: 200, output: 20 },
    stories: { pass: 10, fail, unsure: 0, notJudged: 0 },
    blocking,
    results: "judge/1.json",
  });

  it("isn't called while the judge's policy is off", async () => {
    const h = harness();
    await runAgent(options({ settings: settings({ judge: { policy: "off" } }) }), h.dependencies);
    expect(h.judged).toHaveLength(0);
  });

  it("is a no-op by default, and is called only when the checks pass", async () => {
    const h = harness({ phases: [checks(failing("lint", "raw-value"))] });
    const { record } = await runAgent(options(), without(h.dependencies, "judge"));
    expect(record.status).toBe("passed");
    expect(record.iterations[1]?.verification).not.toHaveProperty("judge");

    const judged = harness({ phases: [checks(failing("lint", "raw-value"))] });
    await runAgent(options(), judged.dependencies);
    expect(judged.judged.map((j) => j.iteration)).toEqual([2]);
  });

  it("counts the judge's cost toward the budget; an uncalibrated fail doesn't block, a blocking one does", async () => {
    const h = harness({ judge: [summary(2, true), summary(1, false)] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.iterations.map((i) => i.outcome)).toEqual(["fail", "pass"]);
    expect(record.iterations[1]?.verification?.judge).toEqual(summary(1, false));
    expect(record.totals).toMatchObject({
      agentCostUsd: 2,
      judgeCostUsd: 1,
      costUsd: 3,
      tokens: { input: 2400, cacheRead: 10000, output: 240 },
    });
    expect(h.judged.map((j) => j.budgetUsd)).toEqual([9, 7.5]);
    expect(h.calls[1]?.budgetUsd).toBe(8.5);
  });
});

describe("inputs, hand edits and cost", () => {
  it("doesn't pass when the spec, checks or config changed since the start (LOOP-004)", async () => {
    const h = harness({
      inputs: [
        { spec: hash("a"), config: hash("c") },
        { spec: hash("d"), config: hash("c") },
      ],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record).toMatchObject({ status: "needs-a-person", reason: "inputs-changed", inputs: { spec: hash("a") } });
    expect(record.iterations[0]?.outcome).toBe("pass");
  });

  it("records a person's changes between calls as hand edits, by the iteration they followed (PERM-005)", async () => {
    const lint = checks(failing("lint", "raw-value"));
    const h = harness({
      calls: [
        { handEdits: ["ignored-before-the-first-call.ts"] },
        {},
        { handEdits: ["src/components/button/Button.vue"] },
      ],
      phases: [lint, lint],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.handEdits).toEqual([{ after: 2, files: ["src/components/button/Button.vue"] }]);
  });

  it("marks the cost as estimated when any call's was", async () => {
    const h = harness({ calls: [{ costEstimated: true }], phases: [checks(failing("lint", "raw-value"))] });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.totals.costEstimated).toBe(true);
    expect(record.iterations.map((i) => i.call.costEstimated)).toEqual([true, false]);
  });

  it("sums costs without float noise", async () => {
    const h = harness({
      calls: [{ costUsd: 1.1 }, { costUsd: 0.95 }],
      phases: [checks(failing("lint", "raw-value"))],
    });
    const { record } = await runAgent(options(), h.dependencies);
    expect(record.totals.costUsd).toBe(2.05);
  });
});

describe("a feedback run", () => {
  it("is linked to its parent, carries the feedback and the parent's findings, and starts fresh on the generator", async () => {
    const parentFindings = [finding("layout", "target-size")];
    const h = harness({ phases: [checks(failing("lint", "raw-value"))] });
    const run = options({
      kind: "feedback",
      id: "20261126T110000Z-button-0b1c",
      feedback: {
        parent: "20261126T100000Z-button-3f9a",
        text: "Make the focus ring thicker.",
        findings: parentFindings,
      },
    });
    const { record } = await runAgent(run, h.dependencies);
    expect(record).toMatchObject({ kind: "feedback", parent: "20261126T100000Z-button-3f9a", status: "passed" });
    expect(h.calls[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      feedback: "Make the focus ring thicker.",
      findings: parentFindings,
      left: { iterations: 5, budgetUsd: 10 },
    });
    expect(h.calls[1]).not.toHaveProperty("feedback");
    expect(h.calls[1]?.findings.map((f) => f.rule)).toEqual(["raw-value"]);
  });

  it("takes its parent's last findings from the parent's record", async () => {
    const h = harness({
      calls: [{}, {}, { end: "call-time" }],
      phases: [checks(failing("lint", "raw-value")), checks(failing("layout", "target-size", { blocking: true }))],
    });
    const { record } = await runAgent(options({ settings: settings({ loop: { iterations: 3 } }) }), h.dependencies);
    expect(record.reason).toBe("iterations");
    expect(lastFindings(record).map((f) => f.rule)).toEqual(["target-size"]);
    const passed = await runAgent(options(), harness().dependencies);
    expect(lastFindings(passed.record)).toEqual([]);
  });
});

describe("a propose run", () => {
  const propose = options({ kind: "propose", id: "20261126T090000Z-button-aaaa", proposal: "specs/button.md" });

  it("makes one call, runs no checks and passes with the proposal", async () => {
    let refreshed = false;
    const h = harness({ refresh: () => (refreshed = true) });
    const { record } = await runAgent(propose, h.dependencies);
    expect(record).toMatchObject({ kind: "propose", status: "passed", proposal: { path: "specs/button.md" } });
    expect(record.iterations).toHaveLength(1);
    expect(record.iterations[0]).not.toHaveProperty("verification");
    expect(h.checkPhases).toHaveLength(0);
    expect(refreshed).toBe(false);
    expect(h.calls[0]).toMatchObject({ left: { iterations: 1 }, budgetUsd: 10, callMinutes: 20 });
  });

  it.each([
    ["call-time", "iterations"],
    ["error", "iterations"],
    ["budget", "budget"],
  ] as const)("needs a person when its call ends %s", async (end, reason) => {
    const h = harness({ calls: [{ end }] });
    const { record } = await runAgent(propose, h.dependencies);
    expect(record).toMatchObject({ status: "needs-a-person", reason });
    expect(record).not.toHaveProperty("proposal");
    expect(h.calls).toHaveLength(1);
  });

  it("needs a person on a violation", async () => {
    const h = harness({ calls: [{ violations: ["src/index.ts"] }] });
    expect((await runAgent(propose, h.dependencies)).record).toMatchObject({ reason: "violation" });
  });
});

describe("options", () => {
  it("refuse a run that doesn't fit its kind", async () => {
    const h = harness();
    await expect(runAgent(options({ kind: "feedback" }), h.dependencies)).rejects.toThrow(/feedback/);
    await expect(
      runAgent(
        options({ feedback: { parent: "20261126T100000Z-button-3f9a", text: "x", findings: [] } }),
        h.dependencies,
      ),
    ).rejects.toThrow(/feedback/);
    await expect(runAgent(options({ kind: "propose" }), h.dependencies)).rejects.toThrow(/proposes/);
    await expect(runAgent(options(), without(h.dependencies, "checks"))).rejects.toThrow(/checks phase/);
    expect(h.written).toHaveLength(0);
  });
});
