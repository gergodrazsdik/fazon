// SPDX-License-Identifier: GPL-3.0-or-later
// What blocks an iteration (docs/spec/loop-and-caps.md#what-blocks), and how the agent says it
// needs a person (docs/spec/loop-and-caps.md#how-a-run-ends).
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { CheckResult, JudgeSummary } from "../records/run-record.js";
import { kebabCase } from "../spec/names.js";
import type { AgentNeed } from "./types.js";

/** The visual rules whose findings are the component's own diffs: advisory in a generate run. */
const diffRules: ReadonlySet<string> = new Set(["changed", "orphan"]);

/**
 * Whether a finding is a visual diff (`changed`, `orphan`) of `component` (PascalCase): by its
 * story (`<kebab name>--…`) or by its baseline's path (`<theme>/<kebab name>/…`).
 */
export function isOwnVisualDiff(finding: CheckFinding, component: string): boolean {
  if (finding.check !== "visual" || !diffRules.has(finding.rule)) return false;
  const name = kebabCase(component);
  if (finding.story !== undefined) return finding.story.startsWith(`${name}--`);
  return finding.file?.split("/")[1] === name;
}

/**
 * The checks as a generate or feedback run of `component` counts them
 * (docs/spec/baseline-lifecycle.md#the-visual-check-by-context): the component's own visual diffs
 * don't block; they stay in the record for the report. Every other finding keeps its `blocking`.
 */
export function generateContext(checks: readonly CheckResult[], component: string): CheckResult[] {
  return checks.map((check) =>
    check.check === "visual" &&
    check.findings.some((finding) => finding.blocking && isOwnVisualDiff(finding, component))
      ? {
          ...check,
          findings: check.findings.map((finding) =>
            finding.blocking && isOwnVisualDiff(finding, component) ? { ...finding, blocking: false } : finding,
          ),
        }
      : check,
  );
}

/** How a check phase came out for the loop. */
export interface PhaseVerdict {
  /** No check ended in error or was skipped, no finding blocks, and the judge's fails don't block. */
  readonly passes: boolean;
  /** The findings that block, for the next prompt. */
  readonly blocking: readonly CheckFinding[];
  /** The checks that ended in error. */
  readonly errored: readonly CheckId[];
}

/**
 * Judges a check phase (and the judge's summary, when it ran). A check that ended in error or was
 * skipped didn't show the component is right, so it fails the iteration, as it fails a verify run.
 */
export function phaseVerdict(checks: readonly CheckResult[], judge?: JudgeSummary): PhaseVerdict {
  const blocking = checks.flatMap((check) => check.findings.filter((finding) => finding.blocking));
  const errored = checks.filter((check) => check.status === "error").map((check) => check.check);
  const incomplete = checks.some((check) => check.status === "error" || check.status === "skipped");
  const judgeBlocks = judge?.blocking === true && judge.stories.fail > 0;
  return { passes: !incomplete && blocking.length === 0 && !judgeBlocks, blocking, errored };
}

/** The marker that starts the agent's line saying what it needs. */
export const needMarker = "FAZON-NEEDS";

/**
 * Reads the agent's need for a person from its final message: a line
 * `FAZON-NEEDS dependency: <what>` or `FAZON-NEEDS shared-code: <what>`. The first such line counts;
 * undefined when there is none.
 */
export function parseAgentNeed(text: string): AgentNeed | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(`${needMarker} `)) continue;
    const rest = line.slice(needMarker.length + 1).trimStart();
    const colon = rest.indexOf(":");
    if (colon === -1) continue;
    const kind = rest.slice(0, colon).trim();
    if (kind !== "dependency" && kind !== "shared-code") continue;
    const message = rest.slice(colon + 1).trim();
    return {
      kind,
      message:
        message === ""
          ? `The component needs a ${kind === "dependency" ? "new dependency" : "change to shared code"}.`
          : message,
    };
  }
  return undefined;
}
