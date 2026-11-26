// SPDX-License-Identifier: GPL-3.0-or-later
// The checks phase of a generate or feedback run (docs/spec/loop-and-caps.md#an-iteration, step 4):
// every check in the verifier image, over the whole library, as `fazon verify` runs them, with the
// component's own visual diffs advisory (docs/spec/baseline-lifecycle.md#the-visual-check-by-context).
// The host part starts the image through an injected runner and reads back what the in-image part
// wrote into the iteration's `checks/<n>/` directory.
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { CheckId } from "../checks/types.js";
import { writeJsonAtomically } from "../records/json-file.js";
import type { CheckResult } from "../records/run-record.js";
import { writeVerifyDetails } from "../verify/details.js";
import { runImageChecks, type InImageOptions } from "../verify/in-image.js";
import { generateContext } from "./blocking.js";
import type { ChecksOutcome, ChecksPhase } from "./types.js";

/** Every check of the catalogue, in its order (docs/spec/check-catalogue.md#order-and-results). */
const everyCheck: readonly CheckId[] = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"];

/** The file the in-image part hands its results to the host in, in the iteration's directory. */
const resultFile = "checks.json";

/** An iteration's check-phase files, relative to the run's directory (docs/spec/records.md#the-fazon-directory). */
export interface ChecksPhaseFiles {
  /** `checks/<n>`: the tools' logs and reports, the Storybook build, the packed library, and the two files below. */
  readonly directory: string;
  /** `checks/<n>/checks.json`: the checks' results, as the in-image part hands them to the host. */
  readonly result: string;
  /** `checks/<n>/verify.json`: each story's visual status and each component's check statuses, as a verify run's `verify.json`. */
  readonly details: string;
  /** `captures/<n>`: the captures and diff images, at `<theme>/<component>/<story>.png`. */
  readonly captures: string;
}

export function checksPhaseFiles(iteration: number): ChecksPhaseFiles {
  const n = String(iteration);
  return {
    directory: `checks/${n}`,
    result: `checks/${n}/${resultFile}`,
    details: `checks/${n}/verify.json`,
    captures: `captures/${n}`,
  };
}

/** `checks/<n>/checks.json`: one iteration's checks, from the in-image part. */
export interface IterationChecks {
  readonly fazon: 0;
  readonly iteration: number;
  /** Every check, in the catalogue's order, with the exemptions applied and the generate run's context. */
  readonly checks: readonly CheckResult[];
  /** The captures' directory, relative to the run's directory: `captures/<n>`. */
  readonly captures: string;
}

/**
 * The checks as a generate or feedback run of `component` (PascalCase) records them: its own visual
 * diffs don't block (`generateContext`), and a check whose only findings are those passes, as a
 * check whose findings an exemption waives does. Every other finding keeps its `blocking`.
 */
export function generateRunChecks(checks: readonly CheckResult[], component: string): CheckResult[] {
  return generateContext(checks, component).map((check) =>
    check.status === "fail" && !check.findings.some((finding) => finding.blocking)
      ? { ...check, status: "pass" }
      : check,
  );
}

/** Every check ended in error, with the same message: the image couldn't run them. */
export function erroredChecks(message: string): CheckResult[] {
  return everyCheck.map((check) => ({ check, status: "error", durationSeconds: 0, message, findings: [] }));
}

export interface IterationInImageOptions extends Omit<InImageOptions, "names"> {
  /** The component the run generates, in PascalCase. */
  readonly component: string;
  readonly iteration: number;
}

/**
 * The in-image part of an iteration's checks phase: every check over the whole library, as a
 * verify run with no component named runs them, so a regression in another component blocks too.
 * Captures and diff images go to `captures/<n>`, and the tools' files to `checks/<n>`, where
 * `verify.json` and `checks.json` are written; the run record is the host's. An environment the
 * checks can't run in (the image's Playwright, a spec that doesn't load) ends every check in error.
 */
export async function checkIterationInImage(options: IterationInImageOptions): Promise<IterationChecks> {
  const files = checksPhaseFiles(options.iteration);
  const output = path.join(options.runDir, files.directory);
  await mkdir(output, { recursive: true });
  const outcome = await runImageChecks({
    ...options,
    names: [],
    output,
    captures: files.captures,
    context: (checks) => generateRunChecks(checks, options.component),
  });
  let checks: CheckResult[];
  if (outcome.kind === "environment") {
    checks = erroredChecks(`The checks can't run in the verifier image: ${outcome.problems.join(" ")}`);
  } else {
    checks = outcome.checks;
    await writeVerifyDetails(output, outcome.details);
  }
  const result: IterationChecks = { fazon: 0, iteration: options.iteration, checks, captures: files.captures };
  await writeJsonAtomically(output, resultFile, result);
  return result;
}

function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== "object" || value === null) return false;
  const check = value as Record<string, unknown>;
  return (
    typeof check.check === "string" &&
    (everyCheck as readonly string[]).includes(check.check) &&
    typeof check.status === "string" &&
    ["pass", "fail", "skipped", "error"].includes(check.status) &&
    typeof check.durationSeconds === "number" &&
    Array.isArray(check.findings)
  );
}

/** The iteration's `checks/<n>/checks.json`; undefined when it's missing, unreadable or not this iteration's. */
export async function readIterationChecks(runDir: string, iteration: number): Promise<IterationChecks | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(runDir, checksPhaseFiles(iteration).result), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const result = value as Partial<IterationChecks>;
  if (result.fazon !== 0 || result.iteration !== iteration || !Array.isArray(result.checks)) return undefined;
  if (!result.checks.every(isCheckResult) || typeof result.captures !== "string") return undefined;
  return result as IterationChecks;
}

/** What the host's runner is asked to do: start the verifier image on the in-image part of one iteration. */
export interface ImageRunRequest {
  /** The run's directory, absolute, which the image gets writable. */
  readonly runDir: string;
  readonly iteration: number;
  /** Aborted when the developer interrupts the run: the runner stops the container. */
  readonly signal: AbortSignal;
}

/** How the image's process ended: its exit code (null when it was killed) and the end of its output. */
export interface ImageRunExit {
  readonly exitCode: number | null;
  readonly output: string;
}

/**
 * Starts the verifier image on `checkIterationInImage` for the iteration and waits for it, as
 * `fazon verify` starts it for a verify run; undefined when the container runtime couldn't be started.
 */
export type ImageRunner = (request: ImageRunRequest) => Promise<ImageRunExit | undefined>;

export interface ImageChecksPhaseOptions {
  /** The component the run generates, in PascalCase. */
  readonly component: string;
  readonly runImage: ImageRunner;
  /**
   * Refreshes the generated files before each phase (`refreshGenerated`), as the call may have
   * written the component's root file, which its story files, contract tests and export wait for.
   * What it can't write, the `build` check's rule `generated` reports.
   */
  readonly refresh?: () => Promise<unknown>;
}

/** The last lines of the image's output, for a check's message. */
function tail(output: string, lines = 8): string {
  return output.trim().split("\n").slice(-lines).join("\n");
}

/**
 * The loop's checks phase (`ChecksPhase`) for a generate or feedback run: refreshes the generated
 * files, starts the image on the iteration, and reads back its results with the component's own
 * visual diffs advisory. When the image wrote no results (it couldn't start, crashed or was
 * stopped), every check ends in error with what the image printed, so the iteration fails, and
 * the same check in error twice in a row ends the run as needs a person (check-error).
 */
export function imageChecksPhase(options: ImageChecksPhaseOptions): ChecksPhase {
  return async (input): Promise<ChecksOutcome> => {
    const files = checksPhaseFiles(input.iteration);
    await options.refresh?.();
    await rm(path.join(input.runDir, files.result), { force: true });
    const exit = await options.runImage({ runDir: input.runDir, iteration: input.iteration, signal: input.signal });
    const result = await readIterationChecks(input.runDir, input.iteration);
    if (result === undefined) {
      const why =
        exit === undefined
          ? "The container runtime couldn't be started."
          : `The checks couldn't run in the verifier image (exit ${exit.exitCode === null ? "killed" : String(exit.exitCode)})${exit.output.trim() === "" ? "." : `:\n${tail(exit.output)}`}`;
      return { checks: erroredChecks(why), captures: input.captures };
    }
    return { checks: generateRunChecks(result.checks, options.component), captures: result.captures };
  };
}
