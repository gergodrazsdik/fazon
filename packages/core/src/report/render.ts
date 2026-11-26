// SPDX-License-Identifier: GPL-3.0-or-later
// The report's page: one self-contained HTML document with inline CSS, no script and no external
// fetch. It shows the run's end, the commands for the next step, cost and duration, iterations and
// models, check results and findings, judge verdicts, visual diffs and the gallery. Every value
// from the record is escaped by the `html` tag.
import type { CheckFinding } from "../checks/types.js";
import { kebabCase } from "../spec/names.js";
import type { VerifyDetails } from "../verify/details.js";
import type { CheckResult, RunReason } from "../verify/run-record.js";
import { html, relativeUrl, type Html } from "./html.js";
import {
  galleryVerification,
  type ReportCapture,
  type ReportIteration,
  type ReportJudge,
  type ReportRecord,
  type ReportTokens,
} from "./types.js";

export interface ReportModel {
  readonly record: ReportRecord;
  readonly details?: VerifyDetails;
  /** The gallery, with image paths relative to the report's directory. */
  readonly captures: readonly ReportCapture[];
  /** Copied images, report-relative, by their path relative to the run's directory: findings' evidence. */
  readonly evidence: ReadonlyMap<string, string>;
  /** The local Storybook the screenshots link to. */
  readonly storybookUrl: string;
}

/** A step the person can take after the run: a command, and when or why to run it. */
export interface NextStep {
  readonly command?: string;
  readonly text: string;
}

const checkOrder = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;

const reasons: Readonly<Record<RunReason, string>> = {
  iterations: "the iteration cap was reached, and the last iteration failed",
  budget: "the budget was spent, and the last iteration failed",
  "run-time": "the run-time cap was reached, and the last iteration failed",
  violation: "the agent changed files outside its allowed paths",
  dependency: "the component needs a new dependency",
  "shared-code": "the component needs a change to shared code",
  "check-error": "a check ended in error, or the image couldn't run the checks",
  "inputs-changed": "the spec, the token set, the conventions or the config changed during the run",
};

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${String(hours)} h ${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, word: string): string {
  return `${count(n)} ${word}${n === 1 ? "" : "s"}`;
}

function tokens(t: ReportTokens): string {
  const parts = [`${count(t.input)} in`, `${count(t.output)} out`];
  if (t.cacheRead !== undefined) parts.push(`${count(t.cacheRead)} cache read`);
  if (t.cacheWrite !== undefined) parts.push(`${count(t.cacheWrite)} cache write`);
  return parts.join(", ");
}

/** The run's duration: from its totals, or from its start and end. */
function runSeconds(record: ReportRecord): number | undefined {
  if (record.totals.durationSeconds !== undefined) return record.totals.durationSeconds;
  if (record.ended === undefined) return undefined;
  const ms = Date.parse(record.ended) - Date.parse(record.started);
  return Number.isNaN(ms) ? undefined : ms / 1000;
}

/** The component, in kebab-case, as commands take it. */
function componentArgument(record: ReportRecord): string {
  return record.component === undefined ? "<component>" : kebabCase(record.component);
}

/** The checks that decide the run's result: a verify run's, or its last iteration's. */
function finalChecks(record: ReportRecord): readonly CheckResult[] {
  return galleryVerification(record)?.verification.checks ?? [];
}

/** Components with new or changed stories, or orphaned baselines: those whose baselines would move. */
function movedComponents(model: ReportModel): string[] {
  const moved = new Set<string>();
  for (const capture of model.captures) {
    if (capture.status === "new" || capture.status === "changed") moved.add(capture.component);
  }
  for (const orphan of model.details?.orphans ?? []) {
    const component = orphan.path.split("/")[1];
    if (component !== undefined && component !== "") moved.add(component);
  }
  return [...moved].sort();
}

/** The commands for the next step, as fit the run's kind and end. */
export function nextSteps(model: ReportModel): NextStep[] {
  const { record } = model;
  const c = componentArgument(record);
  const moved = movedComponents(model);
  if (record.status === "running") {
    return [{ text: "The run is still going, or it stopped without recording its end. Its results so far are below." }];
  }
  if (record.kind === "verify") {
    if (record.status === "failed" && record.reason === "check-error") {
      return [
        { command: "fazon doctor", text: "A check couldn't run to its end. Check the environment," },
        { command: "fazon verify", text: "then verify again." },
      ];
    }
    if (record.status === "failed") {
      const blocking = finalChecks(record).flatMap((check) => check.findings.filter((f) => f.blocking));
      const visual = blocking.filter((f) => f.check === "visual" && (f.rule === "changed" || f.rule === "orphan"));
      const steps: NextStep[] = [];
      if (blocking.length > visual.length) {
        steps.push({ command: "fazon verify", text: "Fix the blocking findings in the code, then verify again." });
      }
      if (visual.length > 0 && moved.length > 0) {
        steps.push({
          command: `fazon baseline update ${moved.join(" ")}`,
          text: "If the visual changes below are intended, write the new baselines. It refuses while another check fails.",
        });
      }
      return steps;
    }
    if (record.status === "stopped")
      return [{ command: "fazon verify", text: "The run was interrupted. Run it again." }];
    return moved.length > 0
      ? [
          {
            command: `fazon baseline update ${moved.join(" ")}`,
            text: "Every check passed. Write the baselines of the new and changed stories once you've looked at them.",
          },
        ]
      : [{ text: "Every check passed and no baseline moved: nothing to do." }];
  }
  if (record.kind === "propose") {
    return record.status === "passed"
      ? [
          {
            command: `fazon approve ${c}`,
            text: `Review the proposed API in ${record.proposal?.path ?? "the spec"} as a diff, edit it if needed, then approve it (decision 1).`,
          },
        ]
      : [{ command: `fazon propose ${c}`, text: "The proposal didn't finish. Run it again." }];
  }
  const feedback: NextStep = {
    command: `fazon feedback ${c} -m "…"`,
    text: "Another round, with your feedback in plain words.",
  };
  if (record.status === "passed") {
    const steps: NextStep[] = [feedback, { command: `fazon accept ${c}`, text: "Accept the result (decision 2)." }];
    if (moved.length > 0) {
      steps.push({
        command: `fazon baseline update ${moved.join(" ")}`,
        text: "Then write the baselines of its new and changed stories.",
      });
    }
    return steps;
  }
  if (record.status === "stopped") {
    return [{ command: `fazon generate ${c}`, text: "The run was interrupted. Start it again," }, feedback];
  }
  // needs-a-person
  switch (record.reason) {
    case "violation":
      return [
        {
          text: "Look at the files the agent changed outside its allowed paths, listed below; the harness didn't revert them.",
        },
        feedback,
      ];
    case "dependency":
    case "shared-code":
      return [{ text: "Make that change yourself, then continue the run." }, feedback];
    case "inputs-changed":
      return [{ command: `fazon generate ${c}`, text: "Start the run again from the changed inputs." }];
    default:
      return [feedback, { command: `fazon verify ${c}`, text: "Or fix the remaining findings by hand and verify." }];
  }
}

function statusLabel(record: ReportRecord): string {
  switch (record.status) {
    case "passed":
      return "passed";
    case "failed":
      return record.reason === "check-error" ? "failed: a check couldn't run" : "failed";
    case "needs-a-person":
      return "needs a person";
    case "stopped":
      return "stopped";
    case "running":
      return "didn't finish";
  }
}

function statusClass(status: string): string {
  if (status === "passed" || status === "pass") return "ok";
  if (status === "failed" || status === "fail" || status === "error" || status === "needs-a-person") return "bad";
  return "warn";
}

function pill(text: string, kind: string): Html {
  return html`<span class="pill ${kind}">${text}</span>`;
}

function row(label: string, value: Html | string | undefined): Html {
  return value === undefined || value === ""
    ? html``
    : html`<tr>
        <th scope="row">${label}</th>
        <td>${value}</td>
      </tr>`;
}

function overview(model: ReportModel): Html {
  const { record } = model;
  const seconds = runSeconds(record);
  const t = record.totals;
  const cost = [
    usd(t.costUsd),
    record.kind === "verify" ? "" : ` (agent ${usd(t.agentCostUsd)}, judge ${usd(t.judgeCostUsd)})`,
    t.costEstimated === true ? "; estimated by Claude Code under a subscription login" : "",
    t.overrunUsd !== undefined && t.overrunUsd > 0 ? `; ${usd(t.overrunUsd)} over the budget` : "",
  ].join("");
  const models = record.config.models;
  const usedModels = [...new Set(record.iterations.map((i) => i.call.model))];
  const versions = [
    `framework ${record.versions.framework}`,
    record.versions.adapter === undefined ? "" : `adapter ${record.versions.adapter}`,
    record.versions.claudeCode === undefined ? "" : `Claude Code ${record.versions.claudeCode}`,
    record.versions.judge === undefined ? "" : `judge ${String(record.versions.judge)}`,
  ].filter((v) => v !== "");
  return html`<table class="facts">
    ${row("Run", html`<code>${record.id}</code>`)} ${row("Kind", record.kind)} ${row("Component", record.component)}
    ${row("Answers", record.parent === undefined ? undefined : html`<code>${record.parent}</code>`)}
    ${row("End", record.reason === undefined ? statusLabel(record) : `${statusLabel(record)}: ${reasons[record.reason]}`)}
    ${row("Started", record.started)} ${row("Ended", record.ended)}
    ${row("Duration", seconds === undefined ? undefined : duration(seconds))} ${row("Cost", cost)}
    ${row("Tokens", t.tokens === undefined ? undefined : tokens(t.tokens))}
    ${row(
      "Iterations",
      record.kind === "verify"
        ? undefined
        : `${String(t.iterations)} of ${String(record.config.caps.iterations)}${t.escalated ? `, escalated to ${models.escalation}` : ""}`,
    )}
    ${row("Models", record.kind === "verify" ? undefined : usedModels.length > 0 ? usedModels.join(", ") : models.generator)}
    ${row(
      "Caps",
      record.kind === "verify"
        ? undefined
        : `${String(record.config.caps.iterations)} iterations, ${usd(record.config.caps.budgetUsd)}, ${String(record.config.caps.runMinutes)} min per run, ${String(record.config.caps.callMinutes)} min per call`,
    )}
    ${row(
      "Judge",
      `policy ${record.config.judgePolicy}, model ${models.judge}${record.config.judgeCalibrated === true ? ", calibrated" : ", not calibrated"}`,
    )}
    ${row("Baselines compared with", model.details?.base?.ref)} ${row("Platform", model.details?.platform)}
    ${row("Image", html`<code>${record.versions.image}</code>`)} ${row("Versions", versions.join(", "))}
    ${row("Measured", record.measurement === undefined ? undefined : `round ${String(record.measurement.round)}, repeat ${String(record.measurement.repeat)}`)}
  </table>`;
}

function steps(model: ReportModel): Html {
  const list = nextSteps(model);
  return html`<section class="next" aria-labelledby="next">
    <h2 id="next">Next step</h2>
    <ol>
      ${list.map(
        (step) =>
          html`<li>
            ${step.text}${step.command === undefined ? "" : html` <code class="command">${step.command}</code>`}
          </li>`,
      )}
    </ol>
  </section>`;
}

function location(finding: CheckFinding): string {
  if (finding.story !== undefined) {
    const parts = [finding.story];
    if (finding.theme !== undefined) parts.push(`(${finding.theme})`);
    if (finding.part !== undefined) parts.push(finding.part);
    if (finding.selector !== undefined) parts.push(finding.selector);
    return parts.join(" ");
  }
  if (finding.file === undefined) return "";
  const line = finding.line === undefined ? "" : `:${String(finding.line)}`;
  const column = finding.line === undefined || finding.column === undefined ? "" : `:${String(finding.column)}`;
  return `${finding.file}${line}${column}`;
}

function findingItem(finding: CheckFinding, model: ReportModel): Html {
  const where = location(finding);
  const evidence = finding.evidence === undefined ? undefined : model.evidence.get(finding.evidence);
  return html`<li class="finding">
    <code>${finding.check}/${finding.rule}</code>${where === "" ? "" : html` <code class="where">${where}</code>`}
    ${finding.exempt === undefined ? "" : pill(`exempt: spec exemption ${String(finding.exempt)}`, "muted")}
    <div class="message">${finding.message}</div>
    ${
      finding.expected === undefined && finding.actual === undefined
        ? ""
        : html`<div class="expect">
            ${finding.expected === undefined ? "" : html`Expected: ${finding.expected}. `}${finding.actual === undefined ? "" : html`Actual: ${finding.actual}.`}
          </div>`
    }
    ${
      evidence === undefined
        ? finding.evidence === undefined
          ? ""
          : html`<div class="expect">Evidence: <code>${finding.evidence}</code></div>`
        : html`<div class="expect"><a href="${relativeUrl(evidence)}">Evidence</a></div>`
    }
  </li>`;
}

function findingGroups(findings: readonly CheckFinding[], model: ReportModel): Html {
  const blocking = findings.filter((f) => f.blocking);
  const exempt = findings.filter((f) => !f.blocking && f.exempt !== undefined);
  const advisory = findings.filter((f) => !f.blocking && f.exempt === undefined);
  const group = (title: string, list: readonly CheckFinding[], note: string) =>
    list.length === 0
      ? html``
      : html`<h4>${title} (${String(list.length)})</h4>
          <p class="note">${note}</p>
          <ul class="findings">
            ${list.map((f) => findingItem(f, model))}
          </ul>`;
  return html`${group("Blocking", blocking, "These fail the run.")}
  ${group("Advisory", advisory, "Shown for a person; they don't fail the run.")}
  ${group("Exempt", exempt, "A spec exemption waives these.")}`;
}

function checksTable(checks: readonly CheckResult[]): Html {
  const ordered = [...checks].sort((a, b) => checkOrder.indexOf(a.check) - checkOrder.indexOf(b.check));
  return html`<div class="scroll">
    <table class="grid">
      <thead>
        <tr>
          <th scope="col">Check</th>
          <th scope="col">Status</th>
          <th scope="col">Blocking</th>
          <th scope="col">Other findings</th>
          <th scope="col">Duration</th>
          <th scope="col">Note</th>
        </tr>
      </thead>
      <tbody>
        ${ordered.map((check) => {
          const blocking = check.findings.filter((f) => f.blocking).length;
          return html`<tr>
            <td><code>${check.check}</code></td>
            <td>${pill(check.status, statusClass(check.status))}</td>
            <td>${String(blocking)}</td>
            <td>${String(check.findings.length - blocking)}</td>
            <td>${duration(check.durationSeconds)}</td>
            <td>${check.message ?? ""}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function checksSection(checks: readonly CheckResult[], model: ReportModel): Html {
  if (checks.length === 0) return html`<p class="note">No check results are recorded.</p>`;
  return html`${checksTable(checks)}
  ${findingGroups(
    checks.flatMap((check) => check.findings),
    model,
  )}`;
}

function judgeSection(judge: ReportJudge | undefined, model: ReportModel): Html {
  const { record } = model;
  if (judge === undefined) {
    return html`<p class="note">
      ${
        record.config.judgePolicy === "off"
          ? "The judge's policy is off, so no story was judged."
          : "The run has no judge verdicts."
      }
    </p>`;
  }
  const s = judge.stories;
  return html`<p>
      Verdicts by story and theme: ${count(s.pass)} pass, ${count(s.fail)} fail, ${count(s.unsure)} unsure,
      ${count(s.notJudged)} not judged; ${plural(judge.calls, "call")},
      ${usd(judge.costUsd)}${judge.tokens === undefined ? "" : `, ${tokens(judge.tokens)} tokens`}.
      ${judge.blocking === true ? "Its fails blocked in this run." : "Advisory: its fails didn't block in this run."}
      ${record.config.judgeCalibrated === true ? "" : "The judge isn't calibrated for this model yet."} Plan and
      results: <code>${judge.results}</code>.
    </p>
    ${
      (judge.findings ?? []).length === 0
        ? html``
        : html`<div class="scroll">
            <table class="grid">
              <thead>
                <tr>
                  <th scope="col">Story</th>
                  <th scope="col">Theme</th>
                  <th scope="col">Question</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                ${(judge.findings ?? []).map(
                  (f) =>
                    html`<tr>
                      <td><code>${f.story}</code></td>
                      <td>${f.theme}</td>
                      <td><code>${f.question}</code></td>
                      <td>${pill(f.verdict, f.verdict === "fail" ? "bad" : "warn")}</td>
                      <td>${f.severity}</td>
                      <td class="message">${f.message}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`
    }`;
}

function iterationsSection(record: ReportRecord, model: ReportModel): Html {
  if (record.iterations.length === 0) return html`<p class="note">The run made no agent call.</p>`;
  const last = record.iterations[record.iterations.length - 1]?.n;
  return html`<div class="scroll">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Model</th>
            <th scope="col">Effort</th>
            <th scope="col">Call</th>
            <th scope="col">Duration</th>
            <th scope="col">Cost</th>
            <th scope="col">Tokens</th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          ${record.iterations.map(
            (i) =>
              html`<tr>
                <td>${String(i.n)}</td>
                <td>${i.call.model}</td>
                <td>${i.call.effort ?? "default"}</td>
                <td>${i.call.end}</td>
                <td>${duration(i.call.durationSeconds)}</td>
                <td>${usd(i.call.costUsd)}${i.call.costEstimated === true ? " (estimated)" : ""}</td>
                <td>${tokens(i.call.tokens)}</td>
                <td>${pill(i.outcome, statusClass(i.outcome))}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    ${record.iterations.map((i) => iterationDetails(i, i.n === last, model))}`;
}

function iterationDetails(iteration: ReportIteration, open: boolean, model: ReportModel): Html {
  const files = iteration.call.filesChanged ?? [];
  const violations = iteration.violations ?? [];
  const edits = model.record.handEdits.filter((edit) => edit.after === iteration.n).flatMap((edit) => edit.files);
  return html`<details class="iteration" ${open ? html` open` : ""}>
    <summary>Iteration ${String(iteration.n)}: ${iteration.outcome}</summary>
    ${
      files.length === 0
        ? html``
        : html`<p>Files changed: ${files.map((f, i) => html`${i === 0 ? "" : ", "}<code>${f}</code>`)}</p>`
    }
    ${
      violations.length === 0
        ? html``
        : html`<p class="bad-text">
            Files changed outside the allowed paths:
            ${violations.map((f, i) => html`${i === 0 ? "" : ", "}<code>${f}</code>`)}
          </p>`
    }
    ${
      edits.length === 0
        ? html``
        : html`<p>
            Changed by a person after this iteration:
            ${edits.map((f, i) => html`${i === 0 ? "" : ", "}<code>${f}</code>`)}
          </p>`
    }
    ${
      iteration.verification === undefined
        ? html`<p class="note">No checks ran in this iteration.</p>`
        : html`${checksSection(iteration.verification.checks, model)}
            <h4>Judge</h4>
            ${judgeSection(iteration.verification.judge, model)}`
    }
  </details>`;
}

function verifyExtras(details: VerifyDetails | undefined): Html {
  if (details === undefined) return html``;
  const incomplete = details.incomplete;
  const unused = details.unusedExemptions;
  return html`${
    incomplete.length === 0
      ? html``
      : html`<h3>For a person to look at</h3>
          <p class="note">axe couldn't decide these; they never block.</p>
          <ul class="findings">
            ${incomplete.map(
              (f) =>
                html`<li class="finding">
                  <code>${f.check}/${f.rule}</code> <code class="where">${location(f)}</code>
                  <div class="message">${f.message}</div>
                </li>`,
            )}
          </ul>`
  }
  ${
    unused.length === 0
      ? html``
      : html`<h3>Unused exemptions</h3>
          <p class="note">These spec exemptions waived nothing in this run; they don't fail it.</p>
          <ul>
            ${unused.map(
              (u) =>
                html`<li>
                  <code>${u.component}</code> exemption ${String(u.index)}: <code>${u.check}/${u.rule}</code>:
                  ${u.reason}
                </li>`,
            )}
          </ul>`
  }`;
}

function image(src: string | undefined, alt: string, label: string): Html {
  return src === undefined
    ? html`<figure class="missing">
        <div class="placeholder">no image</div>
        <figcaption>${label}</figcaption>
      </figure>`
    : html`<figure>
        <a href="${relativeUrl(src)}"><img src="${relativeUrl(src)}" alt="${alt}" loading="lazy" /></a>
        <figcaption>${label}</figcaption>
      </figure>`;
}

function visualSection(model: ReportModel): Html {
  const changed = model.captures.filter((c) => c.status === "changed");
  const renamed = model.captures.filter((c) => c.renamedFrom !== undefined);
  const orphans = model.details?.orphans.filter((o) => o.renamedTo === undefined) ?? [];
  const base = model.details?.base;
  if (changed.length === 0 && renamed.length === 0 && orphans.length === 0 && base === undefined) {
    return html`<p class="note">No story changed against its baseline.</p>`;
  }
  return html`${changed.map(
    (c) =>
      html`<div class="diff">
        <h3><code>${c.story}</code> <span class="theme">${c.theme}</span></h3>
        <div class="images">
          ${image(c.baseline, `${c.story} in ${c.theme}: the baseline`, "Baseline")}
          ${image(c.image, `${c.story} in ${c.theme}: this run's capture`, "This run")}
          ${image(c.diff, `${c.story} in ${c.theme}: the differing pixels`, "Diff")}
        </div>
      </div>`,
  )}
  ${
    renamed.length === 0
      ? html``
      : html`<h3>Renamed</h3>
          <p class="note">An orphaned baseline and a new story with identical pixels.</p>
          <ul>
            ${renamed.map((c) => html`<li><code>${c.renamedFrom ?? ""}</code> → <code>${c.path}</code></li>`)}
          </ul>`
  }
  ${
    orphans.length === 0
      ? html``
      : html`<h3>Orphaned baselines</h3>
          <p class="note">
            Files in the baselines directory that belong to no story; <code>fazon baseline update</code> removes them.
          </p>
          <ul>
            ${orphans.map((o) => html`<li><code>${o.path}</code></li>`)}
          </ul>`
  }
  ${
    base === undefined
      ? html``
      : html`<h3>Baselines that differ from <code>${base.ref}</code></h3>
          ${
            base.changes.length === 0
              ? html`<p class="note">None.</p>`
              : html`<ul>
                  ${base.changes.map(
                    (change) =>
                      html`<li>
                        ${change.mark}
                        <code>${change.path}</code
                        >${change.from === undefined ? "" : html` (from <code>${change.from}</code>)`}
                      </li>`,
                  )}
                </ul>`
          }`
  }`;
}

function storyFindings(model: ReportModel, capture: ReportCapture): { checks: number; judge: string[] } {
  const verification = galleryVerification(model.record)?.verification;
  const checks = (verification?.checks ?? [])
    .flatMap((c) => c.findings)
    .filter((f) => f.story === capture.story && f.theme === capture.theme).length;
  const judge = (verification?.judge?.findings ?? [])
    .filter((f) => f.story === capture.story && f.theme === capture.theme)
    .map((f) => `judge ${f.verdict}`);
  return { checks, judge };
}

function gallerySection(model: ReportModel): Html {
  if (model.captures.length === 0) return html`<p class="note">The run has no captures.</p>`;
  const iteration = galleryVerification(model.record)?.iteration;
  const byComponent = new Map<string, Map<string, ReportCapture[]>>();
  for (const capture of model.captures) {
    const stories = byComponent.get(capture.component) ?? new Map<string, ReportCapture[]>();
    stories.set(capture.story, [...(stories.get(capture.story) ?? []), capture]);
    byComponent.set(capture.component, stories);
  }
  const components = [...byComponent.keys()].sort();
  return html`<p class="note">
      ${iteration === undefined ? "" : `The captures of iteration ${String(iteration)}. `}Each screenshot links to its
      live story in the local Storybook at <code>${model.storybookUrl}</code>; start it with
      <code>storybook dev</code> on that port. The links below a screenshot open the PNG file.
    </p>
    ${
      components.length > 1
        ? html`<nav class="toc">${components.map((c) => html`<a href="#component-${c}">${c}</a> `)}</nav>`
        : ""
    }
    ${components.map((component) => {
      const stories = byComponent.get(component) ?? new Map<string, ReportCapture[]>();
      return html`<section class="component" id="component-${component}">
        <h3>${component}</h3>
        ${[...stories.keys()].sort().map((story) => {
          const captures = [...(stories.get(story) ?? [])].sort((a, b) => (a.theme < b.theme ? -1 : 1));
          return html`<div class="story">
            <h4><code>${story}</code></h4>
            <div class="images">
              ${captures.map((capture) => {
                const found = storyFindings(model, capture);
                const alt = `${capture.story} in ${capture.theme}`;
                const picture =
                  capture.image === undefined
                    ? html`<div class="placeholder">no capture</div>`
                    : html`<img src="${relativeUrl(capture.image)}" alt="${alt}" loading="lazy" />`;
                return html`<figure>
                  ${
                    capture.storybook === undefined
                      ? picture
                      : html`<a href="${capture.storybook}" title="Open in Storybook">${picture}</a>`
                  }
                  <figcaption>
                    <span class="theme">${capture.theme}</span>
                    ${capture.status === undefined ? "" : pill(capture.status, capture.status === "changed" ? "warn" : "muted")}
                    ${found.checks === 0 ? "" : pill(plural(found.checks, "finding"), "bad")}
                    ${found.judge.map((j) => pill(j, j === "judge fail" ? "bad" : "warn"))}
                    ${capture.image === undefined ? "" : html`<a href="${relativeUrl(capture.image)}">PNG</a>`}
                    ${capture.diff === undefined ? "" : html`<a href="${relativeUrl(capture.diff)}">diff</a>`}
                  </figcaption>
                </figure>`;
              })}
            </div>
          </div>`;
        })}
      </section>`;
    })}`;
}

const style = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1d21; --muted: #5d6470; --line: #d9dde3; --panel: #f4f6f8;
  --ok: #17663a; --ok-bg: #e3f4ea; --bad: #a3261b; --bad-bg: #fbe7e5; --warn: #8a5a00; --warn-bg: #fdf1d8; --link: #1f5fbf; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #15171a; --fg: #e6e8eb; --muted: #9aa1ab; --line: #343941; --panel: #1e2126;
    --ok: #7fd6a0; --ok-bg: #173323; --bad: #f19a90; --bad-bg: #3b1d1a; --warn: #f0c46a; --warn-bg: #382c12; --link: #8ab6f5; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1200px; margin: 0 auto; }
a { color: var(--link); }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.25rem; margin: 32px 0 8px; padding-top: 8px; border-top: 1px solid var(--line); }
h3 { font-size: 1.05rem; margin: 20px 0 8px; }
h4 { font-size: 0.95rem; margin: 14px 0 6px; }
code { font: 0.88em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.subtitle { color: var(--muted); margin: 0 0 16px; }
.note { color: var(--muted); }
.pill { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 0.8rem; font-weight: 600;
  background: var(--panel); color: var(--muted); white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.big { font-size: 1rem; padding: 2px 12px; }
.bad-text { color: var(--bad); }
.next { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px 16px 8px; margin-top: 16px; }
.next h2 { border: 0; margin-top: 8px; }
.command { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--line); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; }
table.facts th { text-align: left; font-weight: 600; padding: 2px 16px 2px 0; vertical-align: top; white-space: nowrap; }
table.facts td { padding: 2px 0; }
table.grid { width: 100%; }
table.grid th, table.grid td { text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.findings { padding-left: 20px; }
.finding { margin: 6px 0; }
.message { white-space: pre-wrap; overflow-wrap: anywhere; }
.expect { color: var(--muted); font-size: 0.9rem; }
details.iteration { border: 1px solid var(--line); border-radius: 8px; padding: 4px 12px; margin: 10px 0; }
details.iteration summary { cursor: pointer; font-weight: 600; }
.toc a { margin-right: 10px; }
.images { display: flex; flex-wrap: wrap; gap: 12px; }
figure { margin: 0; max-width: 100%; }
figure img { display: block; max-width: min(100%, 480px); height: auto; border: 1px solid var(--line);
  background: repeating-conic-gradient(var(--panel) 0 25%, var(--bg) 0 50%) 0 0 / 16px 16px; }
figcaption { font-size: 0.85rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
.placeholder { width: 160px; height: 90px; display: grid; place-items: center; border: 1px dashed var(--line); color: var(--muted); }
.theme { font-weight: 600; }
.story { margin-bottom: 16px; }
footer { margin-top: 40px; color: var(--muted); font-size: 0.85rem; }
`;

/** The report's page, as one HTML document. */
export function renderReport(model: ReportModel): string {
  const { record } = model;
  const gallery = galleryVerification(record);
  const checks = gallery?.verification.checks ?? [];
  const title = `${record.component ?? "All components"}: ${record.kind} run ${record.id}`;
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src 'self' file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        />
        <meta name="referrer" content="no-referrer" />
        <title>Fazon report: ${title}</title>
        <style>
          ${style}
        </style>
      </head>
      <body>
        <main>
          <header>
            <h1>Fazon report ${pill(statusLabel(record), `big ${statusClass(record.status)}`)}</h1>
            <p class="subtitle">${title}</p>
            ${record.reason === undefined ? "" : html`<p><strong>Why:</strong> ${reasons[record.reason]}.</p>`}
          </header>
          ${steps(model)}
          <section aria-labelledby="overview">
            <h2 id="overview">Overview</h2>
            ${overview(model)}
            ${record.proposal === undefined ? "" : html`<p>Proposed API: <code>${record.proposal.path}</code></p>`}
          </section>
          ${
            record.kind === "verify"
              ? ""
              : html`<section aria-labelledby="iterations">
                  <h2 id="iterations">Iterations</h2>
                  ${iterationsSection(record, model)}
                </section>`
          }
          ${
            record.kind === "verify"
              ? html`<section aria-labelledby="checks">
                    <h2 id="checks">Checks</h2>
                    ${checksSection(checks, model)} ${verifyExtras(model.details)}
                  </section>
                  <section aria-labelledby="judge">
                    <h2 id="judge">Judge</h2>
                    ${judgeSection(gallery?.verification.judge, model)}
                  </section>`
              : ""
          }
          <section aria-labelledby="visual">
            <h2 id="visual">Visual diffs</h2>
            ${visualSection(model)}
          </section>
          <section aria-labelledby="gallery">
            <h2 id="gallery">Gallery</h2>
            ${gallerySection(model)}
          </section>
          <footer>
            Built by Fazon ${record.versions.framework} from <code>.fazon/runs/${record.id}/run.json</code>.
          </footer>
        </main>
      </body>
    </html> `;
  return page.value;
}
