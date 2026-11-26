// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSpecFile, readSpecFiles } from "./load.js";
import { isKebabCase, kebabCase } from "./names.js";
import { checkedSpecRules, checkSpec } from "./rules.js";

const body = "\n## Purpose\n\nA label.\n\n## Behaviour\n\n- None.\n\n## Never\n\n- Never a button.\n";

function specText(name: string, extra = "") {
  return `---\nfazon: 0\nname: ${name}\ntier: primitive\nsummary: Shows a status.\n${extra}---\n${body}`;
}

describe("parseSpecFile", () => {
  it("splits the front matter from the body and types it", () => {
    const file = parseSpecFile("specs/chip.md", specText("Chip"));
    expect(file.findings).toEqual([]);
    expect(file.component).toBe("chip");
    expect(file.spec).toEqual({ fazon: 0, name: "Chip", tier: "primitive", summary: "Shows a status." });
    expect(file.body).toBe(body);
  });

  it("refuses a file without front matter", () => {
    const file = parseSpecFile("specs/chip.md", "# Chip\n");
    expect(file.spec).toBeUndefined();
    expect(file.findings).toEqual([
      expect.objectContaining({
        rule: "SPEC-001",
        line: 1,
        message: expect.stringContaining("front matter") as string,
      }),
    ]);
  });

  it("refuses front matter without its closing line", () => {
    const file = parseSpecFile("specs/chip.md", "---\nfazon: 0\n");
    expect(file.findings[0]?.message).toBe("the front matter has no closing '---' line");
  });

  it("reports YAML errors at their line in the file", () => {
    const file = parseSpecFile("specs/chip.md", specText("Chip", "tier: composite\n"));
    expect(file.findings).toEqual([
      expect.objectContaining({ rule: "SPEC-001", line: 6, message: expect.stringContaining("unique") as string }),
    ]);
  });

  it("reports schema findings at the line of the key they're about", () => {
    const file = parseSpecFile("specs/chip.md", specText("Chip", "props:\n  tone:\n    type: enum\n"));
    expect(file.findings).toEqual([
      {
        rule: "SPEC-001",
        file: "specs/chip.md",
        path: "$.props.tone",
        line: 8,
        message: "missing required key 'values'",
      },
    ]);
  });

  it("takes paragraph nodes in slot content, alone or in a list, with plain text only", () => {
    const slots = "slots:\n  default:\n    required: true\nfixtures:\n  notes:\n    slots:\n      default:";
    const list = parseSpecFile(
      "specs/chip.md",
      specText("Chip", `${slots}\n        - { p: "First <b>one</b>." }\n        - { p: Second. }\n`),
    );
    expect(list.findings).toEqual([]);
    expect(list.spec?.fixtures?.notes?.slots?.default).toEqual([{ p: "First <b>one</b>." }, { p: "Second." }]);
    expect(parseSpecFile("specs/chip.md", specText("Chip", `${slots} { p: Only. }\n`)).findings).toEqual([]);

    for (const node of ["{ p: Second., tag: h2 }", '{ p: "" }', "{ p: [Second.] }", "{ p: Second., text: x }"]) {
      const file = parseSpecFile(
        "specs/chip.md",
        specText("Chip", `${slots}\n        - { p: First. }\n        - ${node}\n`),
      );
      expect(file.spec).toBeUndefined();
      expect(file.findings.map((finding) => finding.path)).toEqual(["$.fixtures.notes.slots.default"]);
    }
  });

  it("reads YAML 1.2: a date-like value stays a string", () => {
    const file = parseSpecFile("specs/chip.md", specText("Chip", "summary2: 2026-11-25\n"));
    expect(file.findings[0]?.message).toBe("unknown key 'summary2'");
    expect(file.findings[0]?.line).toBe(6);
  });
});

describe("kebabCase", () => {
  it.each([
    ["Button", "button"],
    ["RadioGroup", "radio-group"],
    ["HTMLEditor", "html-editor"],
    ["Heading2", "heading2"],
  ])("%s is %s", (name, expected) => {
    expect(kebabCase(name)).toBe(expected);
    expect(isKebabCase(expected)).toBe(true);
  });

  it("tells kebab-case from other cases", () => {
    expect(isKebabCase("Button")).toBe(false);
    expect(isKebabCase("radio_group")).toBe(false);
  });
});

describe("checkSpec", () => {
  it("checks SPEC-001 and SPEC-002 so far", () => {
    expect(checkedSpecRules).toEqual(["SPEC-001", "SPEC-002"]);
  });

  it("passes a spec whose file name is the kebab-case name", () => {
    const file = parseSpecFile("specs/radio-group.md", specText("RadioGroup"));
    expect(checkSpec(file, [file])).toEqual([]);
  });

  it("finds a file name that isn't the kebab-case name, at the name's line", () => {
    const file = parseSpecFile("specs/radiogroup.md", specText("RadioGroup"));
    expect(checkSpec(file, [file])).toEqual([
      {
        rule: "SPEC-002",
        file: "specs/radiogroup.md",
        path: "$.name",
        line: 3,
        message: "the file name is 'radiogroup.md', but the name RadioGroup needs 'radio-group.md'",
        hint: "Rename the file to 'radio-group.md', or change name to match the file.",
      },
    ]);
  });

  it("finds two specs with one name", () => {
    const first = parseSpecFile("specs/chip.md", specText("Chip"));
    const second = parseSpecFile("specs/chip-old.md", specText("Chip"));
    const findings = checkSpec(first, [first, second]);
    expect(findings).toEqual([expect.objectContaining({ message: "the name Chip is also used by specs/chip-old.md" })]);
  });

  it("returns SPEC-001's findings alone when the schema fails", () => {
    const file = parseSpecFile("specs/other.md", specText("chip"));
    expect(checkSpec(file, [file]).map((finding) => finding.rule)).toEqual(["SPEC-001"]);
  });
});

describe("readSpecFiles", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it("reads the Markdown files of a directory in name order", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-specs-"));
    await mkdir(path.join(root, "specs"));
    await writeFile(path.join(root, "specs", "tabs.md"), specText("Tabs"));
    await writeFile(path.join(root, "specs", "button.md"), specText("Button"));
    await writeFile(path.join(root, "specs", "notes.txt"), "not a spec");
    const files = await readSpecFiles(root, "specs");
    expect(files.map((file) => file.file)).toEqual(["specs/button.md", "specs/tabs.md"]);
    expect(files.every((file) => file.spec !== undefined)).toBe(true);
  });
});
