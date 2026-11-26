// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon feedback <component> (-m <text> | --file <path>)` (docs/spec/cli.md#fazon-feedback): a
// feedback run (docs/spec/loop-and-caps.md#feedback). It answers the component's latest generate
// or feedback run: its first prompt carries the developer's feedback and that run's last blocking
// findings, and it starts with fresh caps on the generator model. Everything else is generate's:
// the same refusals before the run, the same loop and the same result (`prepareLoopCommand`,
// `runLoopCommand`).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lastFindings, listRunIds, readRunRecord, runDirectory, runsDirectory, type RunRecord } from "@fazon/core";
import { refused, type Outcome } from "../outcome.js";
import type { Context, Invocation } from "./context.js";
import { prepareLoopCommand, runLoopCommand } from "./generate.js";

const usage = "fazon feedback <component> (-m <text> | --file <path>)";

/** `fazon feedback <component> (-m <text> | --file <path>)`. */
export async function feedback(invocation: Invocation, context: Context): Promise<Outcome> {
  const text = await feedbackText(invocation, context);
  if (typeof text !== "string") return text;
  const setup = await prepareLoopCommand("feedback", invocation, context);
  if ("stop" in setup) return setup.stop;
  const { repo, component, spec } = setup;

  const parent = await latestLoopRun(repo, component, spec.spec.name);
  if (parent.kind === "none") {
    return refused(
      `${spec.spec.name} has no generate or feedback run to give feedback on. Generate it first; then review the run's report and give your feedback on it.`,
      `fazon generate ${component}`,
    );
  }
  if (parent.kind === "unreadable") {
    return refused(
      `The run record of ${spec.spec.name}'s latest run, ${runsDirectory}/${parent.id}/run.json, is missing or can't be read, so fazon can't tell which run the feedback answers. Delete that run's directory if it's no longer needed, or generate again.`,
      `fazon generate ${component}`,
    );
  }
  const { record } = parent;
  return runLoopCommand(
    setup,
    { kind: "feedback", feedback: { parent: record.id, text, findings: lastFindings(record) } },
    context,
  );
}

/**
 * The developer's feedback, from exactly one `-m <text>` or `--file <path>`, refused (2) when
 * neither or both are given, when the file can't be read, or when the text is empty. Surrounding
 * white space is trimmed, and a file's byte-order mark dropped.
 */
async function feedbackText(invocation: Invocation, context: Context): Promise<string | Outcome> {
  const texts = strings(invocation.options.message);
  const files = strings(invocation.options.file);
  const given = texts.length + files.length;
  if (given !== 1) {
    return refused(
      given === 0
        ? `fazon feedback needs your feedback: give it as -m <text>, or as --file <path> for a longer text. Usage: ${usage}`
        : `fazon feedback takes your feedback once: one -m <text> or one --file <path>, not ${String(given)}. Usage: ${usage}`,
      "fazon feedback --help",
    );
  }

  const [file] = files;
  let text: string;
  if (file === undefined) {
    text = texts[0] ?? "";
  } else {
    try {
      text = await readFile(path.resolve(context.environment.cwd, file), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const why =
        code === "ENOENT"
          ? "it doesn't exist"
          : code === "EISDIR"
            ? "it's a directory"
            : code === "EACCES"
              ? "fazon may not read it"
              : (error as Error).message;
      return refused(
        `The feedback file ${file} can't be read: ${why}. Give the path to a text file, or the text as -m <text>.`,
      );
    }
    if (text.startsWith("\uFEFF")) text = text.slice(1);
  }
  text = text.trim();
  if (text === "") {
    return refused(
      `The feedback ${file === undefined ? "given with -m" : `in ${file}`} is empty. Say in plain words what the next run should change.`,
    );
  }
  return text;
}

function strings(value: Invocation["options"][string]): string[] {
  if (value === undefined || typeof value === "boolean") return [];
  if (typeof value === "string") return [value];
  return value.filter((item): item is string => typeof item === "string");
}

/** A run ID's label: what's between its time (`YYYYMMDDTHHMMSSZ-`) and its random digits (`-3f9a`). */
function runLabel(id: string): string {
  return id.slice(17, -5);
}

export type LatestLoopRun =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly id: string }
  | { readonly kind: "found"; readonly record: RunRecord };

/**
 * The component's latest generate or feedback run, which a feedback run answers: the run `fazon
 * accept` and `fazon report <component>` take. Propose runs write no code, so they're passed over;
 * a newer run of the component whose record can't be read stops the search, as it may be the
 * latest. A run of any status counts: feedback can answer a run that passed, needs a person or was
 * interrupted.
 */
export async function latestLoopRun(root: string, component: string, name: string): Promise<LatestLoopRun> {
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
