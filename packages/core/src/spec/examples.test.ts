// SPDX-License-Identifier: GPL-3.0-or-later
// The M0 spec examples against SPEC-001, as scripts/check-spec-examples.sh checks them with
// check-jsonschema: the same paths, from the runtime validator. And the valid and semantic examples
// against every other SPEC rule, with the example library's draft token set, an icon set holding
// the icons they use, and an adapter schema like the Vue adapter's.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { SpecCheckInputs } from "./inputs.js";
import { specTokens } from "./inputs.js";
import { parseSpecFile, type SpecFile } from "./load.js";
import { kebabCase } from "./names.js";
import { checkedSpecRules, checkSpec, specNotes } from "./rules.js";

const examples = new URL("../../../../docs/spec/examples/specs/", import.meta.url);
const draftResolver = fileURLToPath(
  new URL("../../../../docs/spec/example-library/tokens/tokens.resolver.json", import.meta.url),
);

function read(directory: string) {
  const url = new URL(`${directory}/`, examples);
  return readdirSync(url)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: readFileSync(new URL(name, url), "utf8") }));
}

/** An adapter schema of the Vue adapter's shape: no options, and `map` values of `{ name }`. */
const vueLikeAdapter: NonNullable<SpecCheckInputs["adapter"]> = {
  id: "vue",
  extensionSchema: {
    map: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: { name: { type: "string", pattern: "^[a-z][A-Za-z0-9]*$" } },
    },
  },
};

let inputs: SpecCheckInputs;
beforeAll(async () => {
  const { tokenSet } = await resolveTokenSet(draftResolver);
  if (tokenSet === undefined) throw new Error("the draft token set doesn't resolve");
  inputs = { tokens: specTokens(tokenSet), icons: new Set(["check", "x"]), adapter: vueLikeAdapter };
});

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

describe("the examples under every SPEC rule", () => {
  /** An example, parsed under the file name its `name` gives, so SPEC-002 holds. */
  const parsed = (text: string) => {
    const name = parseSpecFile("specs/example.md", text).spec?.name ?? "";
    return parseSpecFile(`specs/${kebabCase(name)}.md`, text);
  };
  const valid: SpecFile[] = read("valid").map(({ text }) => parsed(text));

  it("check every rule", () => {
    expect(checkedSpecRules).toEqual(Array.from({ length: 19 }, (_, i) => `SPEC-${String(i + 1).padStart(3, "0")}`));
  });

  it.each(read("valid"))("$name passes them", ({ text }) => {
    const file = parsed(text);
    const all = [...valid.filter((other) => other.file !== file.file), file];
    expect(checkSpec(file, all, inputs)).toEqual([]);
  });

  it("note the extension blocks for adapters other than the consumer's", () => {
    const tabs = valid.find((file) => file.file === "specs/tabs.md");
    if (tabs === undefined) throw new Error("the Tabs example is missing");
    expect(specNotes(tabs, inputs).map((note) => note.path)).toEqual([
      "$.extensions.react",
      "$.extensions.angular",
      "$.extensions.web-components",
    ]);
    expect(specNotes(tabs)).toEqual([]);
  });

  const semantic = read("invalid/semantic").map(({ name, text }) => ({
    name,
    text,
    rule: /^# fails: (SPEC-\d{3})$/m.exec(text)?.[1] ?? "",
  }));

  it("cover every rule from SPEC-003", () => {
    const covered = new Set(semantic.map(({ rule }) => rule));
    expect(checkedSpecRules.filter((rule) => rule >= "SPEC-003" && !covered.has(rule))).toEqual([]);
  });

  it.each(semantic)("$name fails $rule only", ({ text, rule }) => {
    const file = parsed(text);
    const findings = checkSpec(file, [...valid, file], inputs);
    expect(findings.length).toBeGreaterThan(0);
    expect(new Set(findings.map((finding) => finding.rule))).toEqual(new Set([rule]));
    for (const finding of findings) expect(finding.line).toBeGreaterThan(1);
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
