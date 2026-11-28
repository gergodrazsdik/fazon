// SPDX-License-Identifier: GPL-3.0-or-later
// A judge pass over a run's captures (docs/spec/judge.md#when-the-judge-runs): each component's
// plan, its calls within one budget, component by component, the plans and results in the run's
// directory, and the run record's summary.
import { readFile, mkdir, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselinePath } from "../checks/visual.js";
import type { EffortLevel, ModelPrice } from "../config/types.js";
import type { StoryManifest } from "../matrix/types.js";
import type { JudgeSummary, TokenUsage } from "../records/run-record.js";
import type { Spec } from "../spec/types.js";
import type { StoryVisual } from "../verify/rendered.js";
import { judgeVersion } from "./instructions.js";
import { defaultStoryOf, judgePlan, maxFamilyComponents, type JudgePlan, type JudgePlanImage } from "./plan.js";
import { addTokens } from "./prices.js";
import { runJudge, type JudgeClient, type JudgeOutcome, type StoryVerdict } from "./run.js";

/** One component the pass judges. */
export interface JudgePassComponent {
  /** The kebab-case name, as in the baselines' paths. */
  readonly name: string;
  readonly spec: Spec;
  /** The spec's path from the repository root, and its text as written. */
  readonly specFile: string;
  readonly specText: string;
  /** The spec's Markdown body. */
  readonly body: string;
  readonly manifest: StoryManifest;
}

export interface JudgePassInput {
  readonly repo: string;
  readonly runDir: string;
  /** The captures, relative to the run's directory: `captures`, or `captures/<n>` for an iteration. */
  readonly captures: string;
  /** The baselines directory, relative to the repository. */
  readonly baselines: string;
  readonly components: readonly JudgePassComponent[];
  /** Every component with a spec, for `family`: the default stories of up to five others with baselines. */
  readonly library: readonly { readonly name: string; readonly spec: Spec; readonly manifest?: StoryManifest }[];
  /** Each story's visual status in each theme; a `changed` one gets a `change-<story>` question. */
  readonly visuals: readonly StoryVisual[];
  /** In CI, the stories the judge sees: those whose baselines the pull request adds or changes. */
  readonly seen?: ReadonlySet<string>;
  /** The results file, relative to the run's directory: `judge.json`, or `judge/<n>.json`. */
  readonly results: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly repeats: number;
  readonly price: ModelPrice;
  readonly budgetUsd: number;
  readonly client: JudgeClient;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/** What the results file holds: each component's plan and the outcome of its calls. */
export interface JudgeResults {
  readonly fazon: 0;
  readonly judgeVersion: number;
  readonly model: string;
  readonly components: readonly {
    readonly component: string;
    readonly plan: JudgePlan;
    readonly outcome: JudgeOutcome;
  }[];
}

export interface JudgePass {
  /** The run record's summary; `blocking` is the caller's to set. */
  readonly summary: JudgeSummary;
  readonly stories: readonly (StoryVerdict & { readonly component: string })[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The other components' default stories with a baseline in the default theme, in name order, at most five. */
async function familyOf(input: JudgePassInput, component: JudgePassComponent) {
  const theme = component.manifest.themes[0];
  if (theme === undefined) return [];
  const found: { component: string; story: string }[] = [];
  for (const other of [...input.library].sort((a, b) => a.name.localeCompare(b.name))) {
    if (other.name === component.name || other.manifest === undefined) continue;
    const story = defaultStoryOf(other.spec, other.manifest);
    if (story === undefined) continue;
    if (await exists(path.join(input.repo, input.baselines, baselinePath(theme, other.name, story.name)))) {
      found.push({ component: other.name, story: story.name });
    }
    if (found.length === maxFamilyComponents) break;
  }
  return found;
}

/** Runs the judge over the components, writes the results file, and gives the summary. */
export async function judgePass(input: JudgePassInput): Promise<JudgePass> {
  const results: { component: string; plan: JudgePlan; outcome: JudgeOutcome }[] = [];
  let spent = 0;
  for (const component of input.components) {
    const family = await familyOf(input, component);
    const owners = new Map(family.map((entry) => [entry.story, entry.component]));
    const visuals = input.visuals.filter((visual) => visual.component === component.name);
    const changed = visuals
      .filter((visual) => visual.status === "changed")
      .map((visual) => ({ story: visual.story, theme: visual.theme }));
    const plan = judgePlan({
      spec: component.spec,
      body: component.body,
      manifest: component.manifest,
      ...(input.seen === undefined ? {} : { stories: input.seen }),
      changed,
      family,
    });
    const file = (image: JudgePlanImage, theme: string): string => {
      const story = image.story ?? "";
      switch (image.kind) {
        case "capture":
          return path.join(input.runDir, input.captures, baselinePath(theme, component.name, story));
        case "baseline":
          return path.join(input.repo, input.baselines, baselinePath(theme, component.name, story));
        case "diff": {
          const diff = visuals.find((visual) => visual.story === story && visual.theme === theme)?.diff;
          if (diff === undefined) throw new Error(`no diff image for ${story} in ${theme}`);
          return path.join(input.runDir, diff);
        }
        case "reference":
          return path.join(input.repo, path.dirname(component.specFile), component.spec.reference ?? "");
        case "component":
          return path.join(input.repo, input.baselines, baselinePath(theme, owners.get(story) ?? "", story));
      }
    };
    const outcome = await runJudge({
      plan,
      spec: { file: component.specFile, text: component.specText },
      model: input.model,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      repeats: input.repeats,
      price: input.price,
      budgetUsd: Math.max(0, input.budgetUsd - spent),
      loadImage: (image, call) => readFile(file(image, call.theme)),
      client: input.client,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    spent += outcome.costUsd;
    results.push({ component: component.name, plan, outcome });
  }

  const record: JudgeResults = { fazon: 0, judgeVersion, model: input.model, components: results };
  const target = path.join(input.runDir, input.results);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  await rename(`${target}.tmp`, target);

  const stories = results.flatMap(({ component, outcome }) =>
    outcome.stories.map((story) => ({ ...story, component })),
  );
  const count = (verdict: StoryVerdict["verdict"]) => stories.filter((story) => story.verdict === verdict).length;
  const tokens = results.reduce<TokenUsage>((sum, { outcome }) => addTokens(sum, outcome.tokens), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  const findings = stories.flatMap((story) =>
    story.findings.map((finding) => ({
      question: finding.question,
      story: story.story,
      theme: finding.theme,
      verdict: finding.verdict,
      severity: finding.severity,
      message: finding.message,
    })),
  );
  const summary: JudgeSummary = {
    calls: results.reduce(
      (sum, { outcome }) => sum + outcome.calls.filter((call) => call.attempts.length > 0).length,
      0,
    ),
    costUsd: spent,
    tokens,
    stories: { pass: count("pass"), fail: count("fail"), unsure: count("unsure"), notJudged: count("not-judged") },
    results: input.results,
    ...(findings.length > 0 ? { findings } : {}),
  };
  return { summary, stories };
}

/**
 * The calibration records the framework ships, by judge version and model: the repository's
 * `calibration/judge-<version>/<model>.json`, which the build copies into the package's
 * `dist/calibration-records/` (scripts/copy-schemas.ts). This module sits two levels below the
 * package root both as src/judge/pass.ts and as dist/judge/pass.js.
 */
export const frameworkCalibration = fileURLToPath(new URL("../../dist/calibration-records/", import.meta.url));

/**
 * Whether the judge counts as calibrated for a model (docs/spec/measurement.md#calibrated-status):
 * a calibration record for this judge version and model that says `calibrated: true`. Until a
 * round has produced one (M3 step 7), there is none, and the judge is advisory (JUDGE-005).
 */
export async function judgeCalibrated(model: string, directory: string): Promise<boolean> {
  try {
    const text = await readFile(path.join(directory, `judge-${String(judgeVersion)}`, `${model}.json`), "utf8");
    const record = JSON.parse(text) as { calibrated?: unknown; judge?: unknown; model?: unknown };
    return record.calibrated === true && record.model === model && record.judge === judgeVersion;
  } catch {
    return false;
  }
}
