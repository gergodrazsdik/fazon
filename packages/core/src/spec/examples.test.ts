// SPDX-License-Identifier: GPL-3.0-or-later
// The M0 spec examples against SPEC-001, as scripts/check-spec-examples.sh checks them with
// check-jsonschema: the same paths, from the runtime validator. And the valid and semantic examples
// against the other SPEC rules checked so far.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSpecFile } from "./load.js";
import { kebabCase } from "./names.js";
import { checkedSpecRules, checkSpec } from "./rules.js";

const examples = new URL("../../../../docs/spec/examples/specs/", import.meta.url);

function read(directory: string) {
  const url = new URL(`${directory}/`, examples);
  return readdirSync(url)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: readFileSync(new URL(name, url), "utf8") }));
}

describe("the valid and semantic examples", () => {
  const files = [...read("valid"), ...read("invalid/semantic")];

  it("are all there", () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it.each(files)("$name passes SPEC-001", ({ name, text }) => {
    const file = parseSpecFile(`specs/${name}`, text);
    expect(file.findings).toEqual([]);
    expect(file.spec?.fazon).toBe(0);
  });
});

describe("the examples under the SPEC rules checked so far", () => {
  /** An example, parsed under the file name its `name` gives, so SPEC-002 holds. */
  const parsed = (text: string) => {
    const name = parseSpecFile("specs/example.md", text).spec?.name ?? "";
    return parseSpecFile(`specs/${kebabCase(name)}.md`, text);
  };

  it.each(read("valid"))("$name passes them", ({ text }) => {
    const file = parsed(text);
    expect(checkSpec(file, [file])).toEqual([]);
  });

  const semantic = read("invalid/semantic").map(({ name, text }) => ({
    name,
    text,
    rule: /^# fails: (SPEC-\d{3})$/m.exec(text)?.[1] ?? "",
  }));

  it.each(semantic)("$name fails $rule only, when it's checked", ({ text, rule }) => {
    const file = parsed(text);
    const rules = checkSpec(file, [file]).map((finding) => finding.rule);
    if (checkedSpecRules.includes(rule)) {
      expect(rules.length).toBeGreaterThan(0);
      expect(new Set(rules)).toEqual(new Set([rule]));
    } else {
      expect(rules).toEqual([]);
    }
  });
});

describe("the schema examples", () => {
  const files = read("invalid/schema").map(({ name, text }) => ({
    name,
    text,
    expected: /^# expect-error-at: (.+)$/m.exec(text)?.[1],
  }));

  it("are all there", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)("$name fails SPEC-001 at $expected only", ({ name, text, expected }) => {
    expect(expected).toBeDefined();
    const file = parseSpecFile(`specs/${name}`, text);
    expect(file.spec).toBeUndefined();
    expect(file.findings.length).toBeGreaterThan(0);
    expect(new Set(file.findings.map((finding) => finding.path))).toEqual(new Set([expected]));
    for (const finding of file.findings) {
      expect(finding.rule).toBe("SPEC-001");
      expect(finding.line).toBeGreaterThan(1);
    }
  });
});
