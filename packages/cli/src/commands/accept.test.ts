// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon accept` on fixture run records and provenance files: no agent runs.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  componentInputsHash,
  encodePng,
  hashApi,
  hashText,
  parseSpecFile,
  provenanceProblems,
  runDirectory,
  runLockFile,
  writeRunRecord,
  writeVerifyDetails,
  type Provenance,
  type RunInputs,
  type RunRecord,
  type StoryVisual,
} from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accept } from "./accept.js";
import {
  capture,
  captureJson,
  copyExample,
  fakeEnvironment,
  image,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

const exampleRun = fileURLToPath(new URL("../../../../docs/spec/examples/records/run.json", import.meta.url));

const provenanceFile = "src/components/button/generated/provenance.json";
const generateId = "20261126T100000Z-button-0a0a";
const feedbackId = "20261126T110000Z-button-0b0b";

let root: string;
let machine: FakeMachine;
let example: RunRecord;

const read = (file: string) => readFile(path.join(root, file), "utf8");
const write = async (file: string, text: string) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};

/** The hashes a run of the button starts from now: the spec, its API and the config. */
async function inputsNow(): Promise<RunInputs> {
  const text = await read("specs/button.md");
  const spec = parseSpecFile("specs/button.md", text).spec;
  if (spec === undefined) throw new Error("the example doesn't parse");
  return { spec: hashText(text), api: hashApi(spec), config: hashText(await read("fazon.yaml")) };
}

/** The hash the checks of an iteration record for the button: its spec, its directory's files and the token set. */
async function checkedHash(): Promise<string> {
  const text = await read("specs/button.md");
  const spec = parseSpecFile("specs/button.md", text).spec;
  if (spec === undefined) throw new Error("the example doesn't parse");
  return componentInputsHash(
    root,
    { name: "button", spec, specFile: "specs/button.md", directory: "src/components/button", generated: true },
    "tokens/tokens.resolver.json",
  );
}

const newStories: StoryVisual[] = [
  { component: "button", story: "button--a", theme: "light", path: "light/button/a.png", status: "new" },
  { component: "button", story: "button--b", theme: "light", path: "light/button/b.png", status: "changed" },
  { component: "button", story: "button--c", theme: "light", path: "light/button/c.png", status: "unchanged" },
  { component: "badge", story: "badge--a", theme: "light", path: "light/badge/a.png", status: "new" },
];

/** Writes a generate or feedback run of the button from the spec's example record, with its last iteration's verify.json. */
async function writeRun(
  id: string,
  overrides: Partial<RunRecord> = {},
  stories: StoryVisual[] = newStories,
): Promise<RunRecord> {
  const feedback = overrides.kind === "feedback" ? { feedback: { text: "Round the corners." } } : {};
  const record: RunRecord = { ...example, id, inputs: await inputsNow(), ...feedback, ...overrides };
  const dir = runDirectory(root, id);
  await writeRunRecord(dir, record);
  const last = record.iterations.at(-1);
  if (last !== undefined) {
    const checks = path.join(dir, "checks", String(last.n));
    await mkdir(checks, { recursive: true });
    await writeVerifyDetails(checks, {
      fazon: 0,
      platform: "linux/amd64",
      components: [{ name: "button", inputs: await checkedHash(), checks: {} }],
      stories,
      orphans: [{ path: "dark/button/gone.png" }, { path: "dark/badge/gone.png" }],
      incomplete: [],
      unusedExemptions: [],
    });
  }
  return record;
}

const messagesOf = (json: Record<string, unknown>) => json.messages as { level: string; text: string; hint?: string }[];

beforeEach(async () => {
  example = JSON.parse(await readFile(exampleRun, "utf8")) as RunRecord;
  root = await repository({ "fazon.yaml": minimalConfig, "src/components/button/Button.vue": "<template />\n" });
  await copyExample(root, "valid/button.md", "specs/button.md");
  machine = { cwd: root };
  expect((await captureJson(["approve", "button"], machine)).code).toBe(0);
});
afterEach(() => removeRepository(root));

describe("fazon accept", () => {
  it("writes the generation part of the provenance file from a passed run, and prints the baseline update", async () => {
    const approved = JSON.parse(await read(provenanceFile)) as Provenance;
    await writeRun(generateId);
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(0);

    const provenance = JSON.parse(await read(provenanceFile)) as Provenance;
    expect(provenanceProblems(provenance)).toEqual([]);
    expect(provenance.api).toEqual(approved.api);
    expect(provenance.spec).toEqual({ path: "specs/button.md", hash: hashText(await read("specs/button.md")) });
    const runs = [
      {
        id: generateId,
        kind: "generate",
        status: "passed",
        iterations: 3,
        models: ["claude-sonnet-5-5", "claude-opus-5-5"],
        costUsd: 4.2,
      },
    ];
    expect(provenance.generation).toEqual({
      framework: expect.any(String) as unknown,
      accepted: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
      runs,
      handEdits: 0,
      costUsd: 4.2,
      costEstimated: false,
    });

    const accepted = provenance.generation?.accepted ?? "";
    expect(json).toMatchObject({
      command: "accept",
      status: "ok",
      result: {
        component: "Button",
        run: generateId,
        kind: "generate",
        status: "passed",
        record: `.fazon/runs/${generateId}/run.json`,
        provenance: provenanceFile,
        accepted,
        runs,
        handEdits: 0,
        costUsd: 4.2,
        stories: { new: ["light/button/a.png"], changed: ["light/button/b.png"], orphans: ["dark/button/gone.png"] },
        baselineUpdate: "fazon baseline update button",
      },
    });
    expect(json.result).not.toHaveProperty("alreadyAccepted");
    expect(messagesOf(json)).toEqual([
      {
        level: "info",
        text: `Accepted Button's run ${generateId} on ${accepted}, in ${provenanceFile}: 1 run, 0 hand edits, $4.20.`,
      },
      {
        level: "info",
        text: "Its stories differ from the baselines: 1 new story, 1 changed story, 1 orphaned baseline. Run fazon baseline update button, then commit the baselines and the provenance file with the component.",
        hint: "fazon baseline update button",
      },
    ]);
  });

  it("dates the acceptance with the clock, and counts a feedback run's linked runs and hand edits", async () => {
    await writeRun(generateId, { status: "needs-a-person", reason: "iterations" });
    await writeRun(feedbackId, {
      kind: "feedback",
      parent: generateId,
      handEdits: [{ after: 1, files: ["src/components/button/Button.vue"] }],
      totals: { ...example.totals, costUsd: 1.5, costEstimated: true },
    });
    const context = { environment: fakeEnvironment(machine), global: { json: true, verbose: false, color: false } };
    const outcome = await accept(
      { positionals: ["button"], options: {} },
      context,
      () => new Date("2026-11-27T23:30:00Z"),
    );
    expect(outcome.status).toBe("ok");
    const provenance = JSON.parse(await read(provenanceFile)) as Provenance;
    expect(provenance.generation).toMatchObject({
      accepted: "2026-11-27",
      runs: [
        { id: generateId, kind: "generate", status: "needs-a-person" },
        { id: feedbackId, kind: "feedback", status: "passed" },
      ],
      handEdits: 1,
      costUsd: 5.7,
      costEstimated: true,
    });
    expect(outcome.result).toMatchObject({ run: feedbackId, kind: "feedback", costUsd: 5.7, costEstimated: true });
    expect(outcome.messages[0]?.text).toContain(": 2 runs, 1 hand edit, $5.70 (estimated).");
  });

  it("prints no baseline update when the stories match the baselines", async () => {
    await writeRun(
      generateId,
      {},
      newStories.filter((story) => story.status === "unchanged" || story.component !== "button"),
    );
    await removeOrphans(generateId);
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(0);
    expect(json.result).not.toHaveProperty("baselineUpdate");
    expect(messagesOf(json)[1]).toEqual({
      level: "info",
      text: "Its stories match the baselines. Commit the provenance file with the component.",
    });
  });

  it("says when the run was accepted already, and doesn't write the provenance file again", async () => {
    await writeRun(generateId);
    expect((await captureJson(["accept", "button"], machine)).code).toBe(0);
    const first = await read(provenanceFile);
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(0);
    expect(await read(provenanceFile)).toBe(first);
    expect(json.result).toMatchObject({ run: generateId, alreadyAccepted: true });
    expect(messagesOf(json)[0]?.text).toMatch(new RegExp(`^Button's run ${generateId} was accepted already, on `));
  });

  it("compares a run accepted already with its checks too: the provenance file isn't in their hash", async () => {
    await writeRun(generateId);
    expect((await captureJson(["accept", "button"], machine)).code).toBe(0);
    expect((await captureJson(["approve", "button"], machine)).code).toBe(0);
    expect((await captureJson(["accept", "button"], machine)).json.result).toMatchObject({ alreadyAccepted: true });
    await write("src/components/button/Button.vue", "<template><button /></template>\n");
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]?.text).toContain(`Files in src/components/button/ changed since the run ${generateId}`);
  });

  it("is followed by baseline update, which writes the accepted run's captures", async () => {
    const record = await writeRun(generateId, { versions: { ...example.versions, image } });
    const captures = path.join(runDirectory(root, generateId), record.iterations.at(-1)?.verification?.captures ?? "");
    for (const story of newStories.filter((s) => s.component === "button")) {
      await mkdir(path.dirname(path.join(captures, story.path)), { recursive: true });
      await writeFile(path.join(captures, story.path), encodePng({ width: 1, height: 1, data: new Uint8Array(4) }));
    }
    await write("node_modules/lucide-static/package.json", '{ "name": "lucide-static", "version": "1.2.3" }\n');
    await write("node_modules/lucide-static/LICENSE", "ISC License\n");
    expect((await captureJson(["accept", "button"], machine)).code).toBe(0);
    const { code, json } = await captureJson(["baseline", "update", "button"], machine);
    expect(code).toBe(0);
    expect(json.result).toMatchObject({
      image,
      runs: [{ component: "button", run: generateId, iteration: 3 }],
      written: ["light/button/a.png", "light/button/b.png", "light/button/c.png"],
    });
  });

  it("refuses (2) a run that needs a person or was interrupted, and writes nothing", async () => {
    const before = await read(provenanceFile);
    await writeRun(generateId, { status: "needs-a-person", reason: "budget" });
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)).toEqual([
      {
        level: "error",
        text: `Button's latest run, ${generateId}, didn't pass: it needs a person (budget). Only a run that passed can be accepted. Read its report, then run fazon feedback or fazon generate again.`,
        hint: "fazon report button",
      },
    ]);
    await writeRun(feedbackId, { kind: "feedback", parent: generateId, status: "stopped" });
    const stopped = await captureJson(["accept", "button"], machine);
    expect(stopped.code).toBe(2);
    expect(messagesOf(stopped.json)[0]?.text).toContain("didn't pass: it was interrupted.");
    expect(await read(provenanceFile)).toBe(before);
  });

  it("refuses (2) the latest run even when an earlier one passed", async () => {
    await writeRun(generateId);
    await writeRun("20261126T120000Z-button-0c0c", { status: "needs-a-person", reason: "iterations" });
    expect((await captureJson(["accept", "button"], machine)).code).toBe(2);
  });

  it("passes over propose runs and runs of other components", async () => {
    await writeRun(generateId);
    await writeRunRecord(runDirectory(root, "20261126T120000Z-button-0c0c"), {
      ...example,
      id: "20261126T120000Z-button-0c0c",
      kind: "propose",
      status: "needs-a-person",
      reason: "iterations",
    });
    await writeRunRecord(runDirectory(root, "20261126T130000Z-badge-0d0d"), {
      ...example,
      id: "20261126T130000Z-badge-0d0d",
      component: "Badge",
      status: "needs-a-person",
      reason: "iterations",
    });
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(0);
    expect(json.result).toMatchObject({ run: generateId });
  });

  it("refuses (2) after the spec changed since the run", async () => {
    await writeRun(generateId);
    const text = await read("specs/button.md");
    await write("specs/button.md", text.replace("## Purpose\n", "## Purpose\n\nChanged.\n"));
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)).toEqual([
      {
        level: "error",
        text: `specs/button.md changed since the run ${generateId} started from it. A run has to check the spec as it is: generate again.`,
        hint: "fazon generate button",
      },
    ]);
  });

  it("refuses (2) after the spec's API changed, pointing to approve", async () => {
    await writeRun(generateId);
    const text = await read("specs/button.md");
    await write("specs/button.md", text.replace("values: [button, submit, reset]", "values: [button, submit]"));
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]).toMatchObject({ hint: "fazon approve button" });
    expect(messagesOf(json)[0]?.text).toContain("its API isn't the approved one either");
  });

  it("refuses (2) when another API was approved since the run", async () => {
    await writeRun(generateId);
    const provenance = JSON.parse(await read(provenanceFile)) as Provenance;
    const other = "sha256:" + "1".repeat(64);
    await write(provenanceFile, JSON.stringify({ ...provenance, api: { hash: other, approved: "2026-11-27" } }));
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]?.text).toBe(
      `The approved API changed since the run ${generateId}: it started from ${provenance.api.hash}, and ${provenanceFile} approves ${other} (approved 2026-11-27). Generate again from the approved API.`,
    );
  });

  it("refuses (2) after a component file changed since the run's checks", async () => {
    await writeRun(generateId);
    await write("src/components/button/Button.vue", "<template><button /></template>\n");
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)).toEqual([
      {
        level: "error",
        text: `Files in src/components/button/ changed since the run ${generateId} checked them (iteration 3). A run has to check the component as it is before it's accepted: undo the changes, or have a run check them.`,
        hint: "fazon generate button",
      },
    ]);
  });

  it("refuses (2) a run whose last checks wrote no verify.json", async () => {
    await writeRunRecord(runDirectory(root, generateId), { ...example, id: generateId, inputs: await inputsNow() });
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]?.text).toContain("has no checks/3/verify.json for button");
  });

  it("warns when the config changed since the run, and accepts it", async () => {
    await writeRun(generateId);
    await write("fazon.yaml", `${minimalConfig}# a comment\n`);
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(0);
    expect(messagesOf(json)[0]).toEqual({
      level: "warning",
      text: `fazon.yaml changed since the run ${generateId}; the result is accepted as that run made it.`,
    });
  });

  it("refuses (2) when the component has no generate or feedback run", async () => {
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)).toEqual([
      {
        level: "error",
        text: "Button has no generate or feedback run in .fazon/runs/ to accept. Generate it first.",
        hint: "fazon generate button",
      },
    ]);
  });

  it("refuses (2) while a run of the component is in progress, but not for a stale lock", async () => {
    await writeRun(generateId);
    const lock = { run: "20261126T120000Z-button-0c0c", pid: process.pid, started: "2026-11-26T12:00:00.000Z" };
    await write(path.relative(root, runLockFile(root, "button")), JSON.stringify(lock));
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)).toEqual([
      {
        level: "error",
        text: `Button has a run in progress: ${lock.run}, started ${lock.started} by process ${String(process.pid)}. Wait for it to end, then accept its result.`,
        hint: "fazon runs",
      },
    ]);
    await write(path.relative(root, runLockFile(root, "button")), "not JSON");
    expect((await captureJson(["accept", "button"], machine)).code).toBe(0);
  });

  it("refuses (2) a run recorded as running with no lock: a run that crashed", async () => {
    await writeRun(generateId, { status: "running" });
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]?.text).toContain("it's still recorded as running");
  });

  it("refuses (2) a feedback run whose parent's record is missing", async () => {
    await writeRun(feedbackId, { kind: "feedback", parent: generateId });
    const { code, json } = await captureJson(["accept", "button"], machine);
    expect(code).toBe(2);
    expect(messagesOf(json)[0]?.text).toContain(`The run record of ${generateId} is missing`);
  });

  it("refuses (2) a provenance file that isn't valid, or is missing", async () => {
    await writeRun(generateId);
    await write(provenanceFile, "{}");
    const invalid = await captureJson(["accept", "button"], machine);
    expect(invalid.code).toBe(2);
    expect(messagesOf(invalid.json)[0]).toMatchObject({ hint: `git checkout -- ${provenanceFile}` });
    expect(await read(provenanceFile)).toBe("{}");
    await rm(path.join(root, provenanceFile));
    const missing = await captureJson(["accept", "button"], machine);
    expect(missing.code).toBe(2);
    expect(messagesOf(missing.json)[0]).toMatchObject({ hint: "fazon approve button" });
  });

  it("prints the acceptance in text mode", async () => {
    await writeRun(generateId);
    const { code, stdout, stderr } = await capture(["accept", "button"], machine);
    expect(code).toBe(0);
    expect(`${stdout}${stderr}`).toContain(`Accepted Button's run ${generateId}`);
    expect(`${stdout}${stderr}`).toContain("fazon baseline update button");
  });
});

/** Rewrites a run's verify.json without orphans. */
async function removeOrphans(id: string): Promise<void> {
  const file = path.join(runDirectory(root, id), "checks/3/verify.json");
  const details = JSON.parse(await readFile(file, "utf8")) as { orphans: unknown[] };
  await writeFile(file, JSON.stringify({ ...details, orphans: [] }));
}
