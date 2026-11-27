// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's judge calls (docs/spec/measurement.md#the-calls-a-round-makes): the
// unmodified components' whole plans first, then, when the estimate from their measured cost fits
// what's left of the budget, each case's calls that include an affected story, every call
// repeated, through the Message Batches API.
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { baselinePath } from "../checks/visual.js";
import type { EffortLevel, ModelPrice } from "../config/types.js";
import { judgeInBatches, type BatchClient, type BatchEntry } from "../judge/batch.js";
import { fitPng } from "../judge/images.js";
import type { JudgePassComponent } from "../judge/pass.js";
import { defaultStoryOf, judgePlan, maxFamilyComponents, type JudgeCall, type JudgePlan } from "../judge/plan.js";
import type { JudgeAttempt } from "../judge/run.js";
import type { StoryManifest } from "../matrix/types.js";
import type { Spec } from "../spec/types.js";
import type { CalibrationRenders, RenderedCase } from "./renders.js";

/** A call of the round and its attempts, one per repeat. */
export interface RoundCall {
  readonly component: string;
  /** The case's ID; absent for the unmodified component. */
  readonly case?: string;
  readonly call: JudgeCall;
  readonly attempts: readonly JudgeAttempt[];
}

export interface RoundJudgeInput {
  readonly repo: string;
  /** The round's directory: the verify run's `calibration/`, absolute. */
  readonly roundDir: string;
  /** The baselines directory, relative to the repository. */
  readonly baselines: string;
  readonly components: readonly JudgePassComponent[];
  /** Every component with a spec, for `family`. */
  readonly library: readonly { readonly name: string; readonly spec: Spec; readonly manifest?: StoryManifest }[];
  readonly renders: CalibrationRenders;
  readonly model: string;
  readonly effort?: EffortLevel;
  /** 5 in a round: self-agreement needs them. */
  readonly repeats: number;
  readonly price: ModelPrice;
  /** What's left of the measurement budget. */
  readonly budgetUsd: number;
  readonly client: BatchClient;
  readonly signal?: AbortSignal;
  readonly progress?: (text: string) => void;
}

export type RoundJudgeOutcome =
  | {
      readonly kind: "done";
      readonly plans: ReadonlyMap<string, JudgePlan>;
      readonly calls: readonly RoundCall[];
      readonly costUsd: number;
    }
  | {
      /** The cases' estimate doesn't fit what's left: the maintainer decides. */
      readonly kind: "over-budget";
      readonly plans: ReadonlyMap<string, JudgePlan>;
      readonly calls: readonly RoundCall[];
      readonly costUsd: number;
      readonly estimateUsd: number;
    };

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** Whether a call shows a story a case changed, in the call's theme. */
function showsAffected(call: JudgeCall, entry: RenderedCase): boolean {
  return call.images.some(
    (image) =>
      image.kind === "capture" &&
      entry.affected.some((affected) => affected.story === image.story && affected.themes.includes(call.theme)),
  );
}

export async function judgeRound(input: RoundJudgeInput): Promise<RoundJudgeOutcome> {
  const plans = new Map<string, JudgePlan>();
  const families = new Map<string, Map<string, string>>();
  for (const component of input.components) {
    const theme = component.manifest.themes[0] ?? "";
    const family: { component: string; story: string }[] = [];
    for (const other of [...input.library].sort((a, b) => a.name.localeCompare(b.name))) {
      if (other.name === component.name || other.manifest === undefined || family.length === maxFamilyComponents)
        continue;
      const story = defaultStoryOf(other.spec, other.manifest);
      if (story === undefined) continue;
      if (await exists(path.join(input.repo, input.baselines, baselinePath(theme, other.name, story.name)))) {
        family.push({ component: other.name, story: story.name });
      }
    }
    families.set(component.name, new Map(family.map((entry) => [entry.story, entry.component])));
    // As for a new component without baselines: no change questions.
    plans.set(
      component.name,
      judgePlan({ spec: component.spec, body: component.body, manifest: component.manifest, family }),
    );
  }

  const imageFile = (component: JudgePassComponent, call: JudgeCall, index: number, entry?: RenderedCase): string => {
    const image = call.images[index];
    const story = image?.story ?? "";
    switch (image?.kind) {
      case "component":
        return path.join(
          input.repo,
          input.baselines,
          baselinePath(call.theme, families.get(component.name)?.get(story) ?? "", story),
        );
      case "reference":
        return path.join(input.repo, path.dirname(component.specFile), component.spec.reference ?? "");
      default: {
        const file = baselinePath(call.theme, component.name, story);
        const changed = entry?.affected.some(
          (affected) => affected.story === story && affected.themes.includes(call.theme),
        );
        return changed === true
          ? path.join(input.roundDir, "cases", component.name, entry?.id ?? "", file)
          : path.join(input.roundDir, "unmodified", file);
      }
    }
  };
  const batchEntry = async (
    key: string,
    component: JudgePassComponent,
    call: JudgeCall,
    entry?: RenderedCase,
  ): Promise<BatchEntry> => ({
    key,
    call,
    spec: { file: component.specFile, text: component.specText },
    images: await Promise.all(
      call.images.map(async (_, index) => fitPng(await readFile(imageFile(component, call, index, entry)))),
    ),
  });
  const run = async (
    entries: { key: string; component: string; case?: string; call: JudgeCall; batch: BatchEntry }[],
  ) => {
    const attempts = await judgeInBatches({
      entries: entries.map((entry) => entry.batch),
      repeats: input.repeats,
      model: input.model,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      price: input.price,
      client: input.client,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.progress === undefined ? {} : { progress: input.progress }),
    });
    return entries.map((entry): RoundCall => ({
      component: entry.component,
      ...(entry.case === undefined ? {} : { case: entry.case }),
      call: entry.call,
      attempts: attempts.get(entry.key) ?? [],
    }));
  };
  const cost = (calls: readonly RoundCall[]) =>
    calls.reduce((sum, call) => sum + call.attempts.reduce((s, a) => s + a.costUsd, 0), 0);

  // Stage 1: the unmodified components' whole plans.
  const unmodified = [];
  for (const component of input.components) {
    for (const [index, call] of (plans.get(component.name)?.calls ?? []).entries()) {
      const key = `${component.name}|${String(index)}`;
      unmodified.push({ key, component: component.name, call, batch: await batchEntry(key, component, call) });
    }
  }
  input.progress?.(
    `Judging the unmodified components: ${String(unmodified.length)} calls, ${String(input.repeats)} times each\n`,
  );
  const first = await run(unmodified);
  const spent = cost(first);

  // Stage 2: each case's calls that show an affected story.
  const cases = [];
  for (const component of input.components) {
    const rendered = input.renders.components.find((entry) => entry.name === component.name);
    for (const entry of rendered?.cases ?? []) {
      for (const [index, call] of (plans.get(component.name)?.calls ?? []).entries()) {
        if (!showsAffected(call, entry)) continue;
        const key = `${component.name}|${entry.id}|${String(index)}`;
        cases.push({
          key,
          component: component.name,
          case: entry.id,
          call,
          batch: await batchEntry(key, component, call, entry),
        });
      }
    }
  }
  const perRequest = first.length === 0 ? 0 : spent / (first.length * Math.max(1, input.repeats));
  const estimateUsd = perRequest * cases.length * Math.max(1, input.repeats);
  if (spent + estimateUsd > input.budgetUsd) {
    return { kind: "over-budget", plans, calls: first, costUsd: spent, estimateUsd };
  }
  input.progress?.(
    `Judging the cases: ${String(cases.length)} calls, ${String(input.repeats)} times each, estimated $${estimateUsd.toFixed(2)}\n`,
  );
  const second = await run(cases);
  return { kind: "done", plans, calls: [...first, ...second], costUsd: spent + cost(second) };
}
