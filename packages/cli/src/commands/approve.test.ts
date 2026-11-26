// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashApi, hashText, parseSpecFile, provenanceProblems, type Provenance, type Spec } from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approve } from "./approve.js";
import {
  captureJson,
  copyExample,
  fakeEnvironment,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

let root: string;
let machine: FakeMachine;
beforeEach(async () => {
  root = await repository({ "fazon.yaml": minimalConfig });
  await copyExample(root, "valid/button.md", "specs/button.md");
  machine = { cwd: root };
});
afterEach(() => removeRepository(root));

const provenanceFile = "src/components/button/generated/provenance.json";
const read = (file: string) => readFile(path.join(root, file), "utf8");
const buttonSpec = async (): Promise<Spec> => {
  const spec = parseSpecFile("specs/button.md", await read("specs/button.md")).spec;
  if (spec === undefined) throw new Error("the example doesn't parse");
  return spec;
};

describe("fazon approve", () => {
  it("records the API's hash and today's date in the provenance file", async () => {
    const { code, json } = await captureJson(["approve", "button"], machine);
    expect(code).toBe(0);
    const apiHash = hashApi(await buttonSpec());
    const provenance = JSON.parse(await read(provenanceFile)) as Provenance;
    expect(provenanceProblems(provenance)).toEqual([]);
    expect(provenance).toEqual({
      fazon: 0,
      component: "Button",
      spec: { path: "specs/button.md", hash: hashText(await read("specs/button.md")) },
      api: { hash: apiHash, approved: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown },
    });
    expect(json).toMatchObject({
      command: "approve",
      status: "ok",
      result: {
        component: "Button",
        spec: "specs/button.md",
        provenance: provenanceFile,
        apiHash,
        approved: provenance.api.approved,
      },
    });
    expect(json.messages).toEqual([
      {
        level: "info",
        text: `Approved Button's API (${apiHash}) on ${provenance.api.approved}, in ${provenanceFile}. Commit it with the spec.`,
        hint: "fazon generate button",
      },
    ]);
  });

  it("dates the approval with the clock, and keeps an accepted generation when the API changes", async () => {
    const day = (iso: string) => () => new Date(iso);
    const context = { environment: fakeEnvironment(machine), global: { json: true, verbose: false, color: false } };
    const invocation = { positionals: ["button"], options: {} };
    await approve(invocation, context, day("2026-11-25T23:30:00Z"));
    const first = JSON.parse(await read(provenanceFile)) as Provenance;
    expect(first.api.approved).toBe("2026-11-25");

    const generation = {
      framework: "0.0.0",
      accepted: "2026-11-25",
      runs: [
        {
          id: "20261125T120000Z-button-3f9a",
          kind: "generate",
          status: "passed",
          iterations: 2,
          models: ["claude-sonnet-5-5"],
          costUsd: 1.2,
        },
      ],
      handEdits: 0,
      costUsd: 1.2,
    };
    await writeFile(path.join(root, provenanceFile), JSON.stringify({ ...first, generation }));
    const text = await read("specs/button.md");
    await writeFile(
      path.join(root, "specs/button.md"),
      text.replace("values: [button, submit, reset]", "values: [button, submit]"),
    );

    const outcome = await approve(invocation, context, day("2026-11-26T08:00:00Z"));
    const second = JSON.parse(await read(provenanceFile)) as Provenance;
    expect(second.api).toEqual({ hash: hashApi(await buttonSpec()), approved: "2026-11-26" });
    expect(second.api.hash).not.toBe(first.api.hash);
    expect(second.generation).toEqual(generation);
    expect(outcome.result).toMatchObject({ previousApiHash: first.api.hash });
  });

  it("says when the API was approved already", async () => {
    await captureJson(["approve", "button"], machine);
    const { code, json } = await captureJson(["approve", "button"], machine);
    expect(code).toBe(0);
    expect((json.messages as { text: string }[])[0]?.text).toMatch(
      /^Button's API was approved already, on \d{4}-\d{2}-\d{2}; approved again on /,
    );
    expect(json.result).not.toHaveProperty("previousApiHash");
  });

  it("refuses (2) a spec with findings, such as a fresh one's placeholders, and writes nothing", async () => {
    expect((await captureJson(["spec", "new", "badge"], machine)).code).toBe(0);
    const { code, json } = await captureJson(["approve", "badge"], machine);
    expect(code).toBe(2);
    const messages = json.messages as { level: string; text: string; hint?: string }[];
    expect(messages[0]).toEqual({
      level: "error",
      text: "specs/badge.md has findings, so its API can't be approved yet: 4 findings. Fix them first.",
      hint: "fazon spec check badge",
    });
    expect(messages.slice(1).every((message) => message.text.includes("SPEC-019"))).toBe(true);
    await expect(read("src/components/badge/generated/provenance.json")).rejects.toThrow();
  });

  it("refuses (2) a spec that breaks the schema, and a missing spec", async () => {
    await copyExample(root, "invalid/schema/enum-without-values.md", "specs/chip.md");
    const invalid = await captureJson(["approve", "chip"], machine);
    expect(invalid.code).toBe(2);
    expect((invalid.json.messages as { text: string }[])[1]?.text).toContain(
      "SPEC-001 $.props.tone: missing required key 'values'",
    );
    expect((await captureJson(["approve", "link"], machine)).code).toBe(2);
  });

  it("refuses (2) a provenance file that isn't valid, and leaves it", async () => {
    await mkdir(path.join(root, "src/components/button/generated"), { recursive: true });
    await writeFile(path.join(root, provenanceFile), "{}");
    const { code, json } = await captureJson(["approve", "button"], machine);
    expect(code).toBe(2);
    expect((json.messages as { text: string }[])[0]?.text).toMatch(
      /^src\/components\/button\/generated\/provenance.json isn't a valid provenance file/,
    );
    expect(await read(provenanceFile)).toBe("{}");
  });

  it("warns when the spec has no API", async () => {
    await writeFile(
      path.join(root, "specs/badge.md"),
      "---\nfazon: 0\nname: Badge\ntier: primitive\nsummary: A status.\n---\n\n## Purpose\n\nA.\n\n## Behaviour\n\n- B.\n\n## Never\n\n- C.\n",
    );
    await writeFile(path.join(root, "fazon.yaml"), `${minimalConfig}tokens:\n  prefix: fz\n`);
    const { code, json } = await captureJson(["approve", "badge"], machine);
    expect(code).toBe(0);
    expect(json.messages).toContainEqual({
      level: "warning",
      text: "specs/badge.md has no API: no props, events, slots, methods or parts. fazon propose drafts one.",
      hint: "fazon propose badge",
    });
  });
});
