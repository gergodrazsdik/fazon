// SPDX-License-Identifier: GPL-3.0-or-later
// A judge pass over a run's captures: each component's plan with its changes and family, the
// images read from the run and the baselines, the results file and the record's summary.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { baselinePath } from "../checks/visual.js";
import { buildManifest } from "../matrix/build.js";
import { parseSpecFile } from "../spec/load.js";
import type { StoryVisual } from "../verify/rendered.js";
import { judgeCalibrated, judgePass, type JudgePassComponent, type JudgePassInput, type JudgeResults } from "./pass.js";
import type { JudgeClient } from "./run.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const text = readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8");
const file = parseSpecFile("specs/button.md", text);
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const spec = file.spec;
const manifest = buildManifest(spec, { file: file.file, themes: ["light", "dark"] });
const button: JudgePassComponent = {
  name: "button",
  spec,
  specFile: "specs/button.md",
  specText: text,
  body: file.body,
  manifest,
};
const png = (() => {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(255);
  return PNG.sync.write(image);
})();

/** Answers every image `pass`, except the stories in `failing`; records each request's labels. */
function client(failing: ReadonlySet<string> = new Set()): JudgeClient & { labels: string[][] } {
  const labels: string[][] = [];
  return {
    labels,
    create: (params) => {
      const content = params.messages[0]?.content;
      const blocks = Array.isArray(content) ? content : [];
      const names = blocks.flatMap((block) =>
        block.type === "text" ? [...block.text.matchAll(/^Image \d+, label `([^`]+)`/g)].map((m) => m[1] ?? "") : [],
      );
      labels.push(names);
      const question = blocks[1]?.type === "text" ? (/Question `([^`]+)`/.exec(blocks[1].text)?.[1] ?? "") : "";
      const results = names.map((story) =>
        failing.has(story)
          ? { story, verdict: "fail", findings: [{ severity: "medium", message: `${story} looks off` }] }
          : { story, verdict: "pass", findings: [] },
      );
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ question, results }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message);
    },
  };
}

async function setup(): Promise<{ repo: string; runDir: string; visuals: StoryVisual[] }> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "fazon-judge-pass-"));
  const runDir = path.join(repo, ".fazon", "runs", "r");
  const visuals: StoryVisual[] = [];
  for (const story of manifest.stories) {
    for (const theme of manifest.themes) {
      const where = baselinePath(theme, "button", story.name);
      await mkdir(path.dirname(path.join(runDir, "captures", where)), { recursive: true });
      await writeFile(path.join(runDir, "captures", where), png);
      visuals.push({ component: "button", story: story.name, theme, path: where, status: "unchanged" });
    }
  }
  return { repo, runDir, visuals };
}

function input(
  repo: string,
  runDir: string,
  visuals: StoryVisual[],
  extra: Partial<JudgePassInput> = {},
): JudgePassInput {
  return {
    repo,
    runDir,
    captures: "captures",
    baselines: "baselines",
    components: [button],
    library: [{ name: "button", spec, manifest }],
    visuals,
    results: "judge.json",
    model: "claude-sonnet-5-5",
    repeats: 1,
    price: { input: 2, output: 10 },
    budgetUsd: 10,
    client: client(),
    now: () => 0,
    ...extra,
  };
}

describe("judgePass", () => {
  it("judges every story-theme pair the manifest gives, and writes the plan and results", async () => {
    const { repo, runDir, visuals } = await setup();
    const pass = await judgePass(input(repo, runDir, visuals));
    const pairs = manifest.stories.reduce((sum, story) => sum + story.judge.length, 0);
    expect(pass.summary.stories).toEqual({ pass: pairs, fail: 0, unsure: 0, notJudged: 0 });
    expect(pass.summary.calls).toBe(17);
    expect(pass.summary.results).toBe("judge.json");
    const written = JSON.parse(await readFile(path.join(runDir, "judge.json"), "utf8")) as JudgeResults;
    expect(written.judgeVersion).toBe(1);
    expect(written.components[0]?.plan.calls).toHaveLength(17);
  });

  it("puts each fail's findings in the summary, with its question, story and theme", async () => {
    const { repo, runDir, visuals } = await setup();
    const story = "button--label--variant-ghost--size-md--default";
    const pass = await judgePass(input(repo, runDir, visuals, { client: client(new Set([story])) }));
    expect(pass.summary.stories.fail).toBe(2);
    expect(pass.summary.findings?.[0]).toEqual({
      question: "story",
      story,
      theme: "light",
      verdict: "fail",
      severity: "medium",
      message: `${story} looks off`,
    });
  });

  it("asks change-<story> with the baseline and diff for a changed story", async () => {
    const { repo, runDir, visuals } = await setup();
    const story = "button--label--variant-primary--size-sm--default";
    const where = baselinePath("light", "button", story);
    await mkdir(path.dirname(path.join(repo, "baselines", where)), { recursive: true });
    await writeFile(path.join(repo, "baselines", where), png);
    await writeFile(path.join(runDir, "diff.png"), png);
    const changed = visuals.map((visual) =>
      visual.story === story && visual.theme === "light"
        ? { ...visual, status: "changed" as const, diff: "diff.png" }
        : visual,
    );
    const fake = client();
    await judgePass(input(repo, runDir, changed, { client: fake }));
    expect(fake.labels).toContainEqual(["baseline", "capture", "diff"]);
  });

  it("asks family with the default stories of other components that have baselines", async () => {
    const { repo, runDir, visuals } = await setup();
    const stories = manifest.stories.map((entry) => ({ ...entry, name: entry.name.replace(/^button--/, "other--") }));
    const other = {
      name: "other",
      spec: { ...spec, name: "Other" },
      manifest: { ...manifest, component: "Other", stories },
    };
    // The default story: the axes grid's at every axis's default (variant primary, size md).
    const story = stories[1]?.name ?? "";
    await mkdir(path.join(repo, "baselines", "light", "other"), { recursive: true });
    await writeFile(path.join(repo, "baselines", baselinePath("light", "other", story)), png);
    const fake = client();
    await judgePass(
      input(repo, runDir, visuals, { client: fake, library: [{ name: "button", spec, manifest }, other] }),
    );
    expect(fake.labels.some((labels) => labels.length === 2 && labels[1] === story)).toBe(true);
  });

  it("in CI, judges only the stories it's told the judge sees", async () => {
    const { repo, runDir, visuals } = await setup();
    const seen = new Set(["button--label--variant-primary--size-md--hover"]);
    const pass = await judgePass(input(repo, runDir, visuals, { seen }));
    expect(pass.summary.calls).toBe(2);
    expect(pass.stories.map((story) => story.story)).toContain("button--label--variant-primary--size-md--hover");
  });
});

describe("judgeCalibrated", () => {
  it("is true only for a record of this judge version and model that says calibrated", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fazon-calibration-"));
    expect(await judgeCalibrated("claude-sonnet-5-5", directory)).toBe(false);
    await mkdir(path.join(directory, "judge-1"));
    const write = (record: object) =>
      writeFile(path.join(directory, "judge-1", "claude-sonnet-5-5.json"), JSON.stringify(record));
    await write({ judge: 1, model: "claude-sonnet-5-5", calibrated: false });
    expect(await judgeCalibrated("claude-sonnet-5-5", directory)).toBe(false);
    await write({ judge: 1, model: "claude-sonnet-5-5", calibrated: true });
    expect(await judgeCalibrated("claude-sonnet-5-5", directory)).toBe(true);
    expect(await judgeCalibrated("claude-opus-5-5", directory)).toBe(false);
  });
});
