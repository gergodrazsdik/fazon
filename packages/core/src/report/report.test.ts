// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config/load.js";
import type { Config } from "../config/types.js";
import type { VerifyDetails } from "../verify/details.js";
import { runDirectory, type CheckResult, type RunRecord } from "../verify/run-record.js";
import { buildReport, storybookStoryUrl } from "./build.js";
import { escapeHtml, html, relativeUrl } from "./html.js";
import { nextSteps, renderReport, type ReportModel } from "./render.js";
import type { ReportRecord } from "./types.js";

const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const exampleRun = fileURLToPath(new URL("../../../../docs/spec/examples/records/run.json", import.meta.url));
const png = (text: string) => Buffer.from(`\x89PNG ${text}`);
const hostile = `<script>alert("x")</script> & 'quote'`;

async function generateRecord(): Promise<ReportRecord> {
  return JSON.parse(await readFile(exampleRun, "utf8")) as ReportRecord;
}

function model(record: ReportRecord, extra: Partial<ReportModel> = {}): ReportModel {
  return { record, captures: [], evidence: new Map(), storybookUrl: "http://localhost:6006", ...extra };
}

const checks = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;
const passing = checks.map((check): CheckResult => ({ check, status: "pass", durationSeconds: 1, findings: [] }));

function verifyRecord(id: string, verification: CheckResult[], overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    fazon: 0,
    id,
    kind: "verify",
    status: verification.some((c) => c.status !== "pass") ? "failed" : "passed",
    started: "2026-11-27T10:00:00Z",
    ended: "2026-11-27T10:05:00Z",
    versions: { framework: "0.0.0", adapter: "0.0.0", image },
    config: {
      caps: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20 },
      models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
      escalateAfter: 2,
      judgePolicy: "off",
    },
    iterations: [],
    verification: { checks: verification, captures: "captures" },
    handEdits: [],
    totals: { iterations: 0, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 0, escalated: false },
    ...overrides,
  };
}

describe("escaping", () => {
  it("escapes every character that could start markup or end an attribute", () => {
    expect(escapeHtml(hostile)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;");
  });

  it("escapes interpolated values but keeps markup the tag made, and lists of it", () => {
    const inner = html`<b>${"<i>"}</b>`;
    const out = html`<p title="${'"x"'}">${inner}${[html`<br />`, "<br>"]}${undefined}${false}${3}</p>`;
    expect(out.value).toBe('<p title="&quot;x&quot;"><b>&lt;i&gt;</b><br />&lt;br&gt;3</p>');
  });

  it("percent-encodes each segment of a relative URL", () => {
    expect(relativeUrl("images/run/captures/light/a #1?.png")).toBe("images/run/captures/light/a%20%231%3F.png");
  });

  it("builds Storybook links from an http or https base only", () => {
    expect(storybookStoryUrl("http://localhost:6006", "button--label", "dark")).toBe(
      "http://localhost:6006/?path=/story/button--label&globals=theme:dark",
    );
    expect(storybookStoryUrl("https://example.test/sb///", "a--b", "light")).toBe(
      "https://example.test/sb/?path=/story/a--b&globals=theme:light",
    );
    expect(storybookStoryUrl("javascript:alert(1)", "a--b", "light")).toBeUndefined();
    expect(storybookStoryUrl("not a url", "a--b", "light")).toBeUndefined();
  });
});

describe("renderReport", () => {
  it("shows an agent run's iterations, models, cost, judge verdicts and next steps", async () => {
    const record = await generateRecord();
    const page = renderReport(model(record));
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain("Content-Security-Policy");
    expect(page).not.toMatch(/<script|<link|src="http/);
    expect(page).toContain("Iteration 3: pass");
    expect(page).toContain("claude-sonnet-5-5, claude-opus-5-5");
    expect(page).toContain("escalated to claude-opus-5-5");
    expect(page).toContain("$4.20 (agent $3.85, judge $0.35)");
    expect(page).toContain("29 min 35 s");
    expect(page).toContain("button--label--variant-ghost--size-md--loading");
    expect(page).toContain("loading-spinner");
    expect(page).toContain("1 unsure");
    expect(page).toContain("fazon feedback button -m &quot;…&quot;");
    expect(page).toContain("fazon accept button");
    // The earlier iterations' findings are there too, in their own sections.
    expect(page).toContain("padding-inline: 12px is a raw value; use a spacing token.");
  });

  it("escapes findings, spec text and paths from the record", async () => {
    const record = await generateRecord();
    const [first] = record.iterations;
    if (first?.verification === undefined) throw new Error("the example has a verification");
    const tampered: ReportRecord = {
      ...record,
      component: "Button",
      iterations: [
        {
          ...first,
          call: { ...first.call, filesChanged: [`src/${hostile}.vue`] },
          verification: {
            ...first.verification,
            checks: [
              {
                check: "lint",
                status: "fail",
                durationSeconds: 1,
                findings: [
                  {
                    check: "lint",
                    rule: "raw-value",
                    message: hostile,
                    file: `src/${hostile}`,
                    expected: hostile,
                    blocking: true,
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const page = renderReport(
      model(tampered, {
        captures: [
          {
            component: "button",
            story: `button--${hostile}`,
            theme: `"><img src=x onerror=alert(1)>`,
            path: "light/button/a.png",
            image: `images/run/captures/"onerror="x.png`,
            storybook: "http://localhost:6006/?path=/story/a&globals=theme:light",
          },
        ],
      }),
    );
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain('"onerror="');
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("gives the next step for each end of a run", async () => {
    const record = await generateRecord();
    const commands = (r: ReportRecord, extra: Partial<ReportModel> = {}) =>
      nextSteps(model(r, extra)).map((s) => s.command);
    expect(commands({ ...record, status: "needs-a-person", reason: "iterations" })).toEqual([
      'fazon feedback button -m "…"',
      "fazon verify button",
    ]);
    expect(commands({ ...record, status: "needs-a-person", reason: "inputs-changed" })).toEqual([
      "fazon generate button",
    ]);
    expect(commands({ ...record, kind: "propose", proposal: { path: "specs/button.md" } })).toEqual([
      "fazon approve button",
    ]);
    const capture = { component: "button", story: "button--a", theme: "light", path: "light/button/a.png" };
    expect(commands(record, { captures: [{ ...capture, status: "new" }] })).toContain("fazon baseline update button");

    const verify = verifyRecord("20261127T100000Z-verify-0001", passing) as unknown as ReportRecord;
    expect(commands(verify)).toEqual([undefined]);
    expect(commands(verify, { captures: [{ ...capture, status: "changed" }] })).toEqual([
      "fazon baseline update button",
    ]);
    expect(commands({ ...verify, status: "failed", reason: "check-error" })).toEqual(["fazon doctor", "fazon verify"]);
  });
});

describe("buildReport", () => {
  let root: string;
  let config: Config;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-report-"));
    config = resolveConfig({ fazon: 0, adapter: "vue", image }).config;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(file: string, content: string | Buffer): Promise<void> {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }

  it("copies a verify run's captures, diffs and changed baselines next to the page, with relative links", async () => {
    const id = "20261127T100000Z-verify-0001";
    const run = `.fazon/runs/${id}`;
    const visual: CheckResult = {
      check: "visual",
      status: "fail",
      durationSeconds: 1,
      findings: [
        {
          check: "visual",
          rule: "changed",
          message: "The capture differs from its baseline.",
          story: "button--label--default",
          theme: "dark",
          evidence: "captures/dark/button/label--default.diff.png",
          blocking: true,
        },
      ],
    };
    const record = verifyRecord(id, [...passing.slice(0, 7), visual]);
    const details: VerifyDetails = {
      fazon: 0,
      platform: "linux/amd64",
      components: [{ name: "button", inputs: "sha256:" + "0".repeat(64), checks: { visual: "fail" } }],
      stories: [
        {
          component: "button",
          story: "button--label--default",
          theme: "light",
          path: "light/button/label--default.png",
          status: "unchanged",
        },
        {
          component: "button",
          story: "button--label--default",
          theme: "dark",
          path: "dark/button/label--default.png",
          status: "changed",
          diff: "captures/dark/button/label--default.diff.png",
        },
        { component: "button", story: "button--x", theme: "light", path: "../../../../etc/passwd", status: "new" },
      ],
      orphans: [{ path: "light/button/old.png" }],
      incomplete: [],
      unusedExemptions: [{ component: "button", index: 0, check: "a11y", rule: "color-contrast", reason: hostile }],
    };
    await put(`${run}/captures/light/button/label--default.png`, png("light"));
    await put(`${run}/captures/dark/button/label--default.png`, png("dark"));
    await put(`${run}/captures/dark/button/label--default.diff.png`, png("diff"));
    await put("baselines/dark/button/label--default.png", png("before"));
    await put(
      "src/components/button/generated/stories.json",
      JSON.stringify({ stories: [{ name: "button--label--default", storybookId: "button--label-default" }] }),
    );
    await put(`${run}/report/images/stale.png`, png("stale"));

    const built = await buildReport({ root, config, record, details, storybookUrl: "http://localhost:7007/" });
    expect(built.path).toBe(`${run}/report/index.html`);
    expect(built.file).toBe(path.join(root, run, "report", "index.html"));
    expect(built.images).toBe(4);
    const reportDir = path.join(root, run, "report");
    const page = await readFile(built.file, "utf8");
    for (const image of [
      "images/run/captures/light/button/label--default.png",
      "images/run/captures/dark/button/label--default.png",
      "images/run/captures/dark/button/label--default.diff.png",
      "images/baselines/dark/button/label--default.png",
    ]) {
      expect(page).toContain(`src="${image}"`);
      expect((await stat(path.join(reportDir, image))).isFile()).toBe(true);
    }
    // No absolute path or path outside the report's directory is linked.
    expect(page).not.toContain(root);
    expect(page).not.toMatch(/(src|href)="(\/|\.\.)/);
    await expect(stat(path.join(reportDir, "images/stale.png"))).rejects.toThrow();
    expect(page).toContain(
      'href="http://localhost:7007/?path=/story/button--label-default&amp;globals=theme:dark" title="Open in Storybook"',
    );
    expect(page).toContain('<a href="images/run/captures/dark/button/label--default.diff.png">Evidence</a>');
    expect(page).toContain("light/button/old.png");
    expect(page).toContain("fazon baseline update button");
    expect(page).toContain("&lt;script&gt;");
    expect(page).not.toContain("<script>");
  });

  it("builds an agent run's gallery from its last iteration's captures directory", async () => {
    const record = (await generateRecord()) as unknown as RunRecord;
    const run = runDirectory(root, record.id);
    await put(path.relative(root, `${run}/captures/3/light/button/label--a.png`), png("a"));
    await put(path.relative(root, `${run}/captures/3/light/button/label--b.png`), png("b"));
    await put(path.relative(root, `${run}/captures/3/light/button/label--b.diff.png`), png("b diff"));
    await put(path.relative(root, `${run}/captures/2/light/button/label--old.png`), png("old"));
    await put("baselines/light/button/label--b.png", png("b before"));
    await mkdir(path.join(run, "captures/3/dark/button"), { recursive: true });
    await symlink("/etc/passwd", path.join(run, "captures/3/dark/button/label--a.png"));

    const built = await buildReport({ root, config, record });
    expect(built.images).toBe(4);
    const page = await readFile(built.file, "utf8");
    expect(page).toContain("The captures of iteration 3.");
    expect(page).toContain("images/run/captures/3/light/button/label--a.png");
    expect(page).toContain("images/baselines/light/button/label--b.png");
    expect(page).not.toContain("label--old");
    expect(page).not.toContain("dark/button/label--a.png");
    expect(page).toContain('href="http://localhost:6006/?path=/story/button--label-a&amp;globals=theme:light"');
    expect(page).toContain("fazon accept button");
  });
});
