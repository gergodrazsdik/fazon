// SPDX-License-Identifier: GPL-3.0-or-later
// The judge version changes whenever the judge's instructions, the response format or the rubric
// the plan derives change (docs/spec/measurement.md#calibrated-status). The fingerprint below
// covers all three, with the example specs' plans standing for the rubric. When this test fails,
// bump `judgeVersion` and record the new fingerprint for it; never update the fingerprint alone.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../matrix/build.js";
import { parseSpecFile } from "../spec/load.js";
import { judgeInstructions, judgeResponseSchema, judgeVersion } from "./instructions.js";
import { judgePlan } from "./plan.js";

/** Each judge version's fingerprint. */
const fingerprints: Readonly<Record<number, string>> = {
  1: "8dfb07fa469429e219718a0ee15cd8e4ae7551fad76c242f827e901af63ec6ad",
};

function fingerprint(): string {
  const docs = new URL("../../../../docs/spec/", import.meta.url);
  const plans = ["button", "tabs", "dialog"].map((name) => {
    const file = parseSpecFile(
      `specs/${name}.md`,
      readFileSync(new URL(`examples/specs/valid/${name}.md`, docs), "utf8"),
    );
    if (file.spec === undefined) throw new Error(`the example ${name} doesn't pass SPEC-001`);
    const manifest = buildManifest(file.spec, { file: file.file, themes: ["light", "dark"] });
    const changed = [{ story: manifest.stories[0]?.name ?? "", theme: "light" }];
    const family = [{ component: "Other", story: "other--label--default" }];
    return judgePlan({
      spec: { ...file.spec, reference: "reference.png" },
      body: file.body,
      manifest,
      changed,
      family,
    });
  });
  return createHash("sha256")
    .update(JSON.stringify({ instructions: judgeInstructions, schema: judgeResponseSchema(), plans }))
    .digest("hex");
}

describe("the judge version", () => {
  it(`is ${String(judgeVersion)}, whose instructions, response format and rubric are unchanged`, () => {
    expect(fingerprint()).toBe(fingerprints[judgeVersion]);
  });
});
