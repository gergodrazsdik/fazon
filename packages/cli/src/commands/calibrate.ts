// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon calibrate --round <n>` (docs/spec/cli.md#fazon-calibrate): a judge calibration round.
// On the host it refuses as `measure` does, verifies the round's components (they must pass every
// check), and starts the verifier image, which renders every story unmodified and with each
// mutation case into the verify run's `calibration/` directory (`--in-image <run>`, internal).
// Then the judge, through the Message Batches API in stages within `--budget`, the round's
// measures, and the calibration record at `--out`.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  calibrateInImage,
  calibrationDirectory,
  calibrationRecord,
  judgeCredential,
  judgeRound,
  judgeSdkClient,
  judgeVersion,
  missingCredential,
  priceOf,
  roundMeasures,
  sdkBatchClient,
  localConfigFileName,
  loadComponents,
  rendersFile,
  runDirectory,
  runsDirectory,
  type CalibrationRenders,
} from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { ensureImage, findRuntime, mountRoot, runArguments } from "../container.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { passComponents } from "../judge.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };
import { inImageCli, passedThrough, verify } from "./verify.js";
import { isSet } from "../environment.js";

/** Each round's components (docs/spec/measurement.md#judge-calibration); `all` is every component with a spec. */
export const roundComponents: Readonly<Record<number, readonly string[] | "all">> = {
  1: ["button", "badge", "link", "dialog"],
  2: "all",
};

/** The image's limit for a round's renders: hundreds of renders per component. */
const rendersTimeoutMs = 12 * 60 * 60_000;

/** Repeats per call in a round: self-agreement needs them (docs/spec/measurement.md#measures). */
const roundRepeats = 5;

function environmentError(text: string, hint?: string): Outcome {
  return { status: "error", messages: [{ level: "error", text, ...(hint === undefined ? {} : { hint }) }] };
}

export async function calibrate(invocation: Invocation, context: Context): Promise<Outcome> {
  const inImage = invocation.options["in-image"];
  if (typeof inImage === "string") return calibrateInside(inImage, invocation, context);
  const { environment } = context;
  const repo = environment.cwd;

  const round = Number(invocation.options.round);
  const members = roundComponents[round];
  if (members === undefined) {
    return refused(
      `--round must be ${Object.keys(roundComponents).join(" or ")}: the rounds the measurement protocol defines.`,
      "fazon calibrate --round 1",
    );
  }
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) return refused(`The adapter '${config.adapter}' isn't in this version of fazon.`);

  const budget = Number(invocation.options.budget);
  const out = invocation.options.out;
  if (!(budget > 0) || typeof out !== "string") {
    return refused(
      "A round needs --budget, what's left of the measurement budget in USD, and --out, the calibration record's path.",
      `fazon calibrate --round ${String(round)} --budget 147 --out calibration/judge-${String(judgeVersion)}/claude-sonnet-5-5.json`,
    );
  }
  const model = typeof invocation.options.model === "string" ? invocation.options.model : config.models.judge;
  const price = priceOf(config.prices, model);
  if (price === undefined) {
    return refused(`The model ${model} has no price in fazon.yaml's prices or the framework's table (CONFIG-005).`);
  }
  const credential = judgeCredential(environment.env);
  if (credential === undefined)
    return environmentError(`A calibration round calls the judge: ${missingCredential}.`, "fazon doctor");
  if (credential.kind !== "api-key") {
    return refused(
      "A calibration round needs an API key (ANTHROPIC_API_KEY), as measured runs do: other credentials aren't used for measurements.",
    );
  }
  const records =
    typeof invocation.options.records === "string"
      ? invocation.options.records
      : await releaseAsset(environment, repo, round);
  if (records === undefined) {
    return refused(
      "The record links to the release that will hold the round's records; this checkout's origin isn't on GitHub, so name it with --records.",
    );
  }

  // The refusals of a measured run (docs/spec/cli.md#fazon-measure).
  if (
    await access(path.join(repo, localConfigFileName)).then(
      () => true,
      () => false,
    )
  ) {
    return refused(
      `A calibration round runs without ${localConfigFileName}: its overrides would change what's measured. Move it aside first.`,
    );
  }
  const status = await environment.exec("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repo });
  if (status?.exitCode !== 0) return environmentError("git status failed: a calibration round needs a git checkout.");
  if (status.stdout.trim() !== "") {
    return refused("A calibration round runs from a clean checkout: commit or stash the changes first.", "git status");
  }

  const { components, problems } = await loadComponents(repo, config, adapter);
  if (problems.length > 0)
    return refused(`${problems[0]?.file ?? "A spec"} doesn't pass fazon spec check.`, "fazon spec check");
  const names = members === "all" ? components.map((c) => c.name) : [...members];
  const missing = names.filter((name) => !components.some((c) => c.name === name));
  if (missing.length > 0) {
    return refused(
      `Round ${String(round)} calibrates ${names.join(", ")}, but ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no spec here.`,
    );
  }

  // The round's components must pass every check (docs/spec/measurement.md#judge-calibration).
  const verified = await verify({ positionals: names, options: { "no-judge": true } }, context);
  const result = verified.result as { run?: unknown } | undefined;
  const run = typeof result?.run === "string" ? result.run : undefined;
  if (verified.status !== "ok" || run === undefined) {
    return {
      status: verified.status === "error" ? "error" : "refused",
      messages: [
        ...verified.messages.filter((message) => message.level === "error"),
        {
          level: "error",
          text: `A calibration round runs on components that pass every check; ${names.join(", ")} don't yet.`,
          hint: `fazon verify ${names.join(" ")}`,
        },
      ],
    };
  }

  const runtime = await findRuntime(environment);
  if ("problem" in runtime) return environmentError(runtime.problem, "fazon doctor");
  const stream = (text: string) => {
    if (context.global.verbose || !context.global.json) context.stderr?.(text);
  };
  const pulled = await ensureImage(environment, runtime.runtime, config.image, stream);
  if (pulled !== undefined) return environmentError(pulled);
  const cli = await inImageCli(repo);
  const mount = await mountRoot(repo, cli.package);
  if ("problem" in mount) return environmentError(mount.problem);
  const runDir = runDirectory(repo, run);
  stream(
    `Calibration round ${String(round)}: rendering ${names.join(", ")} unmodified and with every case, in ${config.image}\n`,
  );
  const env = Object.fromEntries(
    passedThrough.filter((name) => isSet(environment, name)).map((name) => [name, environment.env[name] ?? ""]),
  );
  const ran = await environment.exec(
    runtime.runtime,
    runArguments({
      runtime,
      image: config.image,
      root: mount.root,
      repo,
      runDir,
      bin: cli.bin,
      args: ["calibrate", "--in-image", run, ...names, ...(context.global.verbose ? ["--verbose"] : [])],
      env,
      ...(environment.user === undefined ? {} : { user: environment.user }),
    }),
    { timeoutMs: rendersTimeoutMs, stream },
  );
  let renders: CalibrationRenders;
  try {
    renders = JSON.parse(
      await readFile(path.join(runDir, calibrationDirectory, rendersFile), "utf8"),
    ) as CalibrationRenders;
  } catch {
    const tail = (ran?.stderr ?? "").trim().split("\n").slice(-8).join("\n");
    return environmentError(
      `The renders didn't finish in the verifier image (exit ${String(ran?.exitCode ?? "-")}):\n${tail}`,
    );
  }
  const directory = `${runsDirectory}/${run}/${calibrationDirectory}`;
  const chosen = components.filter((component) => names.includes(component.name));
  const client = environment.judgeBatchClient?.(credential) ?? sdkBatchClient(judgeSdkClient(credential));
  const judged = await judgeRound({
    repo,
    roundDir: path.join(runDir, calibrationDirectory),
    baselines: config.paths.baselines,
    components: await passComponents(repo, chosen),
    library: components,
    renders,
    model,
    ...(config.effort.judge === undefined ? {} : { effort: config.effort.judge }),
    repeats: roundRepeats,
    price,
    budgetUsd: budget,
    client,
    ...(environment.interrupt === undefined ? {} : { signal: environment.interrupt }),
    progress: stream,
  });
  const resultsFile = path.join(runDir, calibrationDirectory, `judge-${model}.json`);
  await writeFile(resultsFile, `${JSON.stringify({ fazon: 0, judgeVersion, model, calls: judged.calls }, null, 2)}\n`);
  if (judged.kind === "over-budget") {
    const outcome = summary(round, run, renders, directory);
    return {
      ...outcome,
      status: "needs-a-person",
      messages: [
        ...outcome.messages,
        {
          level: "error",
          text: `The unmodified components cost $${judged.costUsd.toFixed(2)}; the cases would cost about $${judged.estimateUsd.toFixed(2)} more, past the $${budget.toFixed(2)} left. The maintainer decides: a larger --budget, or fewer repeats.`,
        },
      ],
    };
  }
  const measures = roundMeasures(renders, judged.calls, judged.costUsd);
  const record = calibrationRecord({
    judge: judgeVersion,
    model,
    framework: version,
    round,
    date: new Date().toISOString().slice(0, 10),
    components: chosen.map((component) => component.spec.name),
    measures,
    records,
  });
  const target = path.resolve(repo, out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`);
  const outcome = summary(round, run, renders, directory);
  const percent = (x: number) => `${(x * 100).toFixed(1)}%`;
  return {
    ...outcome,
    messages: [
      ...outcome.messages,
      {
        level: measures.calibrated ? "info" : "warning",
        text: `${model}: catch rate ${percent(measures.catchRate.value)} of ${String(measures.catchRate.n)} viewer-only cases, false positives ${percent(measures.falsePositiveRate.value)} of ${String(measures.falsePositiveRate.n)} stories, self-agreement ${percent(measures.selfAgreement.value)}; $${measures.costUsd.total.toFixed(2)}. ${measures.calibrated ? "Every threshold is met: the judge is calibrated for this model." : "Not every threshold or sample size is met: the judge stays advisory for this model."} The record is ${out}.`,
      },
    ],
    result: { ...(outcome.result as Record<string, unknown>), record: out, measures },
  };
}

/** `https://github.com/<owner>/<repo>/releases/download/measurement-<round>/records.tar.gz`, from the origin remote. */
async function releaseAsset(
  environment: Context["environment"],
  repo: string,
  round: number,
): Promise<string | undefined> {
  const remote = await environment.exec("git", ["remote", "get-url", "origin"], { cwd: repo });
  const match = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(remote?.stdout ?? "");
  if (match === null) return undefined;
  return `https://github.com/${match[1] ?? ""}/${match[2] ?? ""}/releases/download/measurement-${String(round)}/records.tar.gz`;
}

/** The renders' outcome: each component's cases by operator. */
function summary(round: number, run: string, renders: CalibrationRenders, directory: string): Outcome {
  const text: TextLine[] = [];
  const messages: Message[] = [];
  for (const component of renders.components) {
    const byOperator = new Map<string, number>();
    for (const entry of component.cases) byOperator.set(entry.operator, (byOperator.get(entry.operator) ?? 0) + 1);
    text.push({
      stream: "stdout",
      text: `${component.name}: ${String(component.cases.length)} cases (${[...byOperator].map(([operator, n]) => `${operator} ${String(n)}`).join(", ")}); ${String(component.unchanged.length)} changed nothing`,
    });
    if (component.unmodifiedFindings.length > 0) {
      messages.push({
        level: "warning",
        text: `${component.name} unmodified has blocking findings in the renders (${component.unmodifiedFindings.join(", ")}), though its verify run passed; its check catch rates can't be trusted.`,
      });
    }
  }
  const viewerOnly = renders.components.flatMap((c) => c.cases).filter((c) => c.class === "viewer-only").length;
  messages.push({
    level: "info",
    text: `Round ${String(round)}: ${String(viewerOnly)} viewer-only cases rendered into ${directory}.`,
  });
  return {
    status: "ok",
    messages,
    text,
    result: {
      round,
      run,
      renders: `${directory}/${rendersFile}`,
      components: renders.components.map((c) => ({
        component: c.name,
        cases: c.cases.map(({ id, operator, class: kind, affected, checks }) => ({
          id,
          operator,
          class: kind,
          affected: affected.length,
          checks,
        })),
        unchanged: c.unchanged,
      })),
    },
  };
}

/** The in-image part: renders the round into the verify run's directory. */
async function calibrateInside(run: string, invocation: Invocation, context: Context): Promise<Outcome> {
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) return refused(`The adapter '${config.adapter}' isn't in this version of fazon.`);
  const repo = context.environment.cwd;
  const outcome = await calibrateInImage({
    repo,
    runDir: runDirectory(repo, run),
    config,
    adapter,
    names: invocation.positionals,
    log: (text) => context.stderr?.(text.endsWith("\n") ? text : `${text}\n`),
  });
  if (outcome.kind === "environment") {
    return { status: "error", messages: outcome.problems.map((text) => ({ level: "error", text })) };
  }
  return {
    status: "ok",
    messages: [{ level: "info", text: `The round's renders are in ${runsDirectory}/${run}/${calibrationDirectory}.` }],
  };
}
