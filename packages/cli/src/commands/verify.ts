// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon verify [<component>...] [--base <ref>] [--no-judge]` (docs/spec/cli.md#fazon-verify): a
// verify run. On the host it checks the environment, writes the run's first record, and starts the
// pinned verifier image; inside the image (`--in-image <run>`, an internal option) the checks run.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capturePlatform,
  compareWithBase,
  findPackage,
  findingComponent,
  gitBlobId,
  hashText,
  hashTokenSet,
  listBaselineFiles,
  loadComponents,
  newRunId,
  ociPlatform,
  readRunRecord,
  readVerifyDetails,
  resolveTokenSet,
  runDirectory,
  runsDirectory,
  verifyInImage,
  writeRunRecord,
  writeVerifyDetails,
  type CheckFinding,
  type CheckResult,
  type Config,
  type RunRecord,
  type VerifyComponent,
  type VerifyDetails,
} from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { containerScratch, ensureImage, findRuntime, mountRoot, runArguments } from "../container.js";
import { isSet, type Environment } from "../environment.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

/**
 * The CLI the image runs: the one the repository installs, as its lockfile pins it, or this one
 * when the repository doesn't install it (as in the framework's own development).
 */
async function inImageCli(repo: string): Promise<{ package: string; bin: string }> {
  const installed = await findPackage(repo, "fazon");
  if (installed !== undefined) {
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.fazon;
    if (bin !== undefined) return { package: installed, bin: path.join(installed, bin) };
  }
  return {
    package: fileURLToPath(new URL("../../", import.meta.url)),
    bin: fileURLToPath(new URL("../bin.js", import.meta.url)),
  };
}

/** The judge's version this framework version records; the judge itself arrives in M3. */
export const judgeVersion = 1;

/** Variables the container gets from the host, when set. Never a credential (CLI-003). */
const passedThrough = ["CI", "NO_COLOR"] as const;

export async function verify(invocation: Invocation, context: Context): Promise<Outcome> {
  const inImage = invocation.options["in-image"];
  if (typeof inImage === "string") return verifyInside(inImage, invocation, context);
  return verifyOnHost(invocation, context);
}

/** The components the arguments name, or a refusal. */
function chooseComponents(
  names: readonly string[],
  components: readonly VerifyComponent[],
): { chosen: VerifyComponent[] } | { refusal: Outcome } {
  const unknown = names.filter((name) => !components.some((c) => c.name === name));
  if (unknown.length > 0) {
    return {
      refusal: refused(
        `No spec names ${unknown.join(", ")}: the components are ${components.map((c) => c.name).join(", ") || "none yet"}. Name a component in kebab-case, as its spec's file name.`,
        "fazon verify",
      ),
    };
  }
  return { chosen: names.length === 0 ? [...components] : components.filter((c) => names.includes(c.name)) };
}

async function verifyOnHost(invocation: Invocation, context: Context): Promise<Outcome> {
  const { environment } = context;
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) {
    return refused(`fazon.yaml names the adapter '${config.adapter}', which this version of fazon doesn't have.`);
  }
  const repo = environment.cwd;
  const { components, problems } = await loadComponents(repo, config, adapter);
  if (problems.length > 0) {
    return {
      status: "refused",
      messages: [
        ...problems.map((p): Message => ({ level: "error", text: `${p.file}: ${p.message}` })),
        { level: "error", text: "fazon verify needs specs that pass `fazon spec check`.", hint: "fazon spec check" },
      ],
    };
  }
  const names = [...new Set(invocation.positionals)];
  const chosen = chooseComponents(names, components);
  if ("refusal" in chosen) return chosen.refusal;

  const base = invocation.options.base;
  if (typeof base === "string") {
    const known = await environment.exec("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], {
      cwd: repo,
    });
    if (known?.exitCode !== 0) {
      return refused(`--base ${base} isn't a commit git knows here. Fetch it first, or name another ref.`);
    }
  }

  // The environment: the platform, a container runtime, the image, and a directory to mount. The
  // image runs the repository's installed dependencies, which have native code for the host.
  const platform = ociPlatform();
  if (platform !== capturePlatform) {
    return environmentError(
      `fazon verify runs the repository's installed dependencies in the verifier image, which is ${capturePlatform}; this machine is ${platform}. Run it on ${capturePlatform}, such as in CI, until the image can install them itself.`,
    );
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

  // The run: its first record, then the checks in the image.
  const started = new Date();
  const id = newRunId(started, "verify");
  const runDir = runDirectory(repo, id);
  let record = await firstRecord(id, started, config, repo);
  await writeRunRecord(runDir, record);
  stream(`Verify run ${id}: ${chosen.chosen.map((c) => c.name).join(", ") || "no components"}, in ${config.image}\n`);

  const args = ["verify", "--in-image", id, ...names, ...(context.global.verbose ? ["--verbose"] : [])];
  const env = Object.fromEntries(
    passedThrough.filter((name) => isSet(environment, name)).map((name) => [name, environment.env[name] ?? ""]),
  );
  const result = await environment.exec(
    runtime.runtime,
    runArguments({
      runtime,
      image: config.image,
      root: mount.root,
      repo,
      runDir,
      bin: cli.bin,
      args,
      env,
      ...(environment.user === undefined ? {} : { user: environment.user }),
    }),
    { timeoutMs: config.loop.runMinutes * 60_000, stream },
  );

  record = (await readRunRecord(runDir)) ?? record;
  const messages: Message[] = [];
  if (record.status === "running") {
    // The run stopped before it ended: the image couldn't run the checks.
    const tail = (result?.stderr ?? "").trim().split("\n").slice(-8).join("\n");
    const ended = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    record = { ...record, status: "needs-a-person", reason: "check-error", ended };
    await writeRunRecord(runDir, record);
    return environmentError(
      result === undefined
        ? `${runtime.runtime} couldn't be started.`
        : `The checks couldn't run in the verifier image (exit ${String(result.exitCode)}):\n${tail}`,
      result?.exitCode === 3 ? "fazon doctor" : undefined,
      { run: id, record: `${runsDirectory}/${id}/run.json` },
    );
  }

  let details = await readVerifyDetails(runDir);
  if (typeof base === "string" && details !== undefined) {
    details = { ...details, base: { ref: base, changes: await baseChanges(environment, repo, config, base) } };
    await writeVerifyDetails(runDir, details);
  }
  if (invocation.options["no-judge"] !== true && config.judge.policy !== "off") {
    messages.push({
      level: "warning",
      text: "The judge isn't available yet (it arrives in M3), so this run has no judge verdicts. --no-judge skips it explicitly.",
    });
  }
  return outcome(id, record, details, chosen.chosen, components, messages);
}

function environmentError(text: string, hint?: string, result?: Record<string, unknown>): Outcome {
  return {
    status: "error",
    messages: [{ level: "error", text, ...(hint === undefined ? {} : { hint }) }],
    ...(result === undefined ? {} : { result }),
  };
}

async function firstRecord(id: string, started: Date, config: Config, repo: string): Promise<RunRecord> {
  const inputs: Record<string, string> = {};
  try {
    const { tokenSet } = await resolveTokenSet(path.join(repo, config.paths.tokens));
    if (tokenSet !== undefined) inputs.tokens = hashTokenSet(tokenSet);
  } catch {
    // A token set that can't be read has no hash; the checks report it.
  }
  try {
    inputs.config = hashText(await readFile(path.join(repo, "fazon.yaml"), "utf8"));
  } catch {
    // requireConfig read it; a race leaves the hash out.
  }
  return {
    fazon: 0,
    id,
    kind: "verify",
    status: "running",
    started: started.toISOString().replace(/\.\d{3}Z$/, "Z"),
    versions: { framework: version, adapter: version, claudeCode: "none", image: config.image, judge: judgeVersion },
    inputs,
    config: {
      caps: {
        iterations: config.loop.iterations,
        budgetUsd: config.loop.budgetUsd,
        runMinutes: config.loop.runMinutes,
        callMinutes: config.loop.callMinutes,
      },
      models: config.models,
      escalateAfter: config.loop.escalateAfter,
      judgePolicy: config.judge.policy,
      judgeCalibrated: false,
    },
    iterations: [],
    handEdits: [],
    totals: { iterations: 0, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 0, escalated: false },
  };
}

/** The baselines that differ from those at the ref, with git on the host. */
async function baseChanges(environment: Environment, repo: string, config: Config, ref: string) {
  const directory = config.paths.baselines.split(path.sep).join("/");
  const listed = await environment.exec("git", ["ls-tree", "-r", "--full-tree", ref, "--", directory], {
    cwd: repo,
    timeoutMs: 60_000,
  });
  const base = new Map<string, string>();
  for (const line of (listed?.stdout ?? "").split("\n")) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    base.set(path.posix.relative(directory, match[2]), match[1]);
  }
  const current = new Map<string, string>();
  const dir = path.join(repo, config.paths.baselines);
  for (const file of await listBaselineFiles(dir)) {
    current.set(file, gitBlobId(new Uint8Array(await readFile(path.join(dir, file)))));
  }
  return compareWithBase(base, current);
}

const checkOrder = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;

function describeFinding(finding: CheckFinding): string {
  const where =
    finding.story !== undefined
      ? `${finding.story} (${finding.theme ?? ""})${finding.selector === undefined ? "" : ` ${finding.selector}`}`
      : finding.file === undefined
        ? ""
        : `${finding.file}${finding.line === undefined ? "" : `:${String(finding.line)}`}${finding.column === undefined ? "" : `:${String(finding.column)}`}`;
  return `${finding.check}/${finding.rule}${where === "" ? "" : ` ${where}`}: ${finding.message.split("\n")[0] ?? ""}`;
}

/** The command's outcome from the run's record and details. */
export function outcome(
  id: string,
  record: RunRecord,
  details: VerifyDetails | undefined,
  chosen: readonly VerifyComponent[],
  all: readonly VerifyComponent[],
  messages: Message[] = [],
): Outcome {
  const checks: readonly CheckResult[] = record.verification?.checks ?? [];
  const text: TextLine[] = [];
  const components = chosen.map((component) => {
    const statuses = details?.components.find((c) => c.name === component.name)?.checks ?? {};
    const findings = checks.flatMap((check) =>
      check.findings.filter((finding) => {
        const owner = findingComponent(finding, all);
        return owner === component.name;
      }),
    );
    const stories = (details?.stories ?? []).filter((s) => s.component === component.name);
    const count = (status: string) => stories.filter((s) => s.status === status).length;
    text.push({
      stream: "stdout",
      text: `${component.name}: ${checkOrder.map((check) => `${check} ${statuses[check] ?? "-"}`).join(", ")}; stories: ${String(count("unchanged"))} unchanged, ${String(count("changed"))} changed, ${String(count("new"))} new`,
    });
    return {
      component: component.name,
      checks: statuses,
      findings,
      stories: { unchanged: count("unchanged"), changed: count("changed"), new: count("new") },
      judge: { available: false },
    };
  });
  const unowned = checks.flatMap((check) =>
    check.findings.filter((finding) => findingComponent(finding, all) === undefined),
  );
  const blocking = checks.flatMap((check) => check.findings.filter((f) => f.blocking));
  for (const finding of blocking) text.push({ stream: "stdout", text: `  ${describeFinding(finding)}` });
  for (const check of checks.filter((c) => c.status === "error" || c.status === "skipped")) {
    text.push({
      stream: "stdout",
      text: `  ${check.check} ${check.status === "error" ? "ended in error" : "was skipped"}: ${(check.message ?? "").split("\n")[0] ?? ""}`,
    });
  }
  for (const change of details?.base?.changes ?? []) {
    text.push({
      stream: "stdout",
      text: `  baseline ${change.mark}: ${change.path}${change.from === undefined ? "" : ` (from ${change.from})`}`,
    });
  }
  for (const unused of details?.unusedExemptions ?? []) {
    text.push({
      stream: "stdout",
      text: `  unused exemption: ${unused.component} ${unused.check}/${unused.rule} (#${String(unused.index)})`,
    });
  }

  const errored = checks.filter((check) => check.status === "error");
  const status = errored.length > 0 ? "error" : record.status === "passed" ? "ok" : "failed";
  const recordPath = `${runsDirectory}/${id}/run.json`;
  messages.push(
    status === "ok"
      ? { level: "info", text: `Every check passed. The run's record is ${recordPath}.` }
      : status === "error"
        ? {
            level: "error",
            text: `${errored.map((c) => c.check).join(", ")} couldn't run to the end; the run's record is ${recordPath}, and its logs are beside it.`,
          }
        : {
            level: "error",
            text: `${String(blocking.length)} blocking ${blocking.length === 1 ? "finding" : "findings"}; the run's record is ${recordPath}, with captures and diffs beside it.`,
          },
  );
  if (status !== "error" && (details?.stories ?? []).some((s) => s.status === "new" || s.status === "changed")) {
    messages.push({
      level: "info",
      text: "Stories without a baseline, or that changed, get baselines from `fazon baseline update` once the run qualifies.",
      hint: `fazon baseline update ${chosen.map((c) => c.name).join(" ")}`,
    });
  }
  return {
    status,
    messages,
    text,
    result: {
      run: id,
      record: recordPath,
      runStatus: record.status,
      checks: checks.map((check) => ({
        check: check.check,
        status: check.status,
        ...(check.message === undefined ? {} : { message: check.message }),
      })),
      components,
      findings: unowned,
      orphans: details?.orphans ?? [],
      ...(details?.base === undefined ? {} : { base: details.base }),
      unusedExemptions: details?.unusedExemptions ?? [],
      judge: { available: false },
    },
  };
}

/** The in-image part: runs the checks and writes the record; the host reads it. */
async function verifyInside(id: string, invocation: Invocation, context: Context): Promise<Outcome> {
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) return refused(`The adapter '${config.adapter}' isn't in this version of fazon.`);
  const repo = context.environment.cwd;
  const result = await verifyInImage({
    repo,
    runDir: runDirectory(repo, id),
    config,
    adapter,
    names: invocation.positionals,
    work: path.join(containerScratch, "work"),
    log: (text) => context.stderr?.(`${text}\n`),
  });
  if (result.kind === "environment") {
    return { status: "error", messages: result.problems.map((text) => ({ level: "error", text })) };
  }
  return {
    status: "ok",
    messages: [{ level: "info", text: `The checks ran; the record is ${runsDirectory}/${id}/run.json.` }],
  };
}
