// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckFinding, CheckId } from "../checks/types.js";
import { resolveConfig } from "../config/load.js";
import { writeJsonAtomically } from "../records/json-file.js";
import { runRecordProblems, type CheckResult } from "../records/run-record.js";
import type { Adapter } from "../adapter.js";
import {
  checkIterationInImage,
  checksPhaseFiles,
  erroredChecks,
  generateRunChecks,
  imageChecksPhase,
  readIterationChecks,
  type ImageRunRequest,
  type IterationChecks,
} from "./checks.js";
import { runAgent } from "./run.js";
import { loopSettings } from "./settings.js";
import type { ChecksInput } from "./types.js";

const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const checkIds: readonly CheckId[] = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"];

function finding(check: CheckId, rule: string, extra: Partial<CheckFinding> = {}): CheckFinding {
  return { check, rule, message: `${check}/${rule} found something.`, blocking: true, ...extra };
}

/** Every check passes, with the given results in place of their check's. */
function checks(...overrides: CheckResult[]): CheckResult[] {
  return checkIds.map(
    (check) => overrides.find((o) => o.check === check) ?? { check, status: "pass", durationSeconds: 1, findings: [] },
  );
}

/** The visual check, failing with the given findings. */
function visual(...findings: CheckFinding[]): CheckResult {
  return { check: "visual", status: "fail", durationSeconds: 1, findings };
}

const ownChange = finding("visual", "changed", { story: "button--default--primary--md--default", theme: "light" });
const ownOrphan = finding("visual", "orphan", { file: "dark/button/button--gone.png" });
const otherChange = finding("visual", "changed", { story: "badge--default--info--default", theme: "light" });

let runDir: string;
beforeEach(async () => {
  runDir = await mkdtemp(path.join(tmpdir(), "fazon-checks-phase-"));
});
afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

function input(iteration: number, controller = new AbortController()): ChecksInput {
  return { runDir, iteration, captures: `captures/${String(iteration)}`, signal: controller.signal };
}

/** What the in-image part writes for an iteration. */
function written(iteration: number, results: CheckResult[]): IterationChecks {
  return { fazon: 0, iteration, checks: results, captures: `captures/${String(iteration)}` };
}

async function writeResult(iteration: number, results: CheckResult[]): Promise<void> {
  await writeJsonAtomically(
    path.join(runDir, `checks/${String(iteration)}`),
    "checks.json",
    written(iteration, results),
  );
}

describe("the generate run's checks", () => {
  it("makes the component's own visual diffs advisory, and passes a check left with no blocking finding", () => {
    const counted = generateRunChecks(checks(visual(ownChange, ownOrphan)), "Button");
    const result = counted.find((c) => c.check === "visual");
    expect(result?.status).toBe("pass");
    expect(result?.findings.map((f) => f.blocking)).toEqual([false, false]);
  });

  it("keeps another component's diff blocking, so a regression elsewhere fails the iteration", () => {
    const counted = generateRunChecks(checks(visual(ownChange, otherChange)), "Button");
    const result = counted.find((c) => c.check === "visual");
    expect(result?.status).toBe("fail");
    expect(result?.findings.map((f) => f.blocking)).toEqual([false, true]);
  });

  it("leaves every other check as it is: findings, waived findings and errors", () => {
    const tokens: CheckResult = {
      check: "tokens",
      status: "fail",
      durationSeconds: 1,
      findings: [finding("tokens", "raw-value"), finding("tokens", "user-agent", { blocking: false, exempt: 0 })],
    };
    const layout: CheckResult = { check: "layout", status: "error", durationSeconds: 1, message: "boom", findings: [] };
    const counted = generateRunChecks(checks(tokens, layout), "Button");
    expect(counted.find((c) => c.check === "tokens")).toEqual(tokens);
    expect(counted.find((c) => c.check === "layout")).toEqual(layout);
  });

  it("ends every check in error with one message", () => {
    const errored = erroredChecks("The image couldn't start.");
    expect(errored.map((c) => c.check)).toEqual(checkIds);
    expect(errored.every((c) => c.status === "error" && c.message === "The image couldn't start.")).toBe(true);
  });

  it("names an iteration's files after the loop's captures directory", () => {
    expect(checksPhaseFiles(3)).toEqual({
      directory: "checks/3",
      result: "checks/3/checks.json",
      details: "checks/3/verify.json",
      captures: "captures/3",
    });
  });
});

describe("the checks phase", () => {
  it("refreshes the generated files, starts the image, and reads back the iteration's checks in the generate context", async () => {
    const order: string[] = [];
    const requests: ImageRunRequest[] = [];
    const phase = imageChecksPhase({
      component: "Button",
      refresh: () => {
        order.push("refresh");
        return Promise.resolve();
      },
      runImage: async (request) => {
        order.push("image");
        requests.push(request);
        await writeResult(request.iteration, checks(visual(ownChange)));
        return { exitCode: 0, output: "" };
      },
    });
    const outcome = await phase(input(2));
    expect(order).toEqual(["refresh", "image"]);
    expect(requests[0]).toMatchObject({ runDir, iteration: 2 });
    expect(outcome.captures).toBe("captures/2");
    expect(outcome.checks.find((c) => c.check === "visual")).toMatchObject({
      status: "pass",
      findings: [{ rule: "changed", blocking: false }],
    });
  });

  it("ends every check in error when the image wrote no results, with the end of its output", async () => {
    // A stale result of the same iteration (a crashed earlier attempt) isn't read as this one's.
    await writeResult(1, checks());
    const phase = imageChecksPhase({
      component: "Button",
      runImage: () => Promise.resolve({ exitCode: 3, output: "line 1\nThe repository's Playwright is 1.70.0\n" }),
    });
    const outcome = await phase(input(1));
    expect(outcome.captures).toBe("captures/1");
    expect(outcome.checks).toHaveLength(checkIds.length);
    for (const check of outcome.checks) {
      expect(check.status).toBe("error");
      expect(check.message).toContain("exit 3");
      expect(check.message).toContain("The repository's Playwright is 1.70.0");
    }
  });

  it("says so when the container runtime couldn't be started, or the image was killed", async () => {
    const notStarted = await imageChecksPhase({ component: "Button", runImage: () => Promise.resolve(undefined) })(
      input(1),
    );
    expect(notStarted.checks[0]?.message).toBe("The container runtime couldn't be started.");
    const killed = await imageChecksPhase({
      component: "Button",
      runImage: () => Promise.resolve({ exitCode: null, output: "" }),
    })(input(1));
    expect(killed.checks[0]?.message).toBe("The checks couldn't run in the verifier image (exit killed).");
  });

  it("ignores a result file of another iteration, or one that isn't the checks' shape", async () => {
    await writeResult(1, checks());
    expect(await readIterationChecks(runDir, 1)).toEqual(written(1, checks()));
    await mkdir(path.join(runDir, "checks/2"), { recursive: true });
    await writeFile(path.join(runDir, "checks/2/checks.json"), JSON.stringify(written(1, checks())));
    expect(await readIterationChecks(runDir, 2)).toBeUndefined();
    await writeFile(
      path.join(runDir, "checks/2/checks.json"),
      JSON.stringify({ ...written(2, []), checks: [{ check: "spelling", status: "pass" }] }),
    );
    expect(await readIterationChecks(runDir, 2)).toBeUndefined();
    await writeFile(path.join(runDir, "checks/2/checks.json"), "{");
    expect(await readIterationChecks(runDir, 2)).toBeUndefined();
  });

  it("passes the interrupt signal to the runner", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await imageChecksPhase({
      component: "Button",
      runImage: (request) => {
        seen = request.signal;
        controller.abort();
        return Promise.resolve({ exitCode: null, output: "" });
      },
    })(input(1, controller));
    expect(seen?.aborted).toBe(true);
  });

  it("lets a generate run pass on its component's own diffs, and fail on another component's", async () => {
    const settings = loopSettings(resolveConfig({ fazon: 0, adapter: "vue", image }).config);
    const phases = [checks(visual(otherChange, ownChange)), checks(visual(ownChange))];
    const outcome = await runAgent(
      {
        kind: "generate",
        id: "20261126T100000Z-button-3f9a",
        runDir,
        component: "Button",
        settings,
        versions: { framework: "0.1.0", adapter: "0.1.0", claudeCode: "2.1.332", image },
      },
      {
        call: () =>
          Promise.resolve({
            end: "completed",
            tokens: { input: 1, output: 1 },
            costUsd: 0.5,
            costEstimated: false,
            filesChanged: [],
            violations: [],
            handEdits: [],
          }),
        checks: imageChecksPhase({
          component: "Button",
          runImage: async (request) => {
            await writeResult(request.iteration, phases[request.iteration - 1] ?? checks());
            return { exitCode: 0, output: "" };
          },
        }),
        writeRecord: (record) => {
          expect(runRecordProblems(record)).toEqual([]);
          return Promise.resolve();
        },
      },
    );
    expect(outcome.record.status).toBe("passed");
    expect(outcome.record.iterations.map((i) => i.outcome)).toEqual(["fail", "pass"]);
    expect(outcome.record.iterations[1]?.verification?.captures).toBe("captures/2");
  });
});

describe("the in-image part", () => {
  it("ends every check in error, and still writes the iteration's results, when the image can't run the checks", async () => {
    const repo = path.join(runDir, "repo");
    await mkdir(repo, { recursive: true });
    const config = resolveConfig({ fazon: 0, adapter: "vue", image }).config;
    const result = await checkIterationInImage({
      repo,
      runDir: path.join(runDir, "run"),
      config,
      adapter: {} as Adapter,
      component: "Button",
      iteration: 2,
      work: path.join(runDir, "work"),
      log: () => undefined,
      browsersPath: path.join(runDir, "browsers"),
    });
    expect(result.checks.every((c) => c.status === "error")).toBe(true);
    expect(result.checks[0]?.message).toMatch(
      /^The checks can't run in the verifier image: .*doesn't install Playwright/,
    );
    expect(result.captures).toBe("captures/2");
    expect(JSON.parse(await readFile(path.join(runDir, "run/checks/2/checks.json"), "utf8"))).toEqual(result);
    expect(await readIterationChecks(path.join(runDir, "run"), 2)).toEqual(result);
  });
});
