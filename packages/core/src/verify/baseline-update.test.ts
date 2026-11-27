// SPDX-License-Identifier: GPL-3.0-or-later
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baselinePath, decodePng, formatBaselinesRecord, listBaselineFiles } from "../checks/visual.js";
import { resolveConfig } from "../config/load.js";
import type { Config } from "../config/types.js";
import { updateBaselines } from "./baseline-update.js";
import type { VerifyComponent } from "./components.js";
import { componentInputsHash, writeVerifyDetails, type VerifyDetails } from "./details.js";
import type { StoryVisual } from "./rendered.js";
import { runDirectory, writeRunRecord, type RunRecord } from "./run-record.js";
import { docs, exampleButton, exampleRepository, image, otherImage, png, runningRecord } from "./test-support.js";

let root: string;
let button: VerifyComponent;
let config: Config;

beforeEach(async () => {
  root = await exampleRepository();
  button = await exampleButton();
  config = resolveConfig({ fazon: 0, adapter: "vue", image, judge: { policy: "off" } }).config;
  const lucide = path.join(root, "node_modules/lucide-static");
  await mkdir(lucide, { recursive: true });
  await writeFile(path.join(lucide, "package.json"), '{ "name": "lucide-static", "version": "1.2.3" }\n');
  await writeFile(path.join(lucide, "LICENSE"), "ISC License\n\nCopyright (c) Lucide Contributors\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const allPass = {
  build: "pass",
  lint: "pass",
  test: "pass",
  package: "pass",
  a11y: "pass",
  tokens: "pass",
  layout: "pass",
  visual: "fail",
} as const;

/** A finished verify run of the Button, with a capture of every story; `pixel` changes them all. */
async function verifyRun(
  id: string,
  options: {
    image?: string;
    checks?: VerifyDetails["components"][number]["checks"];
    inputs?: string;
    platform?: string;
    dot?: boolean;
  } = {},
): Promise<void> {
  const dir = runDirectory(root, id);
  await writeRunRecord(dir, {
    ...runningRecord(id, { status: "failed", ended: "2026-11-26T10:05:00Z" }),
    versions: { framework: "0.0.0", image: options.image ?? image },
  });
  const stories = (button.manifest?.stories ?? []).flatMap((story) =>
    ["light", "dark"].map((theme) => ({
      component: "button",
      story: story.name,
      theme,
      path: baselinePath(theme, "button", story.name),
      status: "new" as const,
    })),
  );
  for (const story of stories) {
    await mkdir(path.dirname(path.join(dir, "captures", story.path)), { recursive: true });
    await writeFile(
      path.join(dir, "captures", story.path),
      options.dot === true ? png(4, 4, { x: 0, y: 0, rgb: [0, 0, 0] }) : png(4, 4),
    );
  }
  await writeVerifyDetails(dir, {
    fazon: 0,
    platform: options.platform ?? "linux/amd64",
    components: [
      {
        name: "button",
        inputs: options.inputs ?? (await componentInputsHash(root, button, config.paths.tokens)),
        checks: options.checks ?? allPass,
      },
    ],
    stories,
    orphans: [],
    incomplete: [],
    unusedExemptions: [],
  });
}

const exampleRun = path.join(docs, "examples/records/run.json");

/** Every story of the Button in both themes, as `verify.json` lists them. */
function buttonStories(): StoryVisual[] {
  return (button.manifest?.stories ?? []).flatMap((story) =>
    ["light", "dark"].map((theme) => ({
      component: "button",
      story: story.name,
      theme,
      path: baselinePath(theme, "button", story.name),
      status: "new" as const,
    })),
  );
}

/**
 * A finished generate or feedback run of the Button from the spec's example record: iterations 1
 * and 2 fail, 3 passes. Each iteration's captures have a black pixel at x = n - 1, and its
 * `checks/<n>/verify.json` the hash of the component as it is now.
 */
async function agentRun(
  id: string,
  overrides: Partial<RunRecord> = {},
  options: { details?: boolean } = {},
): Promise<RunRecord> {
  const example = JSON.parse(await readFile(exampleRun, "utf8")) as RunRecord;
  const record: RunRecord = {
    ...example,
    id,
    versions: { ...example.versions, image },
    ...(overrides.kind === "feedback" ? { feedback: { text: "Round the corners." } } : {}),
    ...overrides,
  };
  const dir = runDirectory(root, id);
  await writeRunRecord(dir, record);
  const stories = buttonStories();
  for (const iteration of record.iterations) {
    for (const story of stories) {
      const file = path.join(dir, "captures", String(iteration.n), story.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, png(4, 4, { x: iteration.n - 1, y: 0, rgb: [0, 0, 0] }));
    }
    if (options.details === false) continue;
    await mkdir(path.join(dir, "checks", String(iteration.n)), { recursive: true });
    await writeVerifyDetails(path.join(dir, "checks", String(iteration.n)), {
      fazon: 0,
      platform: "linux/amd64",
      components: [
        {
          name: "button",
          inputs: await componentInputsHash(root, button, config.paths.tokens),
          checks: iteration.outcome === "pass" ? allPass : { ...allPass, test: "fail" },
        },
      ],
      stories,
      orphans: [],
      incomplete: [],
      unusedExemptions: [],
    });
  }
  return record;
}

/** The pixels of a baseline the Button's story has now. */
async function baselinePixels(): Promise<ReturnType<typeof decodePng>> {
  const file = baselinePath("light", "button", button.manifest?.stories[0]?.name ?? "");
  return decodePng(new Uint8Array(await readFile(path.join(root, "baselines", file))));
}

const update = (targets: readonly string[] | "all", stories?: string[]) =>
  updateBaselines({ root, config, components: [button], targets, ...(stories === undefined ? {} : { stories }) });

describe("fazon baseline update", () => {
  it("writes every story's baseline from the latest run, fazon.json and NOTICE.md, and nothing the second time", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    const first = await update(["button"]);
    expect(first).toMatchObject({ kind: "done", image, unchanged: [], removed: [] });
    if (first.kind !== "done") return;
    expect(first.written).toHaveLength(54);
    const dir = path.join(root, "baselines");
    expect(await readFile(path.join(dir, "fazon.json"), "utf8")).toBe(formatBaselinesRecord(image));
    const notice = await readFile(path.join(dir, "NOTICE.md"), "utf8");
    expect(notice).toContain("version 1.2.3");
    expect(notice).toContain("Copyright (c) Lucide Contributors");
    expect(decodePng(new Uint8Array(await readFile(path.join(dir, first.written[0] ?? ""))))).toEqual(
      decodePng(png(4, 4)),
    );

    const second = await update(["button"]);
    expect(second).toMatchObject({ kind: "done", written: [], removed: [] });
    expect(second.kind === "done" ? second.unchanged : []).toHaveLength(54);
  });

  it("takes the latest run, writes only the stories --story names, and keeps orphans then", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await update(["button"]);
    await writeFile(path.join(root, "baselines/light/button/old--default.png"), png(2, 2));
    await verifyRun("20261126T110000Z-verify-bbbb", { dot: true });
    const story = "button--label--variant-primary--size-md--hover";
    const result = await update(["button"], [story]);
    expect(result).toMatchObject({
      kind: "done",
      written: [
        "dark/button/label--variant-primary--size-md--hover.png",
        "light/button/label--variant-primary--size-md--hover.png",
      ],
      removed: [],
    });
    expect(await listBaselineFiles(path.join(root, "baselines"))).toContain("light/button/old--default.png");
  });

  it("removes the component's orphans, and with --all every file that isn't a baseline", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await mkdir(path.join(root, "baselines/light/button"), { recursive: true });
    await mkdir(path.join(root, "baselines/light/gone"), { recursive: true });
    await writeFile(path.join(root, "baselines/light/button/old--default.png"), png(2, 2));
    await writeFile(path.join(root, "baselines/light/gone/x--default.png"), png(2, 2));
    expect(await update(["button"])).toMatchObject({ removed: ["light/button/old--default.png"] });
    expect(await update("all")).toMatchObject({ removed: ["light/gone/x--default.png"] });
    await expect(access(path.join(root, "baselines/light/gone"))).rejects.toThrow();
  });

  it("refuses, saying which condition failed, and writes nothing", async () => {
    expect(await update(["button"])).toMatchObject({
      kind: "refused",
      qualifications: [{ failed: [expect.stringContaining("has no finished run") as string] }],
    });

    await verifyRun("20261126T100000Z-verify-aaaa", { checks: { ...allPass, tokens: "fail", test: "error" } });
    const failing = await update(["button"]);
    expect(failing.kind === "refused" ? failing.qualifications[0]?.failed : []).toEqual([
      expect.stringContaining(
        "didn't pass every check other than visual: test ended in error, tokens failed",
      ) as string,
    ]);

    await verifyRun("20261126T110000Z-verify-bbbb", { inputs: "sha256:" + "0".repeat(64) });
    expect(JSON.stringify(await update(["button"]))).toContain("changed since the run");

    await verifyRun("20261126T120000Z-verify-cccc", { image: otherImage, platform: "linux/arm64" });
    const elsewhere = JSON.stringify(await update(["button"]));
    expect(elsewhere).toContain("not in the image fazon.yaml pins");
    expect(elsewhere).toContain("baselines are made on linux/amd64 only");
    expect(await listBaselineFiles(path.join(root, "baselines"))).toEqual([]);
  });

  it("records another image only with --all", async () => {
    await mkdir(path.join(root, "baselines"), { recursive: true });
    await writeFile(path.join(root, "baselines/fazon.json"), formatBaselinesRecord(otherImage));
    await verifyRun("20261126T100000Z-verify-aaaa");
    expect(JSON.stringify(await update(["button"]))).toContain(
      "only `fazon baseline update --all` records another image",
    );
    expect(await update("all")).toMatchObject({ kind: "done" });
    expect(await readFile(path.join(root, "baselines/fazon.json"), "utf8")).toBe(formatBaselinesRecord(image));
  });

  it("writes no NOTICE.md for an icon set of the repository's own, and removes one", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await update(["button"]);
    config = { ...config, icons: { path: "icons" } };
    await update(["button"]);
    await expect(access(path.join(root, "baselines/NOTICE.md"))).rejects.toThrow();
  });
});

describe("fazon baseline update from a generate or feedback run", () => {
  const generateId = "20261126T110000Z-button-0a0a";
  const feedbackId = "20261126T120000Z-button-0b0b";

  it("writes the captures of a passed generate run's passing iteration, newer than a verify run", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await agentRun(generateId);
    const result = await update(["button"]);
    expect(result).toMatchObject({
      kind: "done",
      qualifications: [{ component: "button", run: generateId, iteration: 3, failed: [] }],
    });
    expect(result.kind === "done" ? result.written : []).toHaveLength(54);
    expect(await baselinePixels()).toEqual(decodePng(png(4, 4, { x: 2, y: 0, rgb: [0, 0, 0] })));
  });

  it("takes a feedback run, and passes over propose runs and agent runs of other components", async () => {
    await agentRun(generateId, { status: "needs-a-person", reason: "iterations" });
    await agentRun(feedbackId, { kind: "feedback", parent: generateId });
    await agentRun("20261126T130000Z-button-0c0c", { kind: "propose", status: "needs-a-person", reason: "iterations" });
    await agentRun("20261126T140000Z-badge-0d0d", {
      component: "Badge",
      status: "needs-a-person",
      reason: "iterations",
    });
    expect(await update(["button"])).toMatchObject({
      kind: "done",
      qualifications: [{ run: feedbackId, iteration: 3, failed: [] }],
    });
  });

  it("refuses when the latest run is an agent run that didn't pass, though an earlier one passed", async () => {
    await agentRun(generateId);
    await agentRun(feedbackId, { kind: "feedback", parent: generateId, status: "needs-a-person", reason: "budget" });
    const result = await update(["button"]);
    expect(result).toMatchObject({ kind: "refused", qualifications: [{ run: feedbackId }] });
    expect(result.qualifications[0]?.failed).toEqual([
      `Button's latest run ${feedbackId}: it didn't pass: it needs a person (budget). A feedback run gives baselines only when it passed. Read its report, then run \`fazon feedback button\` or \`fazon generate button\`, or \`fazon verify button\` once the component is as it should be.`,
    ]);

    await agentRun("20261126T130000Z-button-0c0c", { status: "stopped" });
    expect(JSON.stringify(await update(["button"]))).toContain("it didn't pass: it was interrupted.");
    expect(await listBaselineFiles(path.join(root, "baselines"))).toEqual([]);
    // A verify run made after it qualifies.
    await verifyRun("20261126T140000Z-verify-aaaa");
    expect(await update(["button"])).toMatchObject({ kind: "done" });
  });

  it("refuses a passed run whose passing iteration left no verify.json", async () => {
    await agentRun(generateId, {}, { details: false });
    const result = await update(["button"]);
    expect(result.qualifications[0]?.failed).toEqual([
      `Button's latest run ${generateId} (iteration 3): it passed, but has no checks of button to take baselines from (checks/3/verify.json); run \`fazon verify button\`.`,
    ]);
  });

  it("applies the conditions to the passing iteration's checks", async () => {
    await agentRun(generateId);
    await writeFile(path.join(root, "src/components/button/Button.vue"), "<template><a /></template>\n");
    expect(JSON.stringify(await update(["button"]))).toContain(
      `Button's latest run ${generateId} (iteration 3): its spec, its files or the token set changed since the run`,
    );
  });

  it("writes baselines after the run was accepted or the API approved again, which write only the provenance file", async () => {
    await agentRun(generateId);
    const generated = path.join(root, "src/components/button/generated");
    await mkdir(generated, { recursive: true });
    await writeFile(path.join(generated, "provenance.json"), '{ "accepted": true }\n');
    expect(await update(["button"])).toMatchObject({ kind: "done", qualifications: [{ failed: [] }] });
    await writeFile(path.join(generated, "provenance.json"), '{ "approved": "again" }\n');
    expect(await update(["button"])).toMatchObject({ kind: "done" });
  });
});

describe("componentInputsHash", () => {
  it("leaves out the provenance file, and covers every other file in the component's directory", async () => {
    const before = await componentInputsHash(root, button, config.paths.tokens);
    const generated = path.join(root, "src/components/button/generated");
    await mkdir(generated, { recursive: true });
    await writeFile(path.join(generated, "provenance.json"), "{}\n");
    expect(await componentInputsHash(root, button, config.paths.tokens)).toBe(before);
    await writeFile(path.join(generated, "stories.json"), "{}\n");
    expect(await componentInputsHash(root, button, config.paths.tokens)).not.toBe(before);
  });
});
