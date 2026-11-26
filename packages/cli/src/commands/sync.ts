// SPDX-License-Identifier: GPL-3.0-or-later
import { syncRepository, type FileChange, type SyncProblem } from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { requireConfig, type Context, type Invocation } from "./context.js";

/**
 * `fazon sync [--check]` (docs/spec/cli.md#fazon-sync): regenerates the token CSS, every
 * component's `generated/` directory and the entry file's exports; with `--check`, writes nothing
 * and fails when the committed files differ (the `build` check's rule `generated`).
 */
export async function sync(invocation: Invocation, context: Context): Promise<Outcome> {
  const check = invocation.options.check === true;
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const adapter = findAdapter(config.adapter);
  if (adapter === undefined) {
    return refused(`fazon.yaml names the adapter '${config.adapter}', which this version of fazon doesn't have.`);
  }

  const result = await syncRepository(context.environment.cwd, config, adapter, { check });
  if (!result.ok) {
    const count = result.problems.length;
    return {
      status: "refused",
      messages: [
        ...result.problems.map(problemMessage),
        {
          level: "error",
          text: `fazon sync can't generate the files until ${count === 1 ? "this problem is" : `these ${String(count)} problems are`} fixed; it wrote nothing.`,
          ...(result.problems.some((problem) => problem.rule?.startsWith("SPEC-") === true)
            ? { hint: "fazon spec check" }
            : {}),
        },
      ],
      result: { check, problems: result.problems },
    };
  }

  const { changes, unchanged } = result;
  const text: TextLine[] = changes.map((change) => ({ stream: "stdout", text: changeLine(change) }));
  const total = changes.length + unchanged;
  const messages: Message[] = [];
  for (const directory of result.orphanedComponents) {
    messages.push({
      level: "warning",
      text: `${directory}/ has no spec, so its generated files ${check ? "are orphans" : "were removed"}. Remove the component's own files too, or restore its spec.`,
    });
  }
  const files = (n: number) => `${String(n)} ${n === 1 ? "file" : "files"}`;
  if (result.pending.length > 0) {
    const list = result.pending.map(({ component, file }) => `${component} (${file})`).join(", ");
    messages.push({
      level: "info",
      text: `Not generated yet, so not exported from the entry file until the root file exists: ${list}.`,
    });
  }
  if (check) {
    messages.push(
      changes.length === 0
        ? { level: "info", text: `The generated files are up to date: ${files(total)} checked.` }
        : {
            level: "error",
            text: `${files(changes.length)} ${changes.length === 1 ? "differs" : "differ"} from what the specs and the token set give (build rule generated).`,
            hint: "fazon sync",
          },
    );
  } else {
    const removed = changes.filter((change) => change.change === "removed").length;
    const written = changes.length - removed;
    messages.push({
      level: "info",
      text:
        changes.length === 0
          ? `Everything is up to date: ${files(total)}.`
          : `Wrote ${files(written)}${removed === 0 ? "" : ` and removed ${files(removed)}`}; ${files(unchanged)} unchanged.`,
    });
  }

  return {
    status: check && changes.length > 0 ? "failed" : "ok",
    messages,
    result: {
      check,
      files: changes.map(({ path, change }) => ({ path, change })),
      unchanged,
      components: result.components,
      pending: result.pending.map(({ component }) => component),
    },
    text,
  };
}

function changeLine({ path, change }: FileChange): string {
  return `${change.padEnd(9)}${path}`;
}

export function problemMessage(problem: SyncProblem): Message {
  const location =
    problem.file === undefined
      ? ""
      : `${problem.file}${problem.line === undefined ? "" : `:${String(problem.line)}`}: `;
  const rule = problem.rule === undefined ? "" : `${problem.rule} `;
  const at = problem.path === undefined || problem.path === "$" ? "" : `${problem.path}: `;
  return {
    level: "error",
    text: `${location}${rule}${at}${problem.message.replace(/\.$/, "")}.${problem.hint === undefined ? "" : ` ${problem.hint}`}`,
  };
}
