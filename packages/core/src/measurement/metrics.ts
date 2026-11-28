// SPDX-License-Identifier: GPL-3.0-or-later
// The loop metrics of a measurement round (docs/spec/measurement.md#loop-metrics), from its run
// records: per component and for the library. Generate runs are the runs; propose runs count
// only toward the cost per passed component.
import { wilson, type Proportion } from "../calibration/measures.js";
import type { RunRecord } from "../records/run-record.js";

/** A share with its 95% Wilson interval, and its count. */
export interface Count extends Proportion {
  readonly k: number;
}

/** A median with its interquartile range. */
export interface Spread {
  readonly n: number;
  readonly median: number;
  readonly q1: number;
  readonly q3: number;
}

/** The protocol's loop metrics over a set of measured runs. */
export interface LoopMetrics {
  /** Generate runs. */
  readonly runs: number;
  readonly firstPass: Count;
  readonly pass: Count;
  /** Iterations of the passing runs; absent when none passed. Failing runs are `pass.n - pass.k`. */
  readonly iterations?: Spread;
  readonly escalation: Count;
  /** Agent and judge cost of a generate run, in USD. */
  readonly costPerRun: { readonly median: number; readonly mean: number };
  /** The cost of every generate and propose run, in USD. */
  readonly totalCostUsd: number;
  /** The total cost divided by the passing runs; absent when none passed. */
  readonly costPerPassedUsd?: number;
  /** Median tokens of a generate run's agent calls. */
  readonly tokens: { readonly input: number; readonly cacheRead: number; readonly output: number };
  readonly wallClockSeconds?: Spread;
  /** Generate runs that needed a person, by reason. */
  readonly stops: Readonly<Record<string, number>>;
  /** True when any run's cost was Claude Code's estimate rather than the API's. */
  readonly costEstimated: boolean;
}

/** The round's metrics: by component, and for the library. */
export interface RoundMetrics {
  readonly components: readonly { readonly component: string; readonly metrics: LoopMetrics }[];
  readonly library: LoopMetrics;
}

/** The value at quantile `q` of sorted values, by linear interpolation between ranks. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? a;
  return a + (b - a) * (position - lower);
}

export function spread(values: readonly number[]): Spread | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}

function proportion(k: number, n: number): Count {
  return { k, n, value: n === 0 ? 0 : k / n, interval: wilson(k, n) };
}

function median(values: readonly number[]): number {
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}

/** A run's wall-clock time: its recorded duration, or the time from its start to its end. */
function duration(record: RunRecord): number | undefined {
  if (record.totals.durationSeconds !== undefined) return record.totals.durationSeconds;
  if (record.ended === undefined) return undefined;
  return (Date.parse(record.ended) - Date.parse(record.started)) / 1000;
}

/** The loop metrics of a set of measured generate runs and the propose runs of the same repeats. */
export function loopMetrics(generates: readonly RunRecord[], proposes: readonly RunRecord[]): LoopMetrics {
  const passed = generates.filter((record) => record.status === "passed");
  const costs = generates.map((record) => record.totals.costUsd);
  const totalCostUsd = [...generates, ...proposes].reduce((sum, record) => sum + record.totals.costUsd, 0);
  const stops: Record<string, number> = {};
  for (const record of generates) {
    if (record.status === "needs-a-person") {
      const reason = record.reason ?? "unknown";
      stops[reason] = (stops[reason] ?? 0) + 1;
    }
  }
  const iterations = spread(passed.map((record) => record.totals.iterations));
  const wallClock = spread(generates.flatMap((record) => duration(record) ?? []));
  return {
    runs: generates.length,
    firstPass: proportion(passed.filter((record) => record.totals.iterations === 1).length, generates.length),
    pass: proportion(passed.length, generates.length),
    ...(iterations === undefined ? {} : { iterations }),
    escalation: proportion(generates.filter((record) => record.totals.escalated).length, generates.length),
    costPerRun: {
      median: median(costs),
      mean: costs.length === 0 ? 0 : costs.reduce((a, b) => a + b, 0) / costs.length,
    },
    totalCostUsd,
    ...(passed.length === 0 ? {} : { costPerPassedUsd: totalCostUsd / passed.length }),
    tokens: {
      input: median(generates.map((record) => record.totals.tokens?.input ?? 0)),
      cacheRead: median(generates.map((record) => record.totals.tokens?.cacheRead ?? 0)),
      output: median(generates.map((record) => record.totals.tokens?.output ?? 0)),
    },
    ...(wallClock === undefined ? {} : { wallClockSeconds: wallClock }),
    stops,
    costEstimated: [...generates, ...proposes].some((record) => record.totals.costEstimated === true),
  };
}

/** The metrics of a round's measured runs, by component (in the order given) and for the library. */
export function roundMetrics(records: readonly RunRecord[], components: readonly string[]): RoundMetrics {
  const of = (kind: RunRecord["kind"], component?: string) =>
    records.filter((record) => record.kind === kind && (component === undefined || record.component === component));
  return {
    components: components.map((component) => ({
      component,
      metrics: loopMetrics(of("generate", component), of("propose", component)),
    })),
    library: loopMetrics(of("generate"), of("propose")),
  };
}
