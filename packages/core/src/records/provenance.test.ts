// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptGeneration,
  apiApproved,
  approveApi,
  provenancePath,
  provenanceProblems,
  readProvenance,
  writeProvenance,
  type Provenance,
} from "./provenance.js";
import {
  linkedRuns,
  runDirectory,
  runRecordProblems,
  writeRunRecord,
  type IterationRecord,
  type RunRecord,
} from "./run-record.js";

const examples = fileURLToPath(new URL("../../../../docs/spec/examples/records/", import.meta.url));
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);

function iteration(n: number, model: string): IterationRecord {
  return {
    n,
    call: {
      model,
      started: "2026-11-26T10:00:00Z",
      durationSeconds: 60,
      end: "completed",
      tokens: { input: 10, output: 1 },
      costUsd: 1,
      transcript: `calls/${String(n)}.jsonl`,
    },
    outcome: "fail",
  };
}

function agentRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    fazon: 0,
    id,
    kind: "generate",
    component: "Button",
    status: "passed",
    started: "2026-11-26T10:00:00Z",
    ended: "2026-11-26T10:20:00Z",
    versions: { framework: "0.1.0", claudeCode: "2.1.332", image },
    config: {
      caps: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20 },
      models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
      escalateAfter: 2,
      judgePolicy: "advisory",
    },
    iterations: [iteration(1, "claude-sonnet-5-5")],
    handEdits: [],
    totals: { iterations: 1, agentCostUsd: 1, judgeCostUsd: 0, costUsd: 1, escalated: false },
    ...(overrides.kind === "feedback" ? { feedback: { text: "Round the corners." } } : {}),
    ...overrides,
  };
}

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("the provenance file", () => {
  it("lives in the component's generated directory, by its kebab-case name", () => {
    expect(provenancePath("src/components", "RadioGroup")).toBe("src/components/radio-group/generated/provenance.json");
  });

  it("is written whole, only when valid, and read back (RECORD-004)", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-provenance-"));
    const example = JSON.parse(await readFile(path.join(examples, "provenance.json"), "utf8")) as Provenance;
    expect(provenanceProblems(example)).toEqual([]);
    const file = path.join(root, provenancePath("src/components", "Button"));
    expect(await readProvenance(file)).toEqual({ kind: "missing" });
    await writeProvenance(file, example);
    expect(await readProvenance(file)).toEqual({ kind: "ok", provenance: example });
    expect(await readdir(path.dirname(file))).toEqual(["provenance.json"]);
    expect(await readFile(file, "utf8")).toBe(`${JSON.stringify(example, null, 2)}\n`);

    const invalid = { ...example, api: { hash: "md5:abc", approved: "2026-11-25" } };
    await expect(writeProvenance(file, invalid)).rejects.toThrow(/isn't valid/);
    expect(await readProvenance(file)).toEqual({ kind: "ok", provenance: example });
  });

  it("reports a file that isn't JSON or doesn't fit the schema", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-provenance-"));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "a.json"), "{");
    await writeFile(path.join(root, "b.json"), "{}\n");
    expect(await readProvenance(path.join(root, "a.json"))).toMatchObject({ kind: "invalid" });
    const read = await readProvenance(path.join(root, "b.json"));
    expect(read.kind).toBe("invalid");
    expect(read.kind === "invalid" ? read.problems.length : 0).toBeGreaterThan(0);
  });
});

describe("approving the API", () => {
  const approval = {
    component: "Button",
    specPath: "specs/button.md",
    specHash: hash("a"),
    apiHash: hash("b"),
    date: new Date("2026-11-26T23:30:00Z"),
  };

  it("records the API's hash and the UTC date, with no generation yet", () => {
    const provenance = approveApi(undefined, approval);
    expect(provenance).toEqual({
      fazon: 0,
      component: "Button",
      spec: { path: "specs/button.md", hash: hash("a") },
      api: { hash: hash("b"), approved: "2026-11-26" },
    });
    expect(provenanceProblems(provenance)).toEqual([]);
    expect(apiApproved(provenance, hash("b"))).toBe(true);
    expect(apiApproved(provenance, hash("c"))).toBe(false);
    expect(apiApproved(undefined, hash("b"))).toBe(false);
  });

  it("keeps the last accepted generation until the next accept replaces it", () => {
    const accepted = acceptGeneration(approveApi(undefined, approval), {
      framework: "0.1.0",
      date: new Date("2026-11-27T09:00:00Z"),
      runs: [agentRun("20261126T100000Z-button-3f9a")],
      specHash: hash("a"),
    });
    const again = approveApi(accepted, { ...approval, apiHash: hash("c"), date: new Date("2026-11-28T09:00:00Z") });
    expect(again.api).toEqual({ hash: hash("c"), approved: "2026-11-28" });
    expect(again.generation).toEqual(accepted.generation);
  });
});

describe("accepting a result", () => {
  const approved = approveApi(undefined, {
    component: "Button",
    specPath: "specs/button.md",
    specHash: hash("a"),
    apiHash: hash("b"),
    date: new Date("2026-11-26T09:00:00Z"),
  });

  it("records the accepted run and the runs linked to it, from their records", () => {
    const generate = agentRun("20261126T100000Z-button-3f9a", {
      status: "needs-a-person",
      reason: "iterations",
      iterations: [
        iteration(1, "claude-sonnet-5-5"),
        iteration(2, "claude-sonnet-5-5"),
        iteration(3, "claude-opus-5-5"),
      ],
      handEdits: [{ after: 1, files: ["src/components/button/Button.vue"] }],
      totals: { iterations: 3, agentCostUsd: 4.1, judgeCostUsd: 0.1, costUsd: 4.2, escalated: true },
    });
    const feedback = agentRun("20261126T110000Z-button-0b1c", {
      kind: "feedback",
      parent: generate.id,
      totals: {
        iterations: 1,
        agentCostUsd: 1.1,
        judgeCostUsd: 0,
        costUsd: 1.1,
        costEstimated: true,
        escalated: false,
      },
    });
    const provenance = acceptGeneration(approved, {
      framework: "0.1.0",
      date: new Date("2026-11-26T12:00:00Z"),
      runs: [generate, feedback],
      specHash: hash("d"),
    });
    expect(provenance).toEqual({
      ...approved,
      spec: { path: "specs/button.md", hash: hash("d") },
      generation: {
        framework: "0.1.0",
        accepted: "2026-11-26",
        runs: [
          {
            id: generate.id,
            kind: "generate",
            status: "needs-a-person",
            iterations: 3,
            models: ["claude-sonnet-5-5", "claude-opus-5-5"],
            costUsd: 4.2,
          },
          {
            id: feedback.id,
            kind: "feedback",
            status: "passed",
            iterations: 1,
            models: ["claude-sonnet-5-5"],
            costUsd: 1.1,
          },
        ],
        handEdits: 1,
        costUsd: 5.3,
        costEstimated: true,
      },
    });
    expect(provenanceProblems(provenance)).toEqual([]);
  });

  it("refuses runs that aren't finished generate or feedback runs with a call", () => {
    const accept = (runs: RunRecord[]) => () =>
      acceptGeneration(approved, { framework: "0.1.0", date: new Date(), runs, specHash: hash("a") });
    expect(accept([])).toThrow(/at least its run/);
    expect(accept([agentRun("20261126T100000Z-button-3f9a", { status: "running" })])).toThrow(/hasn't ended/);
    expect(accept([agentRun("20261126T100000Z-button-3f9a", { kind: "propose" })])).toThrow(/propose run/);
    expect(accept([agentRun("20261126T100000Z-button-3f9a", { iterations: [] })])).toThrow(/no agent call/);
  });
});

describe("linked runs", () => {
  it("follow each run's parent, oldest first", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-provenance-"));
    const first = agentRun("20261126T100000Z-button-0001");
    const second = agentRun("20261126T110000Z-button-0002", { kind: "feedback", parent: first.id });
    const third = agentRun("20261126T120000Z-button-0003", { kind: "feedback", parent: second.id });
    for (const record of [first, second, third]) {
      expect(runRecordProblems(record)).toEqual([]);
      await writeRunRecord(runDirectory(root, record.id), record);
    }
    expect((await linkedRuns(root, third.id)).map((r) => r.id)).toEqual([first.id, second.id, third.id]);
    expect((await linkedRuns(root, first.id)).map((r) => r.id)).toEqual([first.id]);
  });

  it("fail on a missing record or a loop", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-provenance-"));
    const orphan = agentRun("20261126T110000Z-button-0002", {
      kind: "feedback",
      parent: "20261126T100000Z-button-0001",
    });
    await writeRunRecord(runDirectory(root, orphan.id), orphan);
    await expect(linkedRuns(root, orphan.id)).rejects.toThrow(/missing/);
    const a = agentRun("20261126T100000Z-button-000a", { kind: "feedback", parent: "20261126T100000Z-button-000b" });
    const b = agentRun("20261126T100000Z-button-000b", { kind: "feedback", parent: a.id });
    await writeRunRecord(runDirectory(root, a.id), a);
    await writeRunRecord(runDirectory(root, b.id), b);
    await expect(linkedRuns(root, a.id)).rejects.toThrow(/own ancestor/);
  });
});
