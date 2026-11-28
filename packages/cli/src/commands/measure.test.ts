// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon measure`: the round's order, stages and stops with fake runs (`measureRound`), and the
// command's refusals with a fake machine and real git.
import { execFile } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RunRecord } from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureJson,
  copyExample,
  gitInit,
  libraryConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";
import { measureRound, type MeasureDependencies, type MeasureStep } from "./measure.js";

const git = promisify(execFile);

/** A completed measured run's record, with what the round reads. */
function record(
  step: MeasureStep & { readonly specName: string },
  costUsd: number,
  extra: Partial<RunRecord> = {},
  totals: Partial<RunRecord["totals"]> = {},
): RunRecord {
  return {
    id: `${step.component}-${String(step.repeat)}-${step.kind}`,
    kind: step.kind,
    component: step.specName,
    status: "passed",
    started: "2026-11-28T10:00:00Z",
    ended: "2026-11-28T10:01:00Z",
    measurement: { round: 1, repeat: step.repeat },
    totals: { iterations: 1, agentCostUsd: costUsd, judgeCostUsd: 0, costUsd, escalated: false, ...totals },
    ...extra,
  } as RunRecord;
}

const components = [
  { name: "button", specName: "Button" },
  { name: "badge", specName: "Badge" },
];
const specName = (name: string) => components.find((c) => c.name === name)?.specName ?? name;

/** Fake runs costing `cost(step)`, which log each step and each restore. */
function fakes(
  cost: (step: MeasureStep) => number = () => 1,
  shape: (step: MeasureStep) => { extra?: Partial<RunRecord>; totals?: Partial<RunRecord["totals"]> } = () => ({}),
): { dependencies: MeasureDependencies; log: string[] } {
  const log: string[] = [];
  return {
    log,
    dependencies: {
      run: (step) => {
        log.push(`${step.component} ${String(step.repeat)} ${step.kind}`);
        const { extra, totals } = shape(step);
        return Promise.resolve({
          record: record({ ...step, specName: specName(step.component) }, cost(step), extra, totals),
        });
      },
      restore: () => {
        log.push("restore");
        return Promise.resolve(undefined);
      },
      progress: () => undefined,
    },
  };
}

const base = { round: 1, components, capUsd: 10, earlier: [] as RunRecord[] };

describe("measureRound", () => {
  it("runs every component's repeat 1 first, propose before generate, restoring after each run", async () => {
    const { dependencies, log } = fakes();
    const ended = await measureRound({ ...base, repeats: 2, budgetUsd: 100, dependencies });
    expect(ended.kind).toBe("done");
    expect(log.filter((line) => line !== "restore")).toEqual([
      "button 1 propose",
      "button 1 generate",
      "badge 1 propose",
      "badge 1 generate",
      "button 2 propose",
      "button 2 generate",
      "badge 2 propose",
      "badge 2 generate",
    ]);
    expect(log.filter((line) => line === "restore")).toHaveLength(8);
    expect(ended.spentUsd).toBe(8);
    expect(ended.records).toHaveLength(8);
  });

  it("stops after repeat 1 when the estimate for the rest doesn't fit the budget", async () => {
    // Each repeat costs $2 for Button and $4 for Badge: $6 spent, then 4 more repeats estimated at $24.
    const { dependencies, log } = fakes((step) => (step.component === "button" ? 1 : 2));
    const ended = await measureRound({ ...base, repeats: 5, budgetUsd: 25, dependencies });
    expect(ended).toMatchObject({ kind: "over-budget", spentUsd: 6, estimateUsd: 24 });
    expect(log.filter((line) => line !== "restore")).toHaveLength(4);
  });

  it("doesn't start a component's first repeat when its cost cap no longer fits", async () => {
    const { dependencies, log } = fakes(() => 3);
    const ended = await measureRound({ ...base, repeats: 1, budgetUsd: 12, dependencies });
    // Button's repeat cost $6; Badge's estimate is the $10 cap, past the $6 left.
    expect(ended).toMatchObject({ kind: "over-budget", spentUsd: 6, estimateUsd: 10 });
    expect(log.filter((line) => line !== "restore")).toEqual(["button 1 propose", "button 1 generate"]);
  });

  it("stops at once when a run's cost was estimated, because no API key paid for it", async () => {
    const { dependencies, log } = fakes(undefined, () => ({ totals: { costEstimated: true } }));
    const ended = await measureRound({ ...base, repeats: 1, budgetUsd: 100, dependencies });
    expect(ended).toMatchObject({ kind: "stopped", why: "estimated" });
    expect(ended.kind === "stopped" ? ended.message : "").toContain("ANTHROPIC_API_KEY");
    expect(log).toEqual(["button 1 propose", "restore"]);
  });

  it("stops when a run was interrupted, or when the checkout can't be restored", async () => {
    const interrupted = fakes(undefined, (step) => (step.kind === "generate" ? { extra: { status: "stopped" } } : {}));
    expect(
      await measureRound({ ...base, repeats: 1, budgetUsd: 100, dependencies: interrupted.dependencies }),
    ).toMatchObject({
      kind: "stopped",
      why: "interrupted",
    });

    const dirty = fakes();
    const ended = await measureRound({
      ...base,
      repeats: 1,
      budgetUsd: 100,
      dependencies: { ...dirty.dependencies, restore: () => Promise.resolve("src/other.ts changed") },
    });
    expect(ended).toMatchObject({ kind: "stopped", why: "restore", message: "src/other.ts changed" });
  });

  it("ends with the outcome of a run that couldn't start", async () => {
    const { dependencies } = fakes();
    const stop = { status: "refused" as const, messages: [{ level: "error" as const, text: "not approved" }] };
    const ended = await measureRound({
      ...base,
      repeats: 1,
      budgetUsd: 100,
      dependencies: { ...dependencies, run: () => Promise.resolve({ stop }) },
    });
    expect(ended).toMatchObject({ kind: "stopped", why: "run", outcome: stop });
  });

  it("keeps an earlier invocation's runs, skips them, and estimates from their cost without counting it as spent", async () => {
    const earlier = (["propose", "generate"] as const).flatMap((kind) =>
      components.map((c) => record({ component: c.name, specName: c.specName, repeat: 1, kind }, 5)),
    );
    const { dependencies, log } = fakes(() => 5);
    // Two repeats with $10 each are estimated at $20 against a $19 budget.
    const over = await measureRound({ ...base, repeats: 2, budgetUsd: 19, earlier, dependencies });
    expect(over).toMatchObject({ kind: "over-budget", spentUsd: 0, estimateUsd: 20 });
    expect(log).toEqual([]);

    const ended = await measureRound({ ...base, repeats: 2, budgetUsd: 20, earlier, dependencies });
    expect(ended).toMatchObject({ kind: "done", spentUsd: 20 });
    expect(ended.records).toHaveLength(8);
    expect(log.find((line) => line !== "restore")).toBe("button 2 propose");
  });
});

describe("fazon measure", () => {
  let root: string;
  beforeEach(async () => {
    root = await repository({ "fazon.yaml": libraryConfig });
    await copyExample(root, "valid/button.md", "specs/button.md");
    await gitInit(root);
  });
  afterEach(() => removeRepository(root));

  const machine = (env: Record<string, string> = { ANTHROPIC_API_KEY: "test-key" }): FakeMachine => ({
    cwd: root,
    env,
    handle: (program, args, options) => {
      if (program !== "git") return undefined;
      return git("git", [...args], { cwd: options?.cwd ?? root }).then(
        ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
        (error: unknown) => ({ exitCode: 1, stdout: "", stderr: String(error) }),
      );
    },
  });

  it("refuses a round the protocol doesn't define, and a round without a budget", async () => {
    const wrong = await captureJson(["measure", "--round", "3", "--budget", "50"], machine());
    expect(wrong.code).toBe(2);
    expect(JSON.stringify(wrong.json.messages)).toContain("--round must be 1 or 2");

    const unbudgeted = await captureJson(["measure", "--round", "1"], machine());
    expect(unbudgeted.code).toBe(2);
    expect(JSON.stringify(unbudgeted.json.messages)).toContain("--budget");
  });

  it("refuses without an API key", async () => {
    const { code, json } = await captureJson(["measure", "--round", "1", "--budget", "50"], machine({}));
    expect(code).toBe(2);
    expect(JSON.stringify(json.messages)).toContain("need an API key");
  });

  it("refuses with a local config, and with uncommitted changes", async () => {
    await writeFile(path.join(root, "fazon.local.yaml"), "fazon: 0\n");
    const local = await captureJson(["measure", "--round", "1", "--budget", "50"], machine());
    expect(local.code).toBe(2);
    expect(JSON.stringify(local.json.messages)).toContain("runs without fazon.local.yaml");

    await unlink(path.join(root, "fazon.local.yaml"));
    // A staged file is an uncommitted change.
    await git("git", ["add", "fazon.yaml"], { cwd: root });
    const dirty = await captureJson(["measure", "--round", "1", "--budget", "50"], machine());
    expect(dirty.code).toBe(2);
    expect(JSON.stringify(dirty.json.messages)).toContain("clean checkout");
  });

  it("refuses components outside the round, and round components without a spec", async () => {
    const outside = await captureJson(["measure", "--round", "1", "--budget", "50", "avatar"], machine());
    expect(outside.code).toBe(2);
    expect(JSON.stringify(outside.json.messages)).toContain("avatar isn't in it");

    const absent = await captureJson(["measure", "--round", "1", "--budget", "50"], machine());
    expect(absent.code).toBe(2);
    expect(JSON.stringify(absent.json.messages)).toContain("badge, link, dialog");
  });
});
