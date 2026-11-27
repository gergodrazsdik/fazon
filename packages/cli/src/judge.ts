// SPDX-License-Identifier: GPL-3.0-or-later
// The judge for a verify run, on the host (docs/spec/judge.md): its credential, price and
// calibrated status, the stories it sees, the pass itself, and the run record's update. The
// verifier image stays offline; only this process calls the API.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  frameworkCalibration,
  judgeCalibrated,
  judgeCredential,
  JudgeCredentialError,
  judgePass,
  judgeSdkClient,
  judgeVersion,
  loadComponents,
  missingCredential,
  noJudge,
  parseSpecFile,
  priceOf,
  readVerifyDetails,
  sdkJudgeClient,
  writeRunRecord,
  type Adapter,
  type Config,
  type JudgeHook,
  type JudgePass,
  type JudgePassComponent,
  type JudgeSummary,
  type RunRecord,
  type VerifyComponent,
  type VerifyDetails,
} from "@fazon/core";
import { isSet, type Environment } from "./environment.js";
import type { Message, TextLine } from "./outcome.js";

export interface VerifyJudgeInput {
  readonly environment: Environment;
  readonly config: Config;
  readonly runDir: string;
  readonly record: RunRecord;
  readonly details: VerifyDetails;
  /** The components to judge, and every component with a spec, for `family`. */
  readonly components: readonly VerifyComponent[];
  readonly library: readonly VerifyComponent[];
  readonly budgetUsd: number;
  readonly progress?: (text: string) => void;
}

export type VerifyJudgeResult =
  | { readonly kind: "judged"; readonly record: RunRecord; readonly pass: JudgePass; readonly blocking: boolean }
  /** No credential: the judge can't run. */
  | { readonly kind: "no-credential"; readonly message: string }
  /** The environment or the API stopped it: a refused credential, a model without a price. */
  | { readonly kind: "error"; readonly message: string };

/** The components the judge can see: those with a story manifest, with their spec's text and body. */
export async function passComponents(
  repo: string,
  components: readonly VerifyComponent[],
): Promise<JudgePassComponent[]> {
  const result: JudgePassComponent[] = [];
  for (const component of components) {
    if (component.manifest === undefined) continue;
    const specText = await readFile(path.join(repo, component.specFile), "utf8");
    const { body } = parseSpecFile(component.specFile, specText);
    result.push({
      name: component.name,
      spec: component.spec,
      specFile: component.specFile,
      specText,
      body,
      manifest: component.manifest,
    });
  }
  return result;
}

/** With `--base`: the stories whose baselines the pull request adds or changes. */
function seenStories(details: VerifyDetails): ReadonlySet<string> | undefined {
  if (details.base === undefined) return undefined;
  const paths = new Set(
    details.base.changes.filter((change) => change.mark === "added" || change.mark === "changed").map((c) => c.path),
  );
  return new Set(details.stories.filter((story) => paths.has(story.path)).map((story) => story.story));
}

export async function judgeVerifyRun(input: VerifyJudgeInput): Promise<VerifyJudgeResult> {
  const { environment, config } = input;
  const credential = judgeCredential(environment.env);
  if (credential === undefined)
    return { kind: "no-credential", message: `The judge didn't run: ${missingCredential}.` };
  const model = config.models.judge;
  const price = priceOf(config.prices, model);
  if (price === undefined) {
    return {
      kind: "error",
      message: `The judge's model ${model} has no price in fazon.yaml's prices or the framework's table (CONFIG-005).`,
    };
  }
  const client = environment.judgeClient?.(credential) ?? sdkJudgeClient(judgeSdkClient(credential));
  const calibrated = await judgeCalibrated(model, frameworkCalibration);
  const seen = seenStories(input.details);
  const components = await passComponents(environment.cwd, input.components);
  input.progress?.(
    `Judge: ${components.map((c) => c.name).join(", ") || "no components"} with ${model}, within $${input.budgetUsd.toFixed(2)}\n`,
  );
  let pass: JudgePass;
  try {
    pass = await judgePass({
      repo: environment.cwd,
      runDir: input.runDir,
      captures: input.record.verification?.captures ?? "captures",
      baselines: config.paths.baselines,
      components,
      library: input.library,
      visuals: input.details.stories,
      ...(seen === undefined ? {} : { seen }),
      results: "judge.json",
      model,
      ...(config.effort.judge === undefined ? {} : { effort: config.effort.judge }),
      repeats: config.judge.repeats,
      price,
      budgetUsd: input.budgetUsd,
      client,
      ...(environment.interrupt === undefined ? {} : { signal: environment.interrupt }),
    });
  } catch (error) {
    if (error instanceof JudgeCredentialError) return { kind: "error", message: `${error.message}.` };
    throw error;
  }
  // Before calibration, no verdict blocks (JUDGE-005). After it, a fail blocks locally, and in CI
  // only under the `blocking` policy.
  const ci = isSet(environment, "CI");
  const blocking = calibrated && pass.summary.stories.fail > 0 && (!ci || config.judge.policy === "blocking");
  const summary: JudgeSummary = { ...pass.summary, blocking };
  const judgeCost = pass.summary.costUsd;
  const record: RunRecord = {
    ...input.record,
    ...(blocking && input.record.status === "passed" ? { status: "failed" } : {}),
    versions: { ...input.record.versions, judge: judgeVersion },
    config: { ...input.record.config, judgeCalibrated: calibrated },
    verification: { ...(input.record.verification ?? { checks: [] }), judge: summary },
    totals: {
      ...input.record.totals,
      judgeCostUsd: judgeCost,
      costUsd: input.record.totals.agentCostUsd + judgeCost,
    },
  };
  await writeRunRecord(input.runDir, record);
  return { kind: "judged", record, pass, blocking };
}

/** The judge's lines for the text output: each component's counts, then each fail's and unsure's finding. */
export function judgeText(pass: JudgePass, calibrated: boolean): { text: TextLine[]; messages: Message[] } {
  const text: TextLine[] = [];
  const byComponent = new Map<string, JudgePass["stories"][number][]>();
  for (const story of pass.stories)
    byComponent.set(story.component, [...(byComponent.get(story.component) ?? []), story]);
  for (const [component, stories] of byComponent) {
    const count = (verdict: string) => stories.filter((story) => story.verdict === verdict).length;
    text.push({
      stream: "stdout",
      text: `${component} judge: ${String(count("pass"))} pass, ${String(count("fail"))} fail, ${String(count("unsure"))} unsure, ${String(count("not-judged"))} not judged`,
    });
    for (const story of stories) {
      for (const finding of story.findings) {
        text.push({
          stream: "stdout",
          text: `  ${finding.verdict} ${story.story} (${story.theme}) ${finding.question} [${finding.severity}]: ${finding.message}`,
        });
      }
      if (story.verdict === "not-judged") {
        text.push({
          stream: "stdout",
          text: `  not judged ${story.story} (${story.theme}): ${story.reasons.join("; ")}`,
        });
      }
    }
  }
  const { summary } = pass;
  const messages: Message[] = [
    {
      level: summary.stories.fail > 0 || summary.stories.notJudged > 0 ? "warning" : "info",
      text: `The judge made ${String(summary.calls)} ${summary.calls === 1 ? "call" : "calls"} for $${summary.costUsd.toFixed(4)}: ${String(summary.stories.pass)} pass, ${String(summary.stories.fail)} fail, ${String(summary.stories.unsure)} unsure, ${String(summary.stories.notJudged)} not judged.${calibrated ? "" : " It isn't calibrated yet, so its verdicts are advisory."}`,
    },
  ];
  return { text, messages };
}

export interface LoopJudgeInput {
  readonly environment: Environment;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The component the run generates, by its kebab-case name. */
  readonly component: string;
  /** Collects what the developer should hear at the run's end, such as a refused credential. */
  readonly messages: Message[];
}

/** The judge for a generate or feedback run's iterations: its hook, and what the run records about it. */
export interface LoopJudge {
  readonly hook: JudgeHook;
  /** Absent when the judge can't run, as without a credential. */
  readonly version?: number;
  readonly calibrated: boolean;
}

/**
 * The judge of an agent run (docs/spec/judge.md#when-the-judge-runs): after an iteration's checks
 * pass, every story of the component in the iteration's captures, within what's left of the run's
 * budget. Its fails block only once the judge is calibrated (JUDGE-005).
 */
export async function loopJudge(input: LoopJudgeInput): Promise<LoopJudge> {
  const { environment, config, adapter, component, messages } = input;
  const off = config.judge.policy === "off" || config.judge.localPolicy === "off";
  if (off) return { hook: noJudge, calibrated: false };
  const credential = judgeCredential(environment.env);
  if (credential === undefined) {
    messages.push({ level: "warning", text: `The judge didn't run: ${missingCredential}.`, hint: "fazon doctor" });
    return { hook: noJudge, calibrated: false };
  }
  const model = config.models.judge;
  const price = priceOf(config.prices, model);
  if (price === undefined) {
    messages.push({
      level: "warning",
      text: `The judge didn't run: its model ${model} has no price in fazon.yaml's prices or the framework's table (CONFIG-005).`,
    });
    return { hook: noJudge, calibrated: false };
  }
  const client = environment.judgeClient?.(credential) ?? sdkJudgeClient(judgeSdkClient(credential));
  const calibrated = await judgeCalibrated(model, frameworkCalibration);
  let refusedCredential = false;
  const hook: JudgeHook = async ({ runDir, iteration, budgetUsd, signal }) => {
    if (refusedCredential) return undefined;
    const { components } = await loadComponents(environment.cwd, config, adapter);
    const own = components.filter((entry) => entry.name === component);
    const details = await readVerifyDetails(path.join(runDir, "checks", String(iteration)));
    try {
      const pass = await judgePass({
        repo: environment.cwd,
        runDir,
        captures: `captures/${String(iteration)}`,
        baselines: config.paths.baselines,
        components: await passComponents(environment.cwd, own),
        library: components,
        visuals: (details?.stories ?? []).filter((story) => story.component === component),
        results: `judge/${String(iteration)}.json`,
        model,
        ...(config.effort.judge === undefined ? {} : { effort: config.effort.judge }),
        repeats: config.judge.repeats,
        price,
        budgetUsd,
        client,
        signal,
      });
      return { ...pass.summary, blocking: calibrated && pass.summary.stories.fail > 0 };
    } catch (error) {
      if (!(error instanceof JudgeCredentialError)) throw error;
      refusedCredential = true;
      messages.push({ level: "warning", text: `The judge stopped: ${error.message}.`, hint: "fazon doctor" });
      return undefined;
    }
  };
  return { hook, version: judgeVersion, calibrated };
}
