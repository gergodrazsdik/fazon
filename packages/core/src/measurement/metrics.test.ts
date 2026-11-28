// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../records/run-record.js";
import { loopMetrics, roundMetrics, spread } from "./metrics.js";

/** A measured run's record, with only what the metrics read. */
function run(
  kind: "generate" | "propose",
  component: string,
  status: RunRecord["status"],
  totals: Partial<RunRecord["totals"]> = {},
  reason?: RunRecord["reason"],
): RunRecord {
  return {
    kind,
    component,
    status,
    ...(reason === undefined ? {} : { reason }),
    started: "2026-11-28T10:00:00Z",
    ended: "2026-11-28T10:10:00Z",
    totals: { iterations: 1, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 1, escalated: false, ...totals },
  } as RunRecord;
}

describe("spread", () => {
  it("gives the median and quartiles by linear interpolation", () => {
    expect(spread([4, 1, 3, 2])).toEqual({ n: 4, median: 2.5, q1: 1.75, q3: 3.25 });
    expect(spread([7])).toEqual({ n: 1, median: 7, q1: 7, q3: 7 });
    expect(spread([])).toBeUndefined();
  });
});

describe("loopMetrics", () => {
  const generates = [
    run("generate", "Button", "passed", {
      iterations: 1,
      costUsd: 0.5,
      tokens: { input: 10, output: 100, cacheRead: 1000 },
    }),
    run("generate", "Button", "passed", {
      iterations: 3,
      costUsd: 2.5,
      escalated: true,
      durationSeconds: 900,
      tokens: { input: 30, output: 300, cacheRead: 3000 },
    }),
    run("generate", "Button", "needs-a-person", { iterations: 5, costUsd: 4 }, "iterations"),
  ];
  const proposes = [
    run("propose", "Button", "passed", { costUsd: 0.1 }),
    run("propose", "Button", "passed", { costUsd: 0.2 }),
  ];

  it("computes the protocol's metrics over the generate runs", () => {
    const metrics = loopMetrics(generates, proposes);
    expect(metrics.runs).toBe(3);
    expect(metrics.firstPass).toMatchObject({ k: 1, n: 3 });
    expect(metrics.pass).toMatchObject({ k: 2, n: 3 });
    expect(metrics.pass.interval[0]).toBeLessThan(2 / 3);
    expect(metrics.iterations).toEqual({ n: 2, median: 2, q1: 1.5, q3: 2.5 });
    expect(metrics.escalation).toMatchObject({ k: 1, n: 3 });
    expect(metrics.costPerRun).toEqual({ median: 2.5, mean: 7 / 3 });
    expect(metrics.stops).toEqual({ iterations: 1 });
    expect(metrics.tokens).toEqual({ input: 10, cacheRead: 1000, output: 100 });
    expect(metrics.wallClockSeconds?.median).toBe(600);
    expect(metrics.costEstimated).toBe(false);
  });

  it("counts propose runs toward the cost per passed component", () => {
    const metrics = loopMetrics(generates, proposes);
    expect(metrics.totalCostUsd).toBeCloseTo(7.3);
    expect(metrics.costPerPassedUsd).toBeCloseTo(3.65);
  });

  it("leaves out what has no passing run, and says when a cost was estimated", () => {
    const metrics = loopMetrics([run("generate", "Badge", "needs-a-person", { costEstimated: true }, "budget")], []);
    expect(metrics.pass.value).toBe(0);
    expect(metrics).not.toHaveProperty("iterations");
    expect(metrics).not.toHaveProperty("costPerPassedUsd");
    expect(metrics.costEstimated).toBe(true);
  });
});

describe("roundMetrics", () => {
  it("groups by component in the order given, and covers the library", () => {
    const records = [
      run("generate", "Badge", "passed"),
      run("generate", "Button", "passed"),
      run("generate", "Button", "needs-a-person", {}, "budget"),
      run("propose", "Button", "passed"),
    ];
    const metrics = roundMetrics(records, ["Button", "Badge"]);
    expect(metrics.components.map((entry) => [entry.component, entry.metrics.runs])).toEqual([
      ["Button", 2],
      ["Badge", 1],
    ]);
    expect(metrics.library.runs).toBe(3);
    expect(metrics.library.totalCostUsd).toBe(4);
  });
});
