// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's measures and its record (docs/spec/measurement.md#measures,
// docs/spec/records.md#calibration-records). Catch and false-positive rates count each call's
// first repeat, the judge as configured with one; self-agreement counts every repeat. Every
// proportion carries its n and 95% Wilson interval.
import { attemptVerdicts, type Verdict } from "../judge/run.js";
import { operators, type OperatorId } from "../mutation/operators.js";
import type { RoundCall } from "./judge.js";
import type { CalibrationRenders } from "./renders.js";

export interface Proportion {
  readonly value: number;
  readonly n: number;
  readonly interval: readonly [number, number];
}

/** The 95% Wilson score interval of k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): readonly [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

function proportion(k: number, n: number): Proportion {
  return { value: n === 0 ? 0 : Math.round((k / n) * 1000) / 1000, n, interval: wilson(k, n) };
}

/** The thresholds of docs/spec/measurement.md#thresholds. */
export const thresholds = {
  catchRate: 0.8,
  catchRatePerOperator: 0.6,
  falsePositiveRate: 0.05,
  selfAgreement: 0.9,
  minCases: 40,
  minCasesPerOperator: 10,
  minUnmodifiedStories: 40,
} as const;

/** The story-theme verdicts of a set of calls in one repeat: fail if any call failed it, else unsure, else pass. */
function pairVerdicts(calls: readonly RoundCall[], repeat: number): Map<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  for (const { call, attempts } of calls) {
    const attempt = attempts[repeat];
    if (attempt === undefined) continue;
    attemptVerdicts(call, attempt).forEach((verdict, index) => {
      const image = call.images[index];
      if (image?.kind !== "capture" || image.story === undefined || verdict === undefined) return;
      const key = `${image.story} ${call.theme}`;
      const before = verdicts.get(key);
      const next: Verdict =
        before === "fail" || verdict.verdict === "fail"
          ? "fail"
          : before === "unsure" || verdict.verdict === "unsure"
            ? "unsure"
            : "pass";
      verdicts.set(key, next);
    });
  }
  return verdicts;
}

export interface OperatorResult {
  readonly id: OperatorId;
  readonly class: "measurable" | "viewer-only";
  readonly cases: number;
  readonly caught: number;
  readonly unsure: number;
  readonly checksCaught: { readonly withBaselines: number; readonly withoutBaselines: number };
}

export interface RoundMeasures {
  readonly operators: readonly OperatorResult[];
  readonly catchRate: Proportion;
  readonly falsePositiveRate: Proportion;
  readonly selfAgreement: Proportion;
  readonly costUsd: { readonly total: number; readonly perComponent: number };
  /** Whether every threshold and sample size is met. */
  readonly calibrated: boolean;
}

export function roundMeasures(
  renders: CalibrationRenders,
  calls: readonly RoundCall[],
  costUsd: number,
): RoundMeasures {
  const unmodifiedBy = new Map<string, RoundCall[]>();
  const caseBy = new Map<string, RoundCall[]>();
  for (const entry of calls) {
    const map = entry.case === undefined ? unmodifiedBy : caseBy;
    const key = entry.case === undefined ? entry.component : `${entry.component}|${entry.case}`;
    map.set(key, [...(map.get(key) ?? []), entry]);
  }

  // False positives: the unmodified story-theme pairs the first repeat fails.
  let pairs = 0;
  let fails = 0;
  const unmodifiedVerdicts = new Map<string, Map<string, Verdict>>();
  for (const [component, list] of unmodifiedBy) {
    const verdicts = pairVerdicts(list, 0);
    unmodifiedVerdicts.set(component, verdicts);
    pairs += verdicts.size;
    fails += [...verdicts.values()].filter((verdict) => verdict === "fail").length;
  }

  // Catches: a case is caught when the first repeat fails an affected or flagged story.
  const results = new Map<
    OperatorId,
    { cases: number; caught: number; unsure: number; withBaselines: number; withoutBaselines: number }
  >();
  for (const operator of operators)
    results.set(operator.id, { cases: 0, caught: 0, unsure: 0, withBaselines: 0, withoutBaselines: 0 });
  for (const component of renders.components) {
    for (const entry of component.cases) {
      const verdicts = pairVerdicts(caseBy.get(`${component.name}|${entry.id}`) ?? [], 0);
      const own = unmodifiedVerdicts.get(component.name) ?? new Map<string, Verdict>();
      const seen: Verdict[] = [
        ...entry.affected.flatMap((a) => a.themes.map((theme) => verdicts.get(`${a.story} ${theme}`))),
        ...entry.flagged.flatMap((f) => f.themes.map((theme) => own.get(`${f.story} ${theme}`))),
      ].filter((verdict): verdict is Verdict => verdict !== undefined);
      const result = results.get(entry.operator);
      if (result === undefined) continue;
      result.cases += 1;
      if (seen.includes("fail")) result.caught += 1;
      else if (seen.includes("unsure")) result.unsure += 1;
      if (entry.checks.withBaselines) result.withBaselines += 1;
      if (entry.checks.withoutBaselines) result.withoutBaselines += 1;
    }
  }
  const operatorResults: OperatorResult[] = operators.map((operator) => {
    const result = results.get(operator.id) ?? {
      cases: 0,
      caught: 0,
      unsure: 0,
      withBaselines: 0,
      withoutBaselines: 0,
    };
    return {
      id: operator.id,
      class: operator.class,
      cases: result.cases,
      caught: result.caught,
      unsure: result.unsure,
      checksCaught: { withBaselines: result.withBaselines, withoutBaselines: result.withoutBaselines },
    };
  });
  const viewerOnly = operatorResults.filter((result) => result.class === "viewer-only");
  const cases = viewerOnly.reduce((sum, result) => sum + result.cases, 0);
  const caught = viewerOnly.reduce((sum, result) => sum + result.caught, 0);

  // Self-agreement: for each image of each call, the share of repeats giving its most common verdict.
  let images = 0;
  let agreement = 0;
  for (const { call, attempts } of calls) {
    const perRepeat = attempts.map((attempt) => attemptVerdicts(call, attempt));
    call.images.forEach((_, index) => {
      const counts = new Map<string, number>();
      for (const verdicts of perRepeat) {
        const verdict = verdicts[index]?.verdict ?? "unsure";
        counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
      }
      if (perRepeat.length === 0) return;
      images += 1;
      agreement += Math.max(...counts.values()) / perRepeat.length;
    });
  }
  const catchRate = proportion(caught, cases);
  const falsePositiveRate = proportion(fails, pairs);
  const selfAgreement = proportion(Math.round(agreement), images);
  const componentCount = Math.max(1, renders.components.length);
  const calibrated =
    cases >= thresholds.minCases &&
    catchRate.value >= thresholds.catchRate &&
    viewerOnly.every(
      (result) =>
        result.cases >= thresholds.minCasesPerOperator &&
        result.caught / result.cases >= thresholds.catchRatePerOperator,
    ) &&
    pairs >= thresholds.minUnmodifiedStories &&
    falsePositiveRate.value <= thresholds.falsePositiveRate &&
    selfAgreement.value >= thresholds.selfAgreement;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  return {
    operators: operatorResults,
    catchRate,
    falsePositiveRate,
    selfAgreement,
    costUsd: { total: round2(costUsd), perComponent: round2(costUsd / componentCount) },
    calibrated,
  };
}

export interface CalibrationRecordInput {
  readonly judge: number;
  readonly model: string;
  /** The framework version that ran the round. */
  readonly framework: string;
  readonly round: number;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** The components' names as their specs write them. */
  readonly components: readonly string[];
  readonly measures: RoundMeasures;
  /** The release asset with the round's run and calibration records. */
  readonly records: string;
}

/** The calibration record (docs/spec/schemas/calibration-record.schema.json). */
export function calibrationRecord(input: CalibrationRecordInput): Record<string, unknown> {
  const { measures } = input;
  return {
    fazon: 0,
    judge: input.judge,
    model: input.model,
    framework: input.framework,
    round: input.round,
    date: input.date,
    components: [...input.components],
    operators: measures.operators.map((operator) => ({ ...operator, checksCaught: { ...operator.checksCaught } })),
    measures: {
      catchRate: { ...measures.catchRate, interval: [...measures.catchRate.interval] },
      falsePositiveRate: { ...measures.falsePositiveRate, interval: [...measures.falsePositiveRate.interval] },
      selfAgreement: { ...measures.selfAgreement, interval: [...measures.selfAgreement.interval] },
      costUsd: { ...measures.costUsd },
    },
    thresholds: { ...thresholds },
    calibrated: measures.calibrated,
    records: input.records,
  };
}
