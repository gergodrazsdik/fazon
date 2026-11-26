// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseSpecFile } from "@fazon/core";
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
import { pascalCase, specScaffold, tiers } from "./spec-new.js";

let root: string;
let machine: FakeMachine;
beforeEach(async () => {
  root = await repository({ "fazon.yaml": minimalConfig });
  machine = { cwd: root };
});
afterEach(() => removeRepository(root));

const read = (file: string) => readFile(path.join(root, file), "utf8");

describe("fazon spec new", () => {
  it("writes the spec from the template, and says where", async () => {
    const { code, json } = await captureJson(["spec", "new", "radio-group", "--tier", "form-control"], machine);
    expect(code).toBe(0);
    expect(json).toMatchObject({
      command: "spec new",
      status: "ok",
      exitCode: 0,
      messages: [{ level: "info", hint: "fazon spec check radio-group" }],
      result: { spec: "specs/radio-group.md", name: "RadioGroup", tier: "form-control" },
    });
    const parsed = parseSpecFile("specs/radio-group.md", await read("specs/radio-group.md"));
    expect(parsed.findings).toEqual([]);
    expect(parsed.spec).toMatchObject({ fazon: 0, name: "RadioGroup", tier: "form-control" });
    expect(parsed.spec?.summary).toMatch(/^TODO: /);
  });

  it("writes every required field and heading, and no API", async () => {
    await capture(["spec", "new", "badge"], machine);
    const text = await read("specs/badge.md");
    const parsed = parseSpecFile("specs/badge.md", text);
    expect(Object.keys(parsed.spec ?? {})).toEqual(["fazon", "name", "tier", "summary"]);
    expect(text.match(/^## .*$/gm)).toEqual(["## Purpose", "## Behaviour", "## Never"]);
  });

  it("writes a spec that fazon spec check passes, beside the others", async () => {
    for (const name of ["button", "dialog", "tabs"]) {
      await copyExample(root, `valid/${name}.md`, `specs/${name}.md`);
    }
    expect((await capture(["spec", "new", "html-editor"], machine)).code).toBe(0);
    const { code, json } = await captureJson(["spec", "check"], machine);
    expect(code).toBe(0);
    expect(json.messages).toContainEqual({ level: "info", text: "4 specs checked: no findings." });
  });

  it("writes no license header or copyright line (LICENSE-002), with LF line endings", async () => {
    await capture(["spec", "new", "badge"], machine);
    const text = await read("specs/badge.md");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).not.toMatch(/SPDX|copyright|license/i);
    expect(text).not.toContain("\r");
    expect(text).not.toContain("{{");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("takes the tier from --tier, primitive by default", async () => {
    const { json } = await captureJson(["spec", "new", "badge"], machine);
    expect(json.result).toMatchObject({ tier: "primitive" });
    expect((json.messages as { text: string }[])[0]?.text).toBe(
      "Wrote specs/badge.md: Badge, a primitive (the default; --tier sets another). Replace its TODOs with the spec skill or by hand, then check it.",
    );
    for (const tier of tiers) {
      await capture(["spec", "new", `tier-${tier}`, "--tier", tier], machine);
      expect(parseSpecFile(`specs/tier-${tier}.md`, await read(`specs/tier-${tier}.md`)).spec?.tier).toBe(tier);
    }
  });

  it("writes into the specs directory the config names, creating it", async () => {
    await writeFile(path.join(root, "fazon.yaml"), `${minimalConfig}paths:\n  specs: docs/specs\n`);
    const { code, json } = await captureJson(["spec", "new", "link"], machine);
    expect(code).toBe(0);
    expect(json.result).toMatchObject({ spec: "docs/specs/link.md" });
    expect(await read("docs/specs/link.md")).toContain("name: Link\n");
  });

  it("refuses (2) when the spec exists, and leaves it as it was", async () => {
    await copyExample(root, "valid/button.md", "specs/button.md");
    const before = await read("specs/button.md");
    const { code, json } = await captureJson(["spec", "new", "button"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "specs/button.md exists already; fazon spec new never overwrites a spec. Edit it, or remove it first to start over.",
        hint: "fazon spec check button",
      },
    ]);
    expect(await read("specs/button.md")).toBe(before);
  });

  it("refuses (2) without a component name", async () => {
    const { code, json } = await captureJson(["spec", "new"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([expect.objectContaining({ hint: "fazon spec new button" })]);
  });

  it("refuses (2) a name that isn't kebab-case, with the right one", async () => {
    const { code, json } = await captureJson(["spec", "new", "RadioGroup"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "'RadioGroup' isn't a component name. Name components in kebab-case, as their spec files are named: radio-group.",
        hint: "fazon spec new radio-group",
      },
    ]);
  });

  it("refuses (2) a name whose component name wouldn't give back its file name", async () => {
    const { code, json } = await captureJson(["spec", "new", "heading-2"], machine);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("its name would be Heading2, whose spec file is heading2.md") as unknown,
        hint: "fazon spec new heading2",
      }),
    ]);
  });

  it("refuses (2) an unknown tier, and more than one name", async () => {
    const tier = await captureJson(["spec", "new", "badge", "--tier", "atom"], machine);
    expect(tier.code).toBe(2);
    expect((tier.json.messages as { text: string }[])[0]?.text).toBe(
      "'atom' isn't a tier. Use primitive, form-control or composite.",
    );
    const two = await capture(["spec", "new", "badge", "link"], machine);
    expect(two.code).toBe(2);
    expect(two.stderr).toContain("fazon spec new doesn't take 'link'");
  });

  it("refuses (2) without a valid config, and writes nothing", async () => {
    await removeRepository(root);
    root = await repository();
    const { code, json } = await captureJson(["spec", "new", "badge"], { cwd: root });
    expect(code).toBe(2);
    expect(json.messages).toEqual([expect.objectContaining({ hint: "fazon init" })]);
    await expect(read("specs/badge.md")).rejects.toThrow();
  });
});

describe("the spec template", () => {
  it("fills every placeholder", () => {
    const text = specScaffold("Badge", "primitive");
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text).toContain("name: Badge\ntier: primitive\n");
  });

  it("names components in PascalCase", () => {
    expect(pascalCase("button")).toBe("Button");
    expect(pascalCase("radio-group")).toBe("RadioGroup");
    expect(pascalCase("heading2")).toBe("Heading2");
  });
});
