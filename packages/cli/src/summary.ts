// SPDX-License-Identifier: GPL-3.0-or-later
// The short Markdown summary of a verify run (`fazon report --summary`), as the reusable workflow
// posts it in the job summary and the pull request comment (docs/spec/workflow.md#what-it-reports):
// per component, its checks and blocking findings and the baselines the pull request adds, changes,
// removes or renames; the judge; and a placeholder the workflow replaces with the artifact links.
import path from "node:path";
import {
  findingComponent,
  type BaseChange,
  type CheckFinding,
  type CheckStatus,
  type Config,
  type RunRecord,
  type VerifyDetails,
} from "@fazon/core";

/** The line the workflow replaces with links to the run's artifacts. */
export const artifactsPlaceholder = "<!-- fazon:artifacts -->";

const checkOrder = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;

/** At most this many findings and baselines are listed per component; the rest are counted. */
const listLimit = 15;

/** How a verify run ended, for the summary: `ok`, `failed`, `error`, or `running` when it never ended. */
export type SummaryStatus = "ok" | "failed" | "error" | "running";

export interface ComponentSummary {
  readonly component: string;
  readonly checks: Readonly<Partial<Record<string, CheckStatus>>>;
  readonly blocking: readonly CheckFinding[];
  readonly stories: { readonly unchanged: number; readonly changed: number; readonly new: number };
  readonly baselines: readonly BaseChange[];
}

export interface RunSummary {
  readonly run: string;
  readonly status: SummaryStatus;
  readonly image: string;
  readonly components: readonly ComponentSummary[];
  /** Blocking findings that belong to no component. */
  readonly unowned: readonly CheckFinding[];
  /** Checks that ended in error or were skipped, with why. */
  readonly incomplete: readonly { readonly check: string; readonly status: CheckStatus; readonly message: string }[];
  /** The `--base` ref, when the run compared the baselines with one. */
  readonly base?: string;
  readonly judge: { readonly available: false; readonly policy: string; readonly costUsd: number };
  readonly markdown: string;
}

/** Escapes text for Markdown: no markup, HTML or table cells break out of it. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|~#]/g, "\\$&");
}

/** Text as inline code: a backtick in it would end the span, so it becomes an apostrophe. */
function code(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function describeFinding(finding: CheckFinding): string {
  const where =
    finding.story !== undefined
      ? `${finding.story} (${finding.theme ?? ""})`
      : finding.file === undefined
        ? undefined
        : `${finding.file}${finding.line === undefined ? "" : `:${String(finding.line)}`}`;
  return `${code(`${finding.check}/${finding.rule}`)}${where === undefined ? "" : ` ${code(where)}`}: ${escapeMarkdown(firstLine(finding.message))}`;
}

function describeChange(change: BaseChange): string {
  return `${change.mark} ${code(change.path)}${change.from === undefined ? "" : ` (from ${code(change.from)})`}`;
}

function list<T>(items: readonly T[], describe: (item: T) => string, rest: string): string[] {
  const lines = items.slice(0, listLimit).map((item) => `- ${describe(item)}`);
  if (items.length > listLimit) lines.push(`- and ${String(items.length - listLimit)} more ${rest}`);
  return lines;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** The status the summary shows: as `fazon verify` exits. */
export function summaryStatus(record: RunRecord): SummaryStatus {
  if (record.status === "running") return "running";
  const errored = (record.verification?.checks ?? []).some((check) => check.status === "error");
  if (errored || record.reason === "check-error") return "error";
  return record.status === "passed" ? "ok" : "failed";
}

const headings: Readonly<Record<SummaryStatus, string>> = {
  ok: "passed",
  failed: "failed",
  error: "couldn't run every check",
  running: "didn't finish",
};

/**
 * The summary of a verify run from its record and `verify.json`; `only` limits it to one
 * component. The config gives the paths that tell which component a finding belongs to.
 */
export function summarizeRun(
  record: RunRecord,
  details: VerifyDetails | undefined,
  config: Config,
  only?: string,
): RunSummary {
  const checks = record.verification?.checks ?? [];
  const names = (details?.components ?? []).map((c) => c.name).filter((name) => only === undefined || name === only);
  const owners = (details?.components ?? []).map((c) => ({
    name: c.name,
    directory: path.posix.join(config.paths.components.split(path.sep).join("/"), c.name),
    specFile: path.posix.join(config.paths.specs.split(path.sep).join("/"), `${c.name}.md`),
  }));
  const blocking = checks.flatMap((check) => check.findings.filter((finding) => finding.blocking));
  const changes = details?.base?.changes ?? [];
  // A baseline's path is <theme>/<component>/<story>.png.
  const changeComponent = (change: BaseChange) => change.path.split("/")[1];

  const components = names.map((name): ComponentSummary => {
    const stories = (details?.stories ?? []).filter((s) => s.component === name);
    const count = (status: string) => stories.filter((s) => s.status === status).length;
    return {
      component: name,
      checks: details?.components.find((c) => c.name === name)?.checks ?? {},
      blocking: blocking.filter((finding) => findingComponent(finding, owners) === name),
      stories: { unchanged: count("unchanged"), changed: count("changed"), new: count("new") },
      baselines: changes.filter((change) => changeComponent(change) === name),
    };
  });
  const unowned =
    only === undefined ? blocking.filter((finding) => findingComponent(finding, owners) === undefined) : [];
  const incomplete = checks
    .filter((check) => check.status === "error" || check.status === "skipped")
    .map((check) => ({ check: check.check, status: check.status, message: firstLine(check.message ?? "") }));
  const status = summaryStatus(record);
  const policy = record.config.judgePolicy;
  const judge = { available: false as const, policy, costUsd: record.totals.judgeCostUsd };
  const base = details?.base?.ref;

  const lines: string[] = [`### Fazon verify ${headings[status]}`, ""];
  lines.push(
    `Run ${code(record.id)} in ${code(record.versions.image)}${base === undefined ? "" : `, baselines compared with ${code(base)}`}.`,
    "",
  );
  if (status === "running") {
    lines.push("The run stopped before its checks ended; its record has no results.", "");
  }
  if (components.length === 0) {
    lines.push(only === undefined ? "The run checked no component." : `The run didn't check ${code(only)}.`, "");
  } else {
    lines.push("| Component | Checks | Blocking findings | Stories | Baselines |", "|---|---|---|---|---|");
    for (const c of components) {
      const notPassing = checkOrder.filter((check) => c.checks[check] !== undefined && c.checks[check] !== "pass");
      const checksCell =
        notPassing.length === 0
          ? Object.keys(c.checks).length === 0
            ? "none ran"
            : "all pass"
          : notPassing.map((check) => `${check} ${c.checks[check] ?? ""}`).join(", ");
      const storiesCell = `${String(c.stories.unchanged)} unchanged, ${String(c.stories.changed)} changed, ${String(c.stories.new)} new`;
      const marks = (["added", "changed", "removed", "renamed"] as const)
        .map((mark) => [mark, c.baselines.filter((change) => change.mark === mark).length] as const)
        .filter(([, n]) => n > 0)
        .map(([mark, n]) => `${String(n)} ${mark}`);
      const baselinesCell = base === undefined ? "not compared" : marks.length === 0 ? "no change" : marks.join(", ");
      lines.push(
        `| ${c.component} | ${checksCell} | ${String(c.blocking.length)} | ${storiesCell} | ${baselinesCell} |`,
      );
    }
    lines.push("");
  }
  const record_ = `in the run's record (${code(`.fazon/runs/${record.id}/run.json`)})`;
  for (const c of components) {
    if (c.blocking.length === 0 && c.baselines.length === 0) continue;
    lines.push(`#### ${c.component}`, "");
    if (c.blocking.length > 0) {
      lines.push(
        `${plural(c.blocking.length, "blocking finding")}:`,
        "",
        ...list(c.blocking, describeFinding, record_),
        "",
      );
    }
    if (c.baselines.length > 0 && base !== undefined) {
      lines.push(
        `Baselines that differ from ${code(base)}:`,
        "",
        ...list(c.baselines, describeChange, `in the run's ${code("verify.json")}`),
        "",
      );
    }
  }
  if (unowned.length > 0) {
    lines.push("#### Other findings", "", ...list(unowned, describeFinding, record_), "");
  }
  if (incomplete.length > 0) {
    lines.push("#### Checks that didn't run to the end", "");
    for (const check of incomplete) {
      lines.push(
        `- ${code(check.check)} ${check.status === "error" ? "ended in error" : "was skipped"}${check.message === "" ? "" : `: ${escapeMarkdown(check.message)}`}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "#### Judge",
    "",
    policy === "off"
      ? "Off: `fazon.yaml` sets `judge.policy` to `off`, so no story was judged. Cost: $0.00."
      : "Not available yet: the judge arrives in M3, so no story was judged. Cost: $0.00.",
    "",
    artifactsPlaceholder,
  );

  return {
    run: record.id,
    status,
    image: record.versions.image,
    components,
    unowned,
    incomplete,
    ...(base === undefined ? {} : { base }),
    judge,
    markdown: `${lines.join("\n")}\n`,
  };
}
