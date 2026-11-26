// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon report [<component> | <run-id>] [--no-open] [--summary]` (docs/spec/cli.md#fazon-report).
// Builds a run's HTML report in its directory and opens it in the browser; `--no-open` only prints
// its path. `--summary` prints a verify run's short Markdown summary instead, as the reusable
// workflow posts it.
import {
  buildReport,
  defaultStorybookUrl,
  kebabCase,
  listRunIds,
  readRunRecord,
  readVerifyDetails,
  runDirectory,
  runsDirectory,
  storybookStoryUrl,
  type RunRecord,
} from "@fazon/core";
import { isSet } from "../environment.js";
import { refused, type Message, type Outcome } from "../outcome.js";
import { summarizeRun } from "../summary.js";
import { requireConfig, type Context, type Invocation } from "./context.js";
import { openInBrowser } from "./report-open.js";

const runIdPattern = /^\d{8}T\d{6}Z-[a-z][a-z0-9-]*-[0-9a-f]{4}$/;

/** The variable that names the local Storybook the report's screenshots link to. */
export const storybookUrlVariable = "FAZON_STORYBOOK_URL";

/**
 * The run a target names: a run ID; or a component's latest run, which for `--summary` is the
 * latest verify run that checked it, and otherwise also an agent run of it; or the latest run.
 */
async function resolveRun(
  root: string,
  target: string | undefined,
  verifyOnly: boolean,
): Promise<{ id: string; only?: string; record: RunRecord } | { refusal: Outcome }> {
  let id: string | undefined;
  let only: string | undefined;
  if (target !== undefined && runIdPattern.test(target)) {
    id = target;
    if ((await readRunRecord(runDirectory(root, id))) === undefined) {
      return { refusal: refused(`There's no run ${id} in ${runsDirectory}/.`, "fazon verify") };
    }
  } else {
    only = target;
    for (const candidate of await listRunIds(root)) {
      if (only === undefined) {
        id = candidate;
        break;
      }
      if (!verifyOnly) {
        const record = await readRunRecord(runDirectory(root, candidate));
        if (record?.kind !== "verify" && record?.component !== undefined && kebabCase(record.component) === only) {
          id = candidate;
          break;
        }
      }
      const details = await readVerifyDetails(runDirectory(root, candidate));
      if (details?.components.some((c) => c.name === only) === true) {
        id = candidate;
        break;
      }
    }
    if (id === undefined) {
      const refusal =
        only === undefined
          ? refused(`There's no run in ${runsDirectory}/ yet. Make one with \`fazon verify\`.`, "fazon verify")
          : refused(
              verifyOnly
                ? `No verify run in ${runsDirectory}/ checked '${only}'. Name a component in kebab-case, or a run ID, or make a run.`
                : `No run in ${runsDirectory}/ covers '${only}'. Name a component in kebab-case, or a run ID, or make a run.`,
              `fazon verify ${only}`,
            );
      return { refusal };
    }
  }
  const record = await readRunRecord(runDirectory(root, id));
  if (record === undefined) return { refusal: refused(`The run ${id} has no readable record.`, "fazon verify") };
  return { id, record, ...(only === undefined ? {} : { only }) };
}

export async function report(invocation: Invocation, context: Context): Promise<Outcome> {
  const loaded = await requireConfig(context);
  if ("refusal" in loaded) return loaded.refusal;
  const { config } = loaded;
  const { environment } = context;
  const root = environment.cwd;
  const [target] = invocation.positionals;
  const summary = invocation.options.summary === true;

  const resolved = await resolveRun(root, target, summary);
  if ("refusal" in resolved) return resolved.refusal;
  const { id, record, only } = resolved;
  const dir = runDirectory(root, id);

  if (summary) {
    if (record.kind !== "verify") {
      return refused(
        `${id} is a ${record.kind} run; --summary covers verify runs. \`fazon report ${id}\` builds its HTML report.`,
        `fazon report ${id}`,
      );
    }
    const { markdown, ...result } = summarizeRun(record, await readVerifyDetails(dir), config, only);
    return {
      status: "ok",
      messages: [],
      text: [{ stream: "stdout", text: markdown.trimEnd() }],
      result: { ...result, summary: markdown },
    };
  }

  const storybookUrl = environment.env[storybookUrlVariable] ?? "";
  if (storybookUrl !== "" && storybookStoryUrl(storybookUrl, "x--y", "light") === undefined) {
    return refused(
      `${storybookUrlVariable} must be an http or https URL, such as ${defaultStorybookUrl}; it is '${storybookUrl}'.`,
    );
  }
  const details = record.kind === "verify" ? await readVerifyDetails(dir) : undefined;
  const built = await buildReport({
    root,
    config,
    record,
    ...(details === undefined ? {} : { details }),
    ...(storybookUrl === "" ? {} : { storybookUrl }),
  });

  const messages: Message[] = [];
  let opened: string | undefined;
  if (invocation.options["no-open"] !== true) {
    if (isSet(environment, "CI")) {
      messages.push({ level: "info", text: "Not opening a browser in CI. The report is at the path above." });
    } else {
      opened = await openInBrowser(built.file, environment);
      messages.push(
        opened === undefined
          ? {
              level: "warning",
              text: "No program could open a browser here (xdg-open, open, wslview). Open the path above in one.",
            }
          : { level: "info", text: `Opened in the browser with ${opened}.` },
      );
    }
  }
  return {
    status: "ok",
    messages,
    text: [{ stream: "stdout", text: built.file }],
    result: {
      run: id,
      kind: record.kind,
      status: record.status,
      path: built.path,
      images: built.images,
      opened: opened !== undefined,
    },
  };
}
