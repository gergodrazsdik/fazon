// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capture,
  captureJson,
  copyExample,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

let root: string;
let machine: FakeMachine;
beforeEach(async () => {
  root = await repository({ "fazon.yaml": minimalConfig });
  for (const name of ["button", "dialog", "tabs"]) {
    await copyExample(root, `valid/${name}.md`, `specs/${name}.md`);
  }
  machine = { cwd: root };
});
afterEach(() => removeRepository(root));

describe("fazon spec check", () => {
  it("checks every spec, as the CLI output example shows", async () => {
    const { code, json } = await captureJson(["spec", "check"], machine);
    expect(code).toBe(0);
    expect(json).toMatchObject({
      fazon: 0,
      command: "spec check",
      status: "ok",
      exitCode: 0,
      messages: [{ level: "info", text: "3 specs checked: no findings." }, expect.anything()],
      result: {
        specs: [
          { spec: "specs/button.md", findings: [] },
          { spec: "specs/dialog.md", findings: [] },
          { spec: "specs/tabs.md", findings: [] },
        ],
      },
    });
  });

  it("checks only the named specs", async () => {
    const { json } = await captureJson(["spec", "check", "tabs"], machine);
    expect(json.result).toMatchObject({ specs: [{ spec: "specs/tabs.md" }] });
  });

  it("says which rules it checked", async () => {
    const { stdout } = await capture(["spec", "check"], machine);
    expect(stdout).toContain("Checked SPEC-001, SPEC-002 and SPEC-019; the other SPEC rules arrive in M2.");
  });

  it("fails (1) with each finding's rule, path, line and message", async () => {
    await copyExample(root, "invalid/schema/enum-without-values.md", "specs/chip.md");
    const { code, json } = await captureJson(["spec", "check"], machine);
    expect(code).toBe(1);
    expect(json.status).toBe("failed");
    expect((json.result as { specs: unknown[] }).specs).toContainEqual({
      spec: "specs/chip.md",
      findings: [{ rule: "SPEC-001", path: "$.props.tone", line: 10, message: "missing required key 'values'" }],
    });
    expect(json.messages).toContainEqual({ level: "error", text: "4 specs checked: 1 finding in 1 spec." });
  });

  it("prints findings as file:line on standard error", async () => {
    await copyExample(root, "invalid/schema/enum-without-values.md", "specs/chip.md");
    const { code, stderr } = await capture(["spec", "check", "chip"], machine);
    expect(code).toBe(1);
    expect(stderr).toContain("specs/chip.md:10: SPEC-001 $.props.tone: missing required key 'values'");
  });

  it("finds a file name that isn't the kebab-case name (SPEC-002)", async () => {
    await copyExample(root, "valid/button.md", "specs/primary-button.md");
    const { code, json } = await captureJson(["spec", "check", "primary-button"], machine);
    expect(code).toBe(1);
    const [spec] = (json.result as { specs: { findings: { rule: string; message: string }[] }[] }).specs;
    expect(spec?.findings.map((finding) => finding.rule)).toEqual(["SPEC-002", "SPEC-002"]);
    expect(spec?.findings[1]?.message).toBe("the name Button is also used by specs/button.md");
  });

  it("refuses (2) a spec that doesn't exist, with the command that writes it", async () => {
    const { code, json } = await captureJson(["spec", "check", "badge"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "There's no spec at specs/badge.md. Write it first, or check the component name.",
        hint: "fazon spec new badge",
      },
    ]);
  });

  it("refuses (2) a component name that isn't kebab-case, with the right one", async () => {
    const { code, json } = await captureJson(["spec", "check", "RadioGroup"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "'RadioGroup' isn't a component name. Name components in kebab-case, as their spec files are named: radio-group.",
        hint: "fazon spec check radio-group",
      },
    ]);
  });

  it("refuses (2) without a valid config, saying what's wrong", async () => {
    await removeRepository(root);
    root = await repository();
    const missing = await captureJson(["spec", "check"], { cwd: root });
    expect(missing.code).toBe(2);
    expect(missing.json.messages).toEqual([expect.objectContaining({ hint: "fazon init" })]);

    await removeRepository(root);
    root = await repository({ "fazon.yaml": `${minimalConfig}paths:\n  spec: specs\n` });
    const invalid = await captureJson(["spec", "check"], { cwd: root });
    expect(invalid.code).toBe(2);
    expect((invalid.json.messages as { text: string }[])[0]?.text).toBe(
      "fazon.yaml:5: CONFIG-001 $.paths: unknown key 'spec'. See docs/spec/config.md for every key.",
    );
  });

  it("refuses (2) in CI while fazon.local.yaml exists", async () => {
    const local = await repository({
      "fazon.yaml": minimalConfig,
      "fazon.local.yaml": "fazon: 0\n",
      "specs/.keep": "",
    });
    try {
      const result = await captureJson(["spec", "check"], { cwd: local, env: { CI: "1" } });
      expect(result.code).toBe(2);
      expect(JSON.stringify(result.json.messages)).toContain("CONFIG-004");
    } finally {
      await removeRepository(local);
    }
  });

  it("refuses (2) when the specs directory doesn't exist", async () => {
    await removeRepository(root);
    root = await repository({ "fazon.yaml": `${minimalConfig}paths:\n  specs: docs/specs\n` });
    const { code, stderr } = await capture(["spec", "check"], { cwd: root });
    expect(code).toBe(2);
    expect(stderr).toContain("The specs directory 'docs/specs' doesn't exist. Create it, or set paths.specs");
  });
});
