// SPDX-License-Identifier: GPL-3.0-or-later
import { runDirectory, writeRunRecord, writeVerifyDetails, type CheckResult, type RunRecord } from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactsPlaceholder, escapeMarkdown } from "../summary.js";
import { capture, captureJson, image, minimalConfig, removeRepository, repository } from "../test-support.js";

const checks = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;
const passing = checks.map((check): CheckResult => ({ check, status: "pass", durationSeconds: 1, findings: [] }));

function verifyRecord(id: string, verification: CheckResult[], overrides: Partial<RunRecord> = {}): RunRecord {
  const failed = verification.some((c) => c.status !== "pass");
  return {
    fazon: 0,
    id,
    kind: "verify",
    status: failed ? "failed" : "passed",
    started: "2026-11-27T10:00:00Z",
    ended: "2026-11-27T10:05:00Z",
    versions: { framework: "0.0.0", adapter: "0.0.0", image },
    config: {
      caps: { iterations: 6, budgetUsd: 5, runMinutes: 30, callMinutes: 10 },
      models: { generator: "claude-sonnet", escalation: "claude-opus", judge: "claude-sonnet" },
      escalateAfter: 3,
      judgePolicy: "advisory",
      judgeCalibrated: false,
    },
    iterations: [],
    verification: { checks: verification, captures: "captures" },
    handEdits: [],
    totals: { iterations: 0, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 0, escalated: false },
    ...overrides,
  };
}

/** Writes a verify run of `button` and `badge` with its record and details. */
async function writeRun(
  root: string,
  id: string,
  verification: CheckResult[],
  options: { base?: boolean; components?: string[]; overrides?: Partial<RunRecord> } = {},
): Promise<void> {
  const dir = runDirectory(root, id);
  await writeRunRecord(dir, verifyRecord(id, verification, options.overrides));
  const components = options.components ?? ["badge", "button"];
  await writeVerifyDetails(dir, {
    fazon: 0,
    platform: "linux/amd64",
    components: components.map((name) => ({
      name,
      inputs: "sha256:" + "0".repeat(64),
      checks: Object.fromEntries(
        verification.map((c) => [
          c.check,
          c.findings.some((f) => f.blocking && (f.file?.includes(`/${name}/`) ?? f.story?.startsWith(`${name}--`)))
            ? "fail"
            : c.status === "fail"
              ? "pass"
              : c.status,
        ]),
      ),
    })),
    stories: [
      { component: "button", story: "button--a", theme: "light", path: "light/button/a.png", status: "unchanged" },
      { component: "button", story: "button--b", theme: "light", path: "light/button/b.png", status: "changed" },
      { component: "badge", story: "badge--a", theme: "dark", path: "dark/badge/a.png", status: "new" },
    ],
    orphans: [],
    incomplete: [],
    unusedExemptions: [],
    ...(options.base === true
      ? {
          base: {
            ref: "origin/main",
            changes: [
              { path: "dark/badge/a.png", mark: "added" as const },
              { path: "light/button/b.png", mark: "changed" as const },
              { path: "light/button/c.png", mark: "renamed" as const, from: "light/button/old.png" },
              { path: "light/button/gone.png", mark: "removed" as const },
            ],
          },
        }
      : {}),
  });
}

const failing: CheckResult[] = passing.map((c) =>
  c.check === "lint"
    ? {
        ...c,
        status: "fail",
        findings: [
          {
            check: "lint",
            rule: "raw-value",
            message: "#2050d0 is a <literal> | not a token\nsecond line",
            file: "src/components/button/Button.vue",
            line: 3,
            blocking: true,
          },
          {
            check: "lint",
            rule: "raw-value",
            message: "waived",
            file: "src/components/button/Button.vue",
            line: 4,
            exempt: 0,
            blocking: false,
          },
        ],
      }
    : c.check === "build"
      ? {
          ...c,
          status: "fail",
          findings: [
            { check: "build", rule: "types", message: "outside any component", file: "src/index.ts", blocking: true },
          ],
        }
      : c,
);

describe("fazon report", () => {
  let root: string;
  beforeEach(async () => {
    root = await repository({ "fazon.yaml": minimalConfig });
  });
  afterEach(async () => {
    await removeRepository(root);
  });

  it("refuses (2) the HTML report until M2", async () => {
    const { json, code } = await captureJson(["report"], { cwd: root });
    expect(code).toBe(2);
    expect(JSON.stringify(json.messages)).toContain("The HTML report arrives in M2");
  });

  it("refuses (2) when there's no run, an unknown run ID, or no run of the component", async () => {
    expect((await captureJson(["report", "--summary"], { cwd: root })).json).toMatchObject({ status: "refused" });
    await writeRun(root, "20261127T100000Z-verify-0001", passing);
    const missing = await captureJson(["report", "--summary", "20261127T100000Z-verify-ffff"], { cwd: root });
    expect(missing.json).toMatchObject({ status: "refused", exitCode: 2 });
    const tabs = await captureJson(["report", "--summary", "tabs"], { cwd: root });
    expect(JSON.stringify(tabs.json.messages)).toContain("No verify run in .fazon/runs/ checked 'tabs'");
  });

  it("prints the latest run's summary as Markdown, and only that, on standard output", async () => {
    await writeRun(root, "20261127T090000Z-verify-0001", failing);
    await writeRun(root, "20261127T100000Z-verify-0002", passing, { base: true });
    const { stdout, stderr, code } = await capture(["report", "--summary"], { cwd: root });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^### Fazon verify passed\n/);
    expect(stdout).toContain("Run `20261127T100000Z-verify-0002`");
    expect(stdout).toContain("baselines compared with `origin/main`");
    expect(stdout).toContain("| badge | all pass | 0 | 0 unchanged, 0 changed, 1 new | 1 added |");
    expect(stdout).toContain(
      "| button | all pass | 0 | 1 unchanged, 1 changed, 0 new | 1 changed, 1 removed, 1 renamed |",
    );
    expect(stdout).toContain("- renamed `light/button/c.png` (from `light/button/old.png`)");
    expect(stdout).toContain("Not available yet: the judge arrives in M3");
    expect(stdout.trimEnd().endsWith(artifactsPlaceholder)).toBe(true);
  });

  it("lists a failed run's blocking findings by component, escaped, and the result in --json", async () => {
    const id = "20261127T090000Z-verify-0001";
    await writeRun(root, id, failing);
    const { json, code } = await captureJson(["report", "--summary", id], { cwd: root });
    expect(code).toBe(0);
    const result = json.result as {
      run: string;
      status: string;
      summary: string;
      components: { component: string; blocking: unknown[]; baselines: unknown[] }[];
      unowned: unknown[];
      judge: unknown;
    };
    expect(result).toMatchObject({ run: id, status: "failed", judge: { available: false, policy: "advisory" } });
    expect(result.components.map((c) => [c.component, c.blocking.length])).toEqual([
      ["badge", 0],
      ["button", 1],
    ]);
    expect(result.unowned).toHaveLength(1);
    expect(result.summary).toMatch(/^### Fazon verify failed\n/);
    expect(result.summary).toContain("| button | lint fail | 1 |");
    expect(result.summary).toContain("not compared");
    expect(result.summary).toContain(
      "- `lint/raw-value` `src/components/button/Button.vue:3`: \\#2050d0 is a \\<literal\\> \\| not a token\n",
    );
    expect(result.summary).not.toContain("second line");
    expect(result.summary).not.toContain("waived");
    expect(result.summary).toContain("#### Other findings\n\n- `build/types` `src/index.ts`: outside any component");
  });

  it("limits the summary to a component's latest run, and says when the judge is off", async () => {
    await writeRun(root, "20261127T090000Z-verify-0001", passing, {
      components: ["button"],
      overrides: { config: { ...verifyRecord("x", []).config, judgePolicy: "off" } },
    });
    await writeRun(root, "20261127T100000Z-verify-0002", passing, { components: ["badge"] });
    const { json } = await captureJson(["report", "--summary", "button"], { cwd: root });
    const result = json.result as { run: string; summary: string; components: { component: string }[] };
    expect(result.run).toBe("20261127T090000Z-verify-0001");
    expect(result.components.map((c) => c.component)).toEqual(["button"]);
    expect(result.summary).toContain("Off: `fazon.yaml` sets `judge.policy` to `off`");
  });

  it("says when a check ended in error, or the run never ended", async () => {
    const errored = passing.map((c): CheckResult =>
      c.check === "visual" ? { ...c, status: "error", message: "Chromium crashed\nstack" } : c,
    );
    await writeRun(root, "20261127T090000Z-verify-0001", errored, {
      overrides: { status: "failed", reason: "check-error" },
    });
    const first = await capture(["report", "--summary", "20261127T090000Z-verify-0001"], { cwd: root });
    expect(first.stdout).toMatch(/^### Fazon verify couldn't run every check\n/);
    expect(first.stdout).toContain("- `visual` ended in error: Chromium crashed\n");

    const id = "20261127T100000Z-verify-0002";
    await writeRun(root, id, passing);
    const started: Record<string, unknown> = { ...verifyRecord(id, passing), status: "running" };
    delete started.verification;
    delete started.ended;
    await writeRunRecord(runDirectory(root, id), started as unknown as RunRecord);
    const second = await capture(["report", "--summary"], { cwd: root });
    expect(second.stdout).toMatch(/^### Fazon verify didn't finish\n/);
  });
});

describe("escapeMarkdown", () => {
  it("escapes the characters that would start markup", () => {
    expect(escapeMarkdown("a*b_c`d[e](f)<g>|h~i#j\\k")).toBe("a\\*b\\_c\\`d\\[e\\](f)\\<g\\>\\|h\\~i\\#j\\\\k");
  });
});
