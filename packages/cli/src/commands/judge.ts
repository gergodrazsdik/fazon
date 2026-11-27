// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon judge <run-id>` (docs/spec/cli.md#fazon-judge): the judge for an earlier verify run, on
// the stories its `--base` marked as added or changed, or on all of them without one. In CI it
// spends at most the judge's CI cap (JUDGE-004); locally, the run's budget.
import { loadComponents, readRunRecord, readVerifyDetails, runDirectory, runsDirectory } from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { isSet } from "../environment.js";
import { judgeText, judgeVerifyRun } from "../judge.js";
import { refused, type Outcome } from "../outcome.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

export async function judge(invocation: Invocation, context: Context): Promise<Outcome> {
  const { environment } = context;
  const [id] = invocation.positionals;
  if (id === undefined) return refused("Name the verify run to judge.", "fazon judge <run-id>");
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) {
    return refused(`fazon.yaml names the adapter '${config.adapter}', which this version of fazon doesn't have.`);
  }
  const repo = environment.cwd;
  const runDir = runDirectory(repo, id);
  const record = await readRunRecord(runDir);
  if (record === undefined) return refused(`There's no run ${id} in ${runsDirectory}.`, "fazon runs");
  if (record.kind !== "verify") {
    return refused(
      `The run ${id} is a ${record.kind} run; fazon judge judges a verify run's captures.`,
      "fazon verify",
    );
  }
  const details = await readVerifyDetails(runDir);
  if (details === undefined) {
    return refused(`The run ${id} has no verify.json: its checks didn't get as far as the captures.`, "fazon verify");
  }
  const recordPath = `${runsDirectory}/${id}/run.json`;
  if (config.judge.policy === "off") {
    return {
      status: "ok",
      messages: [{ level: "info", text: "The judge's policy in fazon.yaml is off, so it didn't run." }],
      result: { run: id, record: recordPath, judge: { ran: false, reason: "the judge's policy is off" } },
    };
  }
  const { components, problems } = await loadComponents(repo, config, adapter);
  if (problems.length > 0) {
    return refused(
      `${problems[0]?.file ?? "A spec"} doesn't pass fazon spec check, so the judge can't read it.`,
      "fazon spec check",
    );
  }
  const names = new Set(details.components.map((component) => component.name));
  const ci = isSet(environment, "CI");
  const judged = await judgeVerifyRun({
    environment,
    config,
    runDir,
    record,
    details,
    components: components.filter((component) => names.has(component.name)),
    library: components,
    budgetUsd: ci ? config.judge.ciBudgetUsd : config.loop.budgetUsd,
    progress: (text) => {
      if (context.global.verbose || !context.global.json) context.stderr?.(text);
    },
  });
  if (judged.kind !== "judged") {
    return {
      status: "error",
      messages: [{ level: "error", text: judged.message, hint: "fazon doctor" }],
      result: { run: id, record: recordPath },
    };
  }
  const lines = judgeText(judged.pass, judged.record.config.judgeCalibrated === true);
  return {
    status: judged.blocking ? "failed" : "ok",
    messages: [
      ...lines.messages,
      ...(judged.blocking
        ? [{ level: "error" as const, text: "The judge failed stories, and its verdicts block here." }]
        : []),
    ],
    text: lines.text,
    result: { run: id, record: recordPath, judge: { ran: true, ...judged.record.verification?.judge } },
  };
}
