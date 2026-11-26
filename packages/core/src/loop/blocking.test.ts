// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { CheckFinding } from "../checks/types.js";
import { resolveConfig } from "../config/load.js";
import type { CheckResult } from "../records/run-record.js";
import { generateContext, isOwnVisualDiff, parseAgentNeed, phaseVerdict } from "./blocking.js";
import { loopSettings, modelFor, runConfig } from "./settings.js";

const visual = (rule: string, where: Partial<CheckFinding>): CheckFinding => ({
  check: "visual",
  rule,
  message: "differs",
  blocking: true,
  ...where,
});

describe("the component's own visual diffs", () => {
  it("are found by story or baseline path, by the component's kebab-case name", () => {
    expect(isOwnVisualDiff(visual("changed", { story: "radio-group--default" }), "RadioGroup")).toBe(true);
    expect(isOwnVisualDiff(visual("changed", { story: "radio-group-item--default" }), "RadioGroup")).toBe(false);
    expect(isOwnVisualDiff(visual("orphan", { file: "dark/radio-group/old.png" }), "RadioGroup")).toBe(true);
    expect(isOwnVisualDiff(visual("orphan", { file: "dark/radio/old.png" }), "RadioGroup")).toBe(false);
    // The baselines' image record is no diff of a component.
    expect(isOwnVisualDiff(visual("image", { file: "fazon.json" }), "RadioGroup")).toBe(false);
    expect(isOwnVisualDiff({ ...visual("changed", {}), check: "tokens", story: "radio-group--a" }, "RadioGroup")).toBe(
      false,
    );
  });

  it("stop blocking in a generate run; the check's other findings keep theirs", () => {
    const result: CheckResult = {
      check: "visual",
      status: "fail",
      durationSeconds: 1,
      findings: [visual("changed", { story: "button--default" }), visual("changed", { story: "badge--default" })],
    };
    const [adjusted] = generateContext([result], "Button");
    expect(adjusted?.status).toBe("fail");
    expect(adjusted?.findings.map((f) => f.blocking)).toEqual([false, true]);
    const untouched: CheckResult = { check: "lint", status: "pass", durationSeconds: 1, findings: [] };
    expect(generateContext([untouched], "Button")[0]).toBe(untouched);
  });
});

describe("a check phase's verdict", () => {
  const pass = (check: CheckResult["check"]): CheckResult => ({
    check,
    status: "pass",
    durationSeconds: 1,
    findings: [],
  });

  it("passes with no blocking finding, error or skipped check", () => {
    expect(phaseVerdict([pass("build"), pass("lint")])).toEqual({ passes: true, blocking: [], errored: [] });
    const advisory: CheckResult = {
      check: "visual",
      status: "fail",
      durationSeconds: 1,
      findings: [{ ...visual("changed", {}), blocking: false }],
    };
    expect(phaseVerdict([advisory]).passes).toBe(true);
  });

  it("fails on a blocking finding, an error or a skipped check, and names the errored checks", () => {
    const blocking = visual("changed", { story: "badge--default" });
    expect(phaseVerdict([{ ...pass("visual"), status: "fail", findings: [blocking] }])).toEqual({
      passes: false,
      blocking: [blocking],
      errored: [],
    });
    expect(phaseVerdict([{ ...pass("a11y"), status: "error" }])).toEqual({
      passes: false,
      blocking: [],
      errored: ["a11y"],
    });
    expect(phaseVerdict([{ ...pass("a11y"), status: "skipped" }]).passes).toBe(false);
  });

  it("fails on the judge's fails only when they block", () => {
    const judge = {
      calls: 1,
      costUsd: 0.1,
      stories: { pass: 3, fail: 1, unsure: 0, notJudged: 0 },
      results: "judge/1.json",
    };
    expect(phaseVerdict([pass("build")], { ...judge, blocking: false }).passes).toBe(true);
    expect(phaseVerdict([pass("build")], judge).passes).toBe(true);
    expect(phaseVerdict([pass("build")], { ...judge, blocking: true }).passes).toBe(false);
    expect(
      phaseVerdict([pass("build")], { ...judge, blocking: true, stories: { ...judge.stories, fail: 0 } }).passes,
    ).toBe(true);
  });
});

describe("the agent's need for a person", () => {
  it("is read from a FAZON-NEEDS line of its final message", () => {
    expect(parseAgentNeed("Done.\nFAZON-NEEDS dependency: date-fns for the calendar grid\n")).toEqual({
      kind: "dependency",
      message: "date-fns for the calendar grid",
    });
    expect(parseAgentNeed("  FAZON-NEEDS shared-code:  a focus-trap helper  ")).toEqual({
      kind: "shared-code",
      message: "a focus-trap helper",
    });
    expect(parseAgentNeed("FAZON-NEEDS dependency:")).toEqual({
      kind: "dependency",
      message: "The component needs a new dependency.",
    });
  });

  it("is absent without a well-formed line", () => {
    expect(parseAgentNeed("All checks should pass now.")).toBeUndefined();
    expect(parseAgentNeed("FAZON-NEEDS a person: please")).toBeUndefined();
    expect(parseAgentNeed("FAZON-NEEDS dependency date-fns")).toBeUndefined();
    expect(parseAgentNeed("I wrote FAZON-NEEDS dependency: x in the middle of a line")).toBeUndefined();
    expect(parseAgentNeed("FAZON-NEEDSdependency: x")).toBeUndefined();
  });
});

describe("the loop's settings", () => {
  const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "0".repeat(64);

  it("come from the config: the caps, models, effort and the judge's policy", () => {
    const { config } = resolveConfig(
      { fazon: 0, adapter: "vue", image, effort: { generator: "medium" }, judge: { policy: "blocking" } },
      { fazon: 0, loop: { budgetUsd: 4 } },
    );
    const settings = loopSettings(config, true);
    expect(settings).toEqual({
      caps: { iterations: 5, budgetUsd: 4, runMinutes: 90, callMinutes: 20 },
      models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
      escalateAfter: 2,
      judgePolicy: "blocking",
      judgeCalibrated: true,
      effort: { generator: "medium" },
    });
    expect(runConfig(settings)).not.toHaveProperty("effort");
    const off = resolveConfig({ fazon: 0, adapter: "vue", image }, { fazon: 0, judge: { localPolicy: "off" } });
    expect(loopSettings(off.config).judgePolicy).toBe("off");
    expect(loopSettings(off.config).judgeCalibrated).toBe(false);
  });

  it("choose the escalation model after the threshold (LOOP-003)", () => {
    const { config } = resolveConfig({ fazon: 0, adapter: "vue", image, effort: { escalation: "max" } });
    const settings = loopSettings(config);
    expect(modelFor(settings, 0)).toEqual({ model: "claude-sonnet-5-5", escalated: false });
    expect(modelFor(settings, 1)).toEqual({ model: "claude-sonnet-5-5", escalated: false });
    expect(modelFor(settings, 2)).toEqual({ model: "claude-opus-5-5", effort: "max", escalated: true });
  });
});
