// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon measure --round <n>` (docs/spec/cli.md#fazon-measure): a measurement round. For each
// component and repeat, a propose run whose output is discarded and a `generate --clean` run, both
// with their `measurement` set, from a clean checkout that is restored after every run. Repeat 1
// of every component comes first; its cost gives the estimate the rest is checked against
// `--budget`. Runs of the round from an earlier, interrupted invocation are kept when they started
// from the same inputs and versions. Ends with the round's loop metrics.
import { createRequire } from "node:module";
import {
  configDefaults,
  judgeCredential,
  listRunIds,
  loadComponents,
  readRunRecord,
  roundMetrics,
  runDirectory,
  type LoopMetrics,
  type RunRecord,
} from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { readRunInputs, type AgentCommandSetup } from "../agent-run.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { roundComponents } from "./calibrate.js";
import { requireConfig, type Context, type Invocation } from "./context.js";
import { prepareLoopCommand, runLoopCommand } from "./generate.js";
import { measuredCheckoutProblem } from "./measured.js";
import { propose } from "./propose.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

/** Repeats per component and round (docs/spec/measurement.md#repeats). */
export const defaultRepeats = 5;

/** One run of a round. */
export interface MeasureStep {
  /** The component's kebab-case name. */
  readonly component: string;
  readonly repeat: number;
  readonly kind: "propose" | "generate";
}

/** What a round's loop needs from the outside; tests pass fakes. */
export interface MeasureDependencies {
  /** Runs one step; the record when the run started, otherwise the outcome that stopped it. */
  readonly run: (step: MeasureStep) => Promise<{ readonly record: RunRecord } | { readonly stop: Outcome }>;
  /** Restores the checkout after a run; a problem when it can't be made clean again. */
  readonly restore: () => Promise<string | undefined>;
  readonly progress: (text: string) => void;
}

export interface MeasureRoundInput {
  readonly round: number;
  readonly repeats: number;
  /** The components' kebab-case names, in the order they run, with their spec names. */
  readonly components: readonly { readonly name: string; readonly specName: string }[];
  /** What's left of the measurement budget, in USD. */
  readonly budgetUsd: number;
  /** The estimate for a repeat of a component with no measured repeat yet: the run's cost cap. */
  readonly capUsd: number;
  /** Completed runs of the round from earlier invocations, with the same inputs and versions. */
  readonly earlier: readonly RunRecord[];
  readonly dependencies: MeasureDependencies;
}

export type MeasureRoundOutcome =
  | { readonly kind: "done"; readonly records: readonly RunRecord[]; readonly spentUsd: number }
  | {
      readonly kind: "over-budget";
      readonly records: readonly RunRecord[];
      readonly spentUsd: number;
      readonly estimateUsd: number;
    }
  | {
      readonly kind: "stopped";
      readonly records: readonly RunRecord[];
      readonly spentUsd: number;
      readonly why: "interrupted" | "estimated" | "restore" | "run";
      readonly message?: string;
      readonly outcome?: Outcome;
    };

/**
 * The round's runs in order: every component's repeat 1 first, then repeat 2, and so on; within a
 * repeat, the propose run before the generate run. Runs already in `earlier` are kept and skipped.
 */
export async function measureRound(input: MeasureRoundInput): Promise<MeasureRoundOutcome> {
  const { components, repeats, budgetUsd, capUsd, dependencies } = input;
  const records: RunRecord[] = [...input.earlier];
  let spentUsd = 0;
  const find = (specName: string, repeat: number, kind: MeasureStep["kind"]) =>
    records.find(
      (record) => record.component === specName && record.kind === kind && record.measurement?.repeat === repeat,
    );
  // The mean cost of a component's repeats with both runs measured.
  const repeatCost = (specName: string): number | undefined => {
    const costs: number[] = [];
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const proposed = find(specName, repeat, "propose");
      const generated = find(specName, repeat, "generate");
      if (proposed !== undefined && generated !== undefined) {
        costs.push(proposed.totals.costUsd + generated.totals.costUsd);
      }
    }
    return costs.length === 0 ? undefined : costs.reduce((a, b) => a + b, 0) / costs.length;
  };
  const missing = (specName: string, from: number) => {
    let count = 0;
    for (let repeat = from; repeat <= repeats; repeat += 1) {
      if (find(specName, repeat, "generate") === undefined) count += 1;
    }
    return count;
  };

  let staged = false;
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    // The staged estimate: once every component has a measured repeat, the rest must fit.
    if (repeat > 1 && !staged && components.every((c) => repeatCost(c.specName) !== undefined)) {
      staged = true;
      const estimateUsd = components.reduce(
        (sum, c) => sum + (repeatCost(c.specName) ?? capUsd) * missing(c.specName, repeat),
        0,
      );
      if (spentUsd + estimateUsd > budgetUsd) return { kind: "over-budget", records, spentUsd, estimateUsd };
    }
    for (const component of components) {
      for (const kind of ["propose", "generate"] as const) {
        if (find(component.specName, repeat, kind) !== undefined) continue;
        if (kind === "propose") {
          const estimateUsd = repeatCost(component.specName) ?? capUsd;
          if (spentUsd + estimateUsd > budgetUsd) return { kind: "over-budget", records, spentUsd, estimateUsd };
        }
        dependencies.progress(
          `Round ${String(input.round)}, ${component.name}, repeat ${String(repeat)} of ${String(repeats)}: ${kind}\n`,
        );
        const ran = await dependencies.run({ component: component.name, repeat, kind });
        const problem = await dependencies.restore();
        if ("stop" in ran) return { kind: "stopped", records, spentUsd, why: "run", outcome: ran.stop };
        const { record } = ran;
        records.push(record);
        spentUsd += record.totals.costUsd;
        if (record.totals.costEstimated === true) {
          return {
            kind: "stopped",
            records,
            spentUsd,
            why: "estimated",
            message: `Run ${record.id}'s cost is Claude Code's estimate, so an API key didn't pay for it: Claude Code used another login. Measured runs need costs that are exact; log Claude Code out of other accounts for the round, or check that ANTHROPIC_API_KEY reaches it.`,
          };
        }
        if (record.status === "stopped") return { kind: "stopped", records, spentUsd, why: "interrupted" };
        if (problem !== undefined) return { kind: "stopped", records, spentUsd, why: "restore", message: problem };
      }
    }
  }
  return { kind: "done", records, spentUsd };
}

/** Whether an earlier record is a completed run of this round that started where this one would. */
function sameStart(
  record: RunRecord,
  expected: {
    readonly inputs: Readonly<Record<string, string | undefined>>;
    readonly claudeCode: string;
    readonly image: string;
  },
): boolean {
  if (record.status === "running" || record.status === "stopped") return false;
  if (record.versions.framework !== version || record.versions.image !== expected.image) return false;
  if (record.versions.claudeCode !== expected.claudeCode) return false;
  return (["spec", "tokens", "conventions", "config"] as const).every(
    (key) => record.inputs?.[key] === expected.inputs[key],
  );
}

/** `fazon measure --round <n> --budget <usd> [<component>...] [--repeats <n>]`. */
export async function measure(invocation: Invocation, context: Context): Promise<Outcome> {
  const { environment } = context;
  const repo = environment.cwd;
  const round = Number(invocation.options.round);
  const members = roundComponents[round];
  if (members === undefined) {
    return refused(
      `--round must be ${Object.keys(roundComponents).join(" or ")}: the rounds the measurement protocol defines.`,
      "fazon measure --round 1 --budget 300",
    );
  }
  const repeats = invocation.options.repeats === undefined ? defaultRepeats : Number(invocation.options.repeats);
  if (!Number.isInteger(repeats) || repeats < 1) return refused("--repeats must be a whole number from 1.");
  const budgetUsd = Number(invocation.options.budget);
  if (!(budgetUsd > 0)) {
    return refused(
      "A round needs --budget, what's left of the measurement budget in USD.",
      `fazon measure --round ${String(round)} --budget 300`,
    );
  }

  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) return refused(`The adapter '${config.adapter}' isn't in this version of fazon.`);
  if (judgeCredential(environment.env)?.kind !== "api-key") {
    return refused(
      "Measured runs need an API key (ANTHROPIC_API_KEY), so that their costs are exact: other credentials aren't used for measurements.",
    );
  }
  const checkout = await measuredCheckoutProblem(context, "A measurement round");
  if (checkout !== undefined) return checkout;

  const { components, problems } = await loadComponents(repo, config, adapter);
  if (problems.length > 0) {
    return refused(`${problems[0]?.file ?? "A spec"} doesn't pass fazon spec check.`, "fazon spec check");
  }
  const roundNames = members === "all" ? components.map((c) => c.name) : [...members];
  const names = invocation.positionals.length === 0 ? roundNames : [...invocation.positionals];
  const outside = names.filter((name) => !roundNames.includes(name));
  if (outside.length > 0) {
    return refused(
      `Round ${String(round)} measures ${roundNames.join(", ")}; ${outside.join(", ")} ${outside.length === 1 ? "isn't" : "aren't"} in it.`,
    );
  }
  const absent = names.filter((name) => !components.some((c) => c.name === name));
  if (absent.length > 0) {
    return refused(
      `Round ${String(round)} measures ${absent.join(", ")}, which ${absent.length === 1 ? "has" : "have"} no spec here.`,
    );
  }

  // Every component must be ready for a generate run, as `fazon generate` checks it.
  const setups: AgentCommandSetup[] = [];
  for (const name of names) {
    const setup = await prepareLoopCommand("generate", { positionals: [name], options: {} }, context);
    if ("stop" in setup) return setup.stop;
    setups.push(setup);
  }

  // The runs delete untracked files in the components directory, so it may have none of a person's.
  const directory = config.paths.components.split("\\").join("/");
  const git = (args: readonly string[]) => environment.exec("git", [...args], { cwd: repo });
  const untracked = await git(["status", "--porcelain", "--untracked-files=all", "--", directory]);
  if (untracked?.exitCode !== 0) {
    return { status: "error", messages: [{ level: "error", text: "git status failed in the components directory." }] };
  }
  if (untracked.stdout.trim() !== "") {
    return refused(
      `${directory}/ has untracked files, which the round's clean-ups would delete: ${untracked.stdout
        .trim()
        .split("\n")
        .map((line) => line.slice(3))
        .join(", ")}. Commit or move them first.`,
      "git status",
    );
  }
  const before = await git(["status", "--porcelain", "--untracked-files=all"]);
  const untrackedBefore = new Set((before?.stdout ?? "").split("\n").filter((line) => line !== ""));

  // Completed runs of this round from an earlier invocation, when they started where these would.
  const earlier: RunRecord[] = [];
  let leftOut = 0;
  for (const id of await listRunIds(repo)) {
    const record = await readRunRecord(runDirectory(repo, id));
    if (record?.measurement?.round !== round || (record.kind !== "propose" && record.kind !== "generate")) continue;
    const setup = setups.find((entry) => entry.spec.spec.name === record.component);
    if (setup === undefined || record.measurement.repeat > repeats) continue;
    const inputs = await readRunInputs(setup, { api: false });
    if (sameStart(record, { inputs, claudeCode: setup.claudeCode.version, image: config.image })) earlier.push(record);
    else if (record.status !== "running") leftOut += 1;
  }

  const messages: Message[] = [];
  if (
    JSON.stringify(config.loop) !== JSON.stringify(configDefaults.loop) ||
    JSON.stringify(config.models) !== JSON.stringify(configDefaults.models)
  ) {
    messages.push({
      level: "warning",
      text: "fazon.yaml sets caps or models other than the defaults; the protocol measures the defaults unless an experiment says otherwise. The run records name the settings used.",
    });
  }
  if (earlier.length > 0) {
    messages.push({
      level: "info",
      text: `${String(earlier.length)} runs of round ${String(round)} from an earlier invocation are kept: they started from the same inputs and versions.`,
    });
  }
  if (leftOut > 0) {
    messages.push({
      level: "warning",
      text: `${String(leftOut)} earlier runs of round ${String(round)} are left out: they started from other inputs or versions.`,
    });
  }

  const progress = (text: string) => {
    if (context.global.verbose || !context.global.json) context.stderr?.(text);
  };
  // The runs' own progress only with --verbose: the round prints its own.
  const quiet: Context = {
    environment: context.environment,
    global: context.global,
    stderr: (text) => {
      if (context.global.verbose) context.stderr?.(text);
    },
  };
  const restore = async (): Promise<string | undefined> => {
    const restored = await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
    const cleaned = await git(["clean", "-fdq", "--", directory]);
    if (restored?.exitCode !== 0 || cleaned?.exitCode !== 0) return "git couldn't restore the checkout after the run.";
    const after = await git(["status", "--porcelain", "--untracked-files=all"]);
    const left = (after?.stdout ?? "").split("\n").filter((line) => line !== "" && !untrackedBefore.has(line));
    return left.length === 0
      ? undefined
      : `The checkout isn't clean after the run: ${left.map((line) => line.slice(3)).join(", ")}. Restore it before the round goes on.`;
  };
  const run: MeasureDependencies["run"] = async (step) => {
    const measurement = { round, repeat: step.repeat };
    let outcome: Outcome;
    if (step.kind === "propose") {
      outcome = await propose({ positionals: [step.component], options: {} }, quiet, measurement);
    } else {
      const setup = await prepareLoopCommand("generate", { positionals: [step.component], options: {} }, quiet);
      if ("stop" in setup) return setup;
      outcome = await runLoopCommand(setup, { kind: "generate", clean: true, measurement }, quiet);
    }
    const id = outcome.result?.run;
    const record = typeof id === "string" ? await readRunRecord(runDirectory(repo, id)) : undefined;
    return record === undefined ? { stop: outcome } : { record };
  };

  const ordered = names.map((name) => ({
    name,
    specName: setups.find((setup) => setup.component === name)?.spec.spec.name ?? name,
  }));
  const ended = await measureRound({
    round,
    repeats,
    components: ordered,
    budgetUsd,
    capUsd: config.loop.budgetUsd,
    earlier,
    dependencies: { run, restore, progress },
  });

  const metrics = roundMetrics(
    ended.records,
    ordered.map((c) => c.specName),
  );
  const text = metricsText(metrics.components, metrics.library);
  const result = {
    round,
    repeats,
    spentUsd: ended.spentUsd,
    runs: ended.records.map((record) => ({
      run: record.id,
      component: record.component,
      repeat: record.measurement?.repeat,
      kind: record.kind,
      status: record.status,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      iterations: record.totals.iterations,
      costUsd: record.totals.costUsd,
    })),
    metrics,
  };
  const spent = `$${ended.spentUsd.toFixed(2)} spent by this invocation`;
  switch (ended.kind) {
    case "done":
      return {
        status: "ok",
        text,
        result,
        messages: [
          ...messages,
          {
            level: "info",
            text: `Round ${String(round)} is complete: ${String(ended.records.length)} runs, ${spent}.`,
          },
        ],
      };
    case "over-budget":
      return {
        status: "needs-a-person",
        text,
        result,
        messages: [
          ...messages,
          {
            level: "error",
            text: `The rest of round ${String(round)} would cost about $${ended.estimateUsd.toFixed(2)}, past the $${(budgetUsd - ended.spentUsd).toFixed(2)} left of --budget (${spent}). The maintainer decides: a larger budget, fewer repeats or fewer components. Running the command again keeps the runs made so far.`,
          },
        ],
      };
    case "stopped": {
      const stopped: Message[] = ended.outcome?.messages.filter((m) => m.level === "error") ?? [];
      if (ended.message !== undefined) stopped.push({ level: "error", text: ended.message });
      stopped.push({
        level: ended.why === "interrupted" ? "warning" : "error",
        text: `Round ${String(round)} stopped (${spent}). Running the command again keeps the completed runs.`,
      });
      return {
        status:
          ended.why === "interrupted"
            ? "interrupted"
            : ended.why === "run"
              ? (ended.outcome?.status ?? "error")
              : "error",
        text,
        result,
        messages: [...messages, ...stopped],
      };
    }
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/** One line per component and one for the library. */
function metricsText(
  components: readonly { readonly component: string; readonly metrics: LoopMetrics }[],
  library: LoopMetrics,
): TextLine[] {
  const line = (name: string, m: LoopMetrics): TextLine => ({
    stream: "stdout",
    text: [
      `${name}: ${String(m.pass.k)}/${String(m.pass.n)} passed (${percent(m.pass.value)}), ${String(m.firstPass.k)} on the first iteration`,
      m.iterations === undefined ? undefined : `iterations median ${String(m.iterations.median)}`,
      `escalated ${String(m.escalation.k)}`,
      `$${m.costPerRun.median.toFixed(2)} per run (median)`,
      m.costPerPassedUsd === undefined ? undefined : `$${m.costPerPassedUsd.toFixed(2)} per passed component`,
      Object.keys(m.stops).length === 0
        ? undefined
        : `stops: ${Object.entries(m.stops)
            .map(([reason, n]) => `${reason} ${String(n)}`)
            .join(", ")}`,
    ]
      .filter((part) => part !== undefined)
      .join("; "),
  });
  return [...components.map((entry) => line(entry.component, entry.metrics)), line("Library", library)];
}
