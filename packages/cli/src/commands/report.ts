// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon report [<component> | <run-id>] [--no-open] [--summary]` (docs/spec/cli.md#fazon-report).
// `--summary` prints a verify run's short Markdown summary, as the reusable workflow posts it; the
// HTML report arrives in M2.
import { listRunIds, readRunRecord, readVerifyDetails, runDirectory, runsDirectory } from "@fazon/core";
import { refused, type Outcome } from "../outcome.js";
import { summarizeRun } from "../summary.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

const runIdPattern = /^\d{8}T\d{6}Z-[a-z][a-z0-9-]*-[0-9a-f]{4}$/;

export async function report(invocation: Invocation, context: Context): Promise<Outcome> {
  if (invocation.options.summary !== true) {
    return refused(
      "The HTML report arrives in M2. `fazon report --summary` prints a verify run's Markdown summary now.",
      "fazon report --summary",
    );
  }
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const root = context.environment.cwd;
  const [target] = invocation.positionals;

  let id: string | undefined;
  let only: string | undefined;
  if (target !== undefined && runIdPattern.test(target)) {
    id = target;
    if ((await readRunRecord(runDirectory(root, id))) === undefined) {
      return refused(`There's no run ${id} in ${runsDirectory}/.`, "fazon verify");
    }
  } else {
    only = target;
    for (const candidate of await listRunIds(root)) {
      if (only === undefined) {
        id = candidate;
        break;
      }
      const details = await readVerifyDetails(runDirectory(root, candidate));
      if (details?.components.some((c) => c.name === only) === true) {
        id = candidate;
        break;
      }
    }
    if (id === undefined) {
      return only === undefined
        ? refused(`There's no run in ${runsDirectory}/ yet. Make one with \`fazon verify\`.`, "fazon verify")
        : refused(
            `No verify run in ${runsDirectory}/ checked '${only}'. Name a component in kebab-case, or a run ID, or make a run.`,
            `fazon verify ${only}`,
          );
    }
  }

  const dir = runDirectory(root, id);
  const record = await readRunRecord(dir);
  if (record === undefined) return refused(`The run ${id} has no readable record.`, "fazon verify");
  if (record.kind !== "verify") {
    return refused(
      `${id} is a ${record.kind} run; the summary of one arrives with the HTML report in M2. Name a verify run.`,
    );
  }
  const summary = summarizeRun(record, await readVerifyDetails(dir), config, only);
  const { markdown, ...result } = summary;
  return {
    status: "ok",
    messages: [],
    text: [{ stream: "stdout", text: markdown.trimEnd() }],
    result: { ...result, summary: markdown },
  };
}
