// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon accept <component>` (docs/spec/cli.md#fazon-accept): decision 2. The component's latest
// generate or feedback run, when it passed and nothing it was checked against changed since, is
// written into the `generation` part of the component's provenance file with the runs linked to it
// (docs/spec/records.md#provenance). The provenance file is the only record of the acceptance: the
// run record has no field for it.
import { createRequire } from "node:module";
import path from "node:path";
import {
  acceptGeneration,
  checksPhaseFiles,
  componentInputsHash,
  heldRunLock,
  linkedRuns,
  listRunIds,
  provenancePath,
  readProvenance,
  readRunRecord,
  readVerifyDetails,
  runDirectory,
  runsDirectory,
  writeProvenance,
  type Provenance,
  type RunRecord,
  type RunStatus,
  type VerifyDetails,
} from "@fazon/core";
import { readComponent, readRunInputs, type ComponentSetup } from "../agent-run.js";
import { refused, type Message, type Outcome } from "../outcome.js";
import type { Context, Invocation } from "./context.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

/** A run ID's label: what's between its time (`YYYYMMDDTHHMMSSZ-`) and its random digits (`-3f9a`). */
function runLabel(id: string): string {
  return id.slice(17, -5);
}

type LatestRun =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly id: string }
  | { readonly kind: "found"; readonly record: RunRecord };

/**
 * The component's latest generate or feedback run. Propose runs write no code, so they're passed
 * over; a newer run of the component whose record can't be read stops the search, as it may be the
 * latest.
 */
async function latestAgentRun(root: string, component: string, name: string): Promise<LatestRun> {
  for (const id of await listRunIds(root)) {
    if (runLabel(id) !== component) continue;
    const record = await readRunRecord(runDirectory(root, id));
    if (record === undefined) return { kind: "unreadable", id };
    if (record.component === name && (record.kind === "generate" || record.kind === "feedback")) {
      return { kind: "found", record };
    }
  }
  return { kind: "none" };
}

/** Why a run that didn't pass can't be accepted, and what to run instead. */
function notPassed(record: RunRecord, component: string): Outcome {
  const why: Readonly<Record<Exclude<RunStatus, "passed">, string>> = {
    running:
      "it's still recorded as running, but no process holds the component's run lock, so it ended without finishing",
    "needs-a-person": `it needs a person${record.reason === undefined ? "" : ` (${record.reason})`}`,
    stopped: "it was interrupted",
    failed: "it failed",
  };
  const status = record.status as Exclude<RunStatus, "passed">;
  return refused(
    `${record.component ?? component}'s latest run, ${record.id}, didn't pass: ${why[status]}. Only a run that passed can be accepted. Read its report, then run fazon feedback or fazon generate again.`,
    `fazon report ${component}`,
  );
}

/** The new, changed and orphaned stories of the component in a run's last checks: what `fazon baseline update` writes or removes. */
function baselineChanges(details: VerifyDetails | undefined, component: string) {
  const stories = details?.stories.filter((story) => story.component === component) ?? [];
  return {
    new: stories.filter((story) => story.status === "new").map((story) => story.path),
    changed: stories.filter((story) => story.status === "changed").map((story) => story.path),
    orphans: (details?.orphans ?? []).filter((orphan) => orphan.path.split("/")[1] === component).map((o) => o.path),
  };
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * What changed since the run that refuses its acceptance (docs/spec/cli.md#fazon-accept): the spec,
 * the approved API, the token set, or the component's files since its last checks; and, as
 * warnings, the conventions doc and the config.
 */
async function changesSince(
  setup: ComponentSetup,
  record: RunRecord,
  provenance: Provenance,
  details: VerifyDetails | undefined,
  checkFiles: boolean,
): Promise<{ errors: Message[]; warnings: Message[] }> {
  const { repo, config, component, spec } = setup;
  const then = record.inputs ?? {};
  const now = await readRunInputs(setup, { api: true });
  const errors: Message[] = [];
  const warnings: Message[] = [];
  const generate = `fazon generate ${component}`;

  if (then.spec === undefined || then.api === undefined) {
    errors.push({
      level: "error",
      text: `The run ${record.id} recorded no hash of the ${then.spec === undefined ? "spec" : "approved API"} it started from, so fazon can't tell whether it changed since. Generate again.`,
      hint: generate,
    });
    return { errors, warnings };
  }
  if (now.spec !== then.spec) {
    const apiChanged = now.api !== provenance.api.hash;
    errors.push({
      level: "error",
      text: `${spec.file} changed since the run ${record.id} started from it. A run has to check the spec as it is: ${apiChanged ? "its API isn't the approved one either, so approve it, then generate again" : "generate again"}.`,
      hint: apiChanged ? `fazon approve ${component}` : generate,
    });
  }
  if (then.api !== provenance.api.hash) {
    errors.push({
      level: "error",
      text: `The approved API changed since the run ${record.id}: it started from ${then.api}, and ${provenancePath(config.paths.components, spec.spec.name)} approves ${provenance.api.hash} (approved ${provenance.api.approved}). Generate again from the approved API.`,
      hint: generate,
    });
  }
  if (now.tokens !== then.tokens) {
    errors.push({
      level: "error",
      text: `The token set changed since the run ${record.id}, so its checks and captures saw other tokens. Generate again, so a run checks the component with the token set as it is.`,
      hint: generate,
    });
  }
  // The checks' hash covers the spec, the component's directory and the token set: with the spec
  // and the token set unchanged, a different hash means the component's files changed.
  if (checkFiles && errors.length === 0) {
    const last = record.iterations.at(-1);
    const checked = details?.components.find((c) => c.name === component)?.inputs;
    if (last === undefined || checked === undefined) {
      errors.push({
        level: "error",
        text: `The run ${record.id} has no ${last === undefined ? "iteration" : `${checksPhaseFiles(last.n).details} for ${component}`}, so fazon can't tell whether the component's files changed since its checks. Generate again.`,
        hint: generate,
      });
    } else {
      const current = await componentInputsHash(
        repo,
        { name: component, spec: spec.spec, specFile: spec.file, directory: setup.directory, generated: true },
        config.paths.tokens,
      );
      if (current !== checked) {
        errors.push({
          level: "error",
          text: `Files in ${setup.directory}/ changed since the run ${record.id} checked them (iteration ${String(last.n)}). A run has to check the component as it is before it's accepted: undo the changes, or have a run check them.`,
          hint: generate,
        });
      }
    }
  }
  for (const [input, what] of [
    ["conventions", `The conventions doc (${config.paths.conventions})`],
    ["config", "fazon.yaml"],
  ] as const) {
    if (then[input] !== undefined && now[input] !== then[input]) {
      warnings.push({
        level: "warning",
        text: `${what} changed since the run ${record.id}; the result is accepted as that run made it.`,
      });
    }
  }
  return { errors, warnings };
}

/** `fazon accept <component>`. */
export async function accept(
  invocation: Invocation,
  context: Context,
  now: () => Date = () => new Date(),
): Promise<Outcome> {
  const setup = await readComponent("accept", invocation, context);
  if ("stop" in setup) return setup.stop;
  const { repo, config, component, spec } = setup;
  const name = spec.spec.name;

  const holder = await heldRunLock(repo, component);
  if (holder !== undefined) {
    return refused(
      `${name} has a run in progress: ${holder.run}, started ${holder.started} by process ${String(holder.pid)}. Wait for it to end, then accept its result.`,
      "fazon runs",
    );
  }

  const latest = await latestAgentRun(repo, component, name);
  if (latest.kind === "none") {
    return refused(
      `${name} has no generate or feedback run in ${runsDirectory}/ to accept. Generate it first.`,
      `fazon generate ${component}`,
    );
  }
  if (latest.kind === "unreadable") {
    return refused(
      `The record of ${name}'s latest run, ${runsDirectory}/${latest.id}/run.json, can't be read, so fazon can't tell whether it passed. Generate again, or remove that run's directory.`,
      `fazon generate ${component}`,
    );
  }
  const { record } = latest;
  if (record.status !== "passed") return notPassed(record, component);

  let runs: RunRecord[];
  try {
    runs = await linkedRuns(repo, record.id);
  } catch (error) {
    return refused(
      `${(error as Error).message} The run ${record.id} is linked to it, and its provenance counts every linked run. Generate again.`,
      `fazon generate ${component}`,
    );
  }

  const file = provenancePath(config.paths.components, name);
  const absolute = path.join(repo, file);
  const read = await readProvenance(absolute);
  if (read.kind === "missing") {
    return refused(
      `${file} doesn't exist, so ${name}'s API has no approval to accept a result for. Approve the API, then generate again.`,
      `fazon approve ${component}`,
    );
  }
  if (read.kind === "invalid") {
    return refused(
      `${file} isn't a valid provenance file (${read.problems.join("; ")}). Only the harness writes it: restore it from git.`,
      `git checkout -- ${file}`,
    );
  }

  const last = record.iterations.at(-1);
  const details =
    last === undefined
      ? undefined
      : await readVerifyDetails(path.join(runDirectory(repo, record.id), checksPhaseFiles(last.n).directory));
  // Accepting writes the provenance file, which is in the component's directory, so a run
  // accepted already can't be compared with its checks again; the provenance names it.
  const already = read.provenance.generation?.runs.at(-1)?.id === record.id;
  const { errors, warnings } = await changesSince(setup, record, read.provenance, details, !already);
  if (errors.length > 0) return { status: "refused", messages: errors };

  let provenance: Provenance;
  if (already) {
    provenance = read.provenance;
  } else {
    try {
      provenance = acceptGeneration(read.provenance, {
        framework: version,
        date: now(),
        runs,
        specHash: record.inputs?.spec ?? read.provenance.spec.hash,
      });
    } catch (error) {
      return refused(`${(error as Error).message} Generate again.`, `fazon generate ${component}`);
    }
    await writeProvenance(absolute, provenance);
  }
  const generation = provenance.generation;
  if (generation === undefined) throw new Error(`${file} has no generation after accepting ${record.id}.`);

  const changes = baselineChanges(details, component);
  const baselines = changes.new.length + changes.changed.length + changes.orphans.length;
  const update = `fazon baseline update ${component}`;
  const messages: Message[] = [...warnings];
  const cost = `$${generation.costUsd.toFixed(2)}${generation.costEstimated === true ? " (estimated)" : ""}`;
  messages.push({
    level: "info",
    text: already
      ? `${name}'s run ${record.id} was accepted already, on ${generation.accepted}, in ${file}.`
      : `Accepted ${name}'s run ${record.id} on ${generation.accepted}, in ${file}: ${count(generation.runs.length, "run", "runs")}, ${count(generation.handEdits, "hand edit", "hand edits")}, ${cost}.`,
  });
  messages.push({
    level: "info",
    text:
      baselines === 0
        ? "Its stories match the baselines. Commit the provenance file with the component."
        : `Its stories differ from the baselines: ${count(changes.new.length, "new story", "new stories")}, ${count(changes.changed.length, "changed story", "changed stories")}, ${count(changes.orphans.length, "orphaned baseline", "orphaned baselines")}. Run ${update}, then commit the baselines and the provenance file with the component.`,
    ...(baselines === 0 ? {} : { hint: update }),
  });

  return {
    status: "ok",
    messages,
    result: {
      component: name,
      run: record.id,
      kind: record.kind,
      status: record.status,
      record: `${runsDirectory}/${record.id}/run.json`,
      provenance: file,
      accepted: generation.accepted,
      ...(already ? { alreadyAccepted: true } : {}),
      runs: generation.runs,
      handEdits: generation.handEdits,
      costUsd: generation.costUsd,
      ...(generation.costEstimated === true ? { costEstimated: true } : {}),
      stories: changes,
      ...(baselines === 0 ? {} : { baselineUpdate: update }),
    },
  };
}
