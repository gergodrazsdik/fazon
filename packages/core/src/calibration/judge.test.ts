// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's judge with a fake batch client: the batches and their costs, the stages
// within the budget, the case calls that show an affected story, and the measures with their
// Wilson intervals.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { baselinePath } from "../checks/visual.js";
import { judgeInBatches, type BatchClient } from "../judge/batch.js";
import type { JudgePassComponent } from "../judge/pass.js";
import type { JudgeCall } from "../judge/plan.js";
import { buildManifest } from "../matrix/build.js";
import { parseSpecFile } from "../spec/load.js";
import { judgeRound, type RoundCall } from "./judge.js";
import { calibrationRecord, roundMeasures, thresholds, wilson } from "./measures.js";
import { validateWithSchema } from "../validation/validate.js";
import type { CalibrationRenders, RenderedCase } from "./renders.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const text = readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8");
const file = parseSpecFile("specs/button.md", text);
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const manifest = buildManifest(file.spec, { file: file.file, themes: ["light", "dark"] });
const button: JudgePassComponent = {
  name: "button",
  spec: file.spec,
  specFile: "specs/button.md",
  specText: text,
  body: file.body,
  manifest,
};
const price = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };
const hover = "button--label--variant-primary--size-md--hover";

/** Answers every label with the verdict `verdict` gives it; records each batch's requests. */
function fakeBatches(
  verdict: (label: string, repeat: number) => string = () => "pass",
): BatchClient & { batches: number; requests: number } {
  const stored = new Map<string, { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]>();
  const client = {
    batches: 0,
    requests: 0,
    submit: (requests: readonly { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]) => {
      client.batches += 1;
      client.requests += requests.length;
      const id = `batch-${String(client.batches)}`;
      stored.set(id, [...requests]);
      return Promise.resolve(id);
    },
    wait: () => Promise.resolve(),
    results: async function* (id: string) {
      for (const request of stored.get(id) ?? []) {
        const repeat = Number(request.custom_id.split("~")[1]);
        const content = request.params.messages[0]?.content;
        const blocks = Array.isArray(content) ? content : [];
        const labels = blocks.flatMap((block) =>
          block.type === "text" ? [...block.text.matchAll(/^Image \d+, label `([^`]+)`/g)].map((m) => m[1] ?? "") : [],
        );
        const results = labels.map((story) => ({ story, verdict: verdict(story, repeat), findings: [] }));
        const message = {
          content: [{ type: "text", text: JSON.stringify({ question: "q", results }) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Message;
        await Promise.resolve();
        yield { custom_id: request.custom_id, result: { type: "succeeded" as const, message } };
      }
    },
  };
  return client;
}

const png = (() => {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(128);
  return PNG.sync.write(image);
})();

describe("wilson", () => {
  it("gives the 95% score interval, and [0, 1] without trials", () => {
    expect(wilson(8, 10)).toEqual([0.49, 0.943]);
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(wilson(0, 40)[0]).toBe(0);
  });
});

describe("judgeInBatches", () => {
  const call: JudgeCall = {
    question: "story",
    source: "derived",
    kind: "each",
    text: "?",
    theme: "light",
    images: [{ kind: "capture", label: "a", story: "a" }],
  };
  it("makes one request per repeat, costs it at half the price, and keys the attempts", async () => {
    const client = fakeBatches();
    const attempts = await judgeInBatches({
      entries: [{ key: "k", call, spec: { file: "s.md", text: "spec" }, images: [png] }],
      repeats: 5,
      model: "claude-sonnet-5-5",
      price,
      client,
    });
    expect(client.requests).toBe(5);
    expect(attempts.get("k")).toHaveLength(5);
    // (1000 × 2 + 100 × 10) / 1e6, halved.
    expect(attempts.get("k")?.[0]?.costUsd).toBeCloseTo(0.0015, 10);
  });
});

describe("judgeRound", () => {
  let roundDir: string;
  let repo: string;
  const entry: RenderedCase = {
    id: "state-indistinct--hover",
    operator: "state-indistinct",
    class: "viewer-only",
    description: "",
    affected: [{ story: hover, themes: ["light"] }],
    flagged: [],
    checks: { withoutBaselines: true, withBaselines: true, rules: ["tokens/token-rule"] },
  };
  const renders: CalibrationRenders = {
    fazon: 0,
    components: [{ name: "button", unmodifiedFindings: [], cases: [entry], unchanged: [] }],
  };

  beforeAll(async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), "fazon-round-"));
    roundDir = path.join(repo, "calibration");
    for (const story of manifest.stories) {
      for (const theme of manifest.themes) {
        const where = path.join(roundDir, "unmodified", baselinePath(theme, "button", story.name));
        await mkdir(path.dirname(where), { recursive: true });
        await writeFile(where, png);
      }
    }
    const changed = path.join(roundDir, "cases", "button", entry.id, baselinePath("light", "button", hover));
    await mkdir(path.dirname(changed), { recursive: true });
    await writeFile(changed, png);
  });

  const input = (client: BatchClient, budgetUsd: number) => ({
    repo,
    roundDir,
    baselines: "baselines",
    components: [button],
    library: [{ name: "button", spec: button.spec, manifest }],
    renders,
    model: "claude-sonnet-5-5",
    repeats: 5,
    price,
    budgetUsd,
    client,
  });

  it("judges the unmodified plan, then only the case's calls that show its affected story", async () => {
    const client = fakeBatches((label) => (label === hover ? "fail" : "pass"));
    const outcome = await judgeRound(input(client, 100));
    expect(outcome.kind).toBe("done");
    const cases = outcome.calls.filter((call) => call.case !== undefined);
    // The hover story in light: the story batch it's in, its state question and none in dark.
    expect(cases.map((c) => `${c.call.question} ${c.call.theme}`)).toEqual(["story light", "state-hover light"]);
    expect(client.requests).toBe((17 + 2) * 5);
  });

  it("stops before the cases when their estimate doesn't fit what's left of the budget", async () => {
    const client = fakeBatches();
    const outcome = await judgeRound(input(client, 0.13));
    expect(outcome.kind).toBe("over-budget");
    if (outcome.kind !== "over-budget") return;
    expect(outcome.costUsd).toBeCloseTo(17 * 5 * 0.0015, 6);
    expect(outcome.estimateUsd).toBeCloseTo(2 * 5 * 0.0015, 6);
    expect(client.requests).toBe(17 * 5);
  });

  it("measures the round: catches, false positives, self-agreement, and whether it calibrates", async () => {
    // The hover story fails in the case's first repeat; the unmodified stories pass, but one
    // repeat in five says unsure about every image.
    const client = fakeBatches((label, repeat) => (repeat === 4 ? "unsure" : "pass"));
    const done = await judgeRound(input(client, 100));
    if (done.kind !== "done") throw new Error("over budget");
    const calls: RoundCall[] = done.calls.map((call) =>
      call.case === undefined
        ? call
        : {
            ...call,
            attempts: call.attempts.map((attempt, repeat) =>
              repeat !== 0
                ? attempt
                : {
                    ...attempt,
                    answer: {
                      question: call.call.question,
                      results: call.call.images.map((image) => ({
                        story: image.label,
                        verdict: image.story === hover ? "fail" : "pass",
                        findings: [],
                      })),
                    },
                  },
            ),
          },
    );
    const measures = roundMeasures(renders, calls, done.costUsd);
    const indistinct = measures.operators.find((operator) => operator.id === "state-indistinct");
    expect(indistinct).toEqual({
      id: "state-indistinct",
      class: "viewer-only",
      cases: 1,
      caught: 1,
      unsure: 0,
      checksCaught: { withBaselines: 1, withoutBaselines: 1 },
    });
    expect(measures.catchRate).toMatchObject({ value: 1, n: 1 });
    expect(measures.falsePositiveRate).toMatchObject({ value: 0, n: 37 });
    expect(measures.selfAgreement.value).toBeCloseTo(0.8, 2);
    // One case, under 40, and self-agreement under 90%: not calibrated.
    expect(measures.calibrated).toBe(false);
    const record = calibrationRecord({
      judge: 1,
      model: "claude-sonnet-5-5",
      framework: "0.0.0",
      round: 1,
      date: "2026-11-27",
      components: ["Button"],
      measures,
      records: "https://github.com/gergodrazsdik/fazon-vue-example/releases/download/measurement-1/records.tar.gz",
    });
    expect(validateWithSchema("calibration-record", record)).toEqual([]);
    expect(thresholds.minCases).toBe(40);
  });
});
