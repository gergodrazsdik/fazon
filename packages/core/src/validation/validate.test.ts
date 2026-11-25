// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseYaml } from "../yaml.js";
import { readSchema, schemaNames } from "./schemas.js";
import { jsonPath, validateFile, validateWithSchema } from "./validate.js";

const examples = new URL("../../../../docs/spec/examples/", import.meta.url);
const spec = { fazon: 0, name: "Chip", tier: "primitive", summary: "Shows a status." };

describe("jsonPath", () => {
  it("writes keys with dots and indices in brackets", () => {
    expect(jsonPath([])).toBe("$");
    expect(jsonPath(["props", "tone"])).toBe("$.props.tone");
    expect(jsonPath(["exemptions", 0, "reason"])).toBe("$.exemptions[0].reason");
  });
});

describe("the schemas", () => {
  it.each(schemaNames)("%s reaches the runtime and compiles", (name) => {
    expect(readSchema(name).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(() => validateWithSchema(name, {})).not.toThrow();
  });
});

describe("validateWithSchema", () => {
  it("finds nothing in a valid value", () => {
    expect(validateWithSchema("spec", spec)).toEqual([]);
  });

  it("names the unknown key, at the object that holds it", () => {
    expect(validateWithSchema("spec", { ...spec, approved: true })).toEqual([
      { path: "$", segments: [], key: "approved", message: "unknown key 'approved'" },
    ]);
  });

  it("tells an array index from a key", () => {
    const [finding] = validateWithSchema("spec", { ...spec, exemptions: [{ check: "layout", rule: "target-size" }] });
    expect(finding).toMatchObject({ path: "$.exemptions[0]", segments: ["exemptions", 0] });
  });

  it("reports a wrong type once, without the keywords it also fails", () => {
    expect(validateWithSchema("spec", { ...spec, props: { tone: ["a", "b"] } })).toEqual([
      { path: "$.props.tone", segments: ["props", "tone"], message: "must be an object" },
    ]);
  });

  it("reports an invalid key name with the key", () => {
    const findings = validateWithSchema("spec", { ...spec, props: { Tone: { type: "string" } } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "$.props", key: "Tone" });
    expect(findings[0]?.message).toMatch(/^key 'Tone': "Tone" doesn't match/);
  });

  it("reports a failed oneOf as a whole, with the schema's description", () => {
    const findings = validateWithSchema("spec", {
      ...spec,
      fixtures: { short: { slots: { default: [{ text: "a", icon: "b" }] } } },
    });
    expect(findings).toEqual([
      {
        path: "$.fixtures.short.slots.default",
        segments: ["fixtures", "short", "slots", "default"],
        message: "doesn't match any allowed form: Slot content: one node, or a list of nodes rendered in order",
      },
    ]);
  });

  it("says which values an enum allows", () => {
    expect(validateWithSchema("spec", { ...spec, tier: "big" })[0]?.message).toBe(
      "must be one of: primitive, form-control, composite",
    );
  });
});

describe("validateFile", () => {
  it("names the file in each finding, for hooks such as the tokens pipeline's", () => {
    const findings = validateFile("token-resolver", [], "tokens/tokens.resolver.json");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ file: "tokens/tokens.resolver.json", path: "$" });
  });

  it("passes the example library's token files", () => {
    const drafts = new URL("../../../../docs/spec/example-library/tokens/", import.meta.url);
    const resolver = JSON.parse(readFileSync(new URL("tokens.resolver.json", drafts), "utf8")) as unknown;
    expect(validateFile("token-resolver", resolver, "tokens.resolver.json")).toEqual([]);
  });
});

describe("the config examples", () => {
  const configs = readdirSync(new URL("config/", examples)).flatMap((directory) =>
    readdirSync(new URL(`config/${directory}/`, examples)).map((file) => ({
      file: `${directory}/${file}`,
      text: readFileSync(new URL(`config/${directory}/${file}`, examples), "utf8"),
    })),
  );

  it.each(configs)("$file passes its schema", ({ file, text }) => {
    const yaml = parseYaml(text);
    expect(yaml.errors).toEqual([]);
    expect(validateWithSchema(file.endsWith(".local.yaml") ? "config-local" : "config", yaml.data)).toEqual([]);
  });
});

describe("the CLI output examples", () => {
  const outputs = readdirSync(new URL("cli/", examples)).map((file) => ({
    file,
    data: JSON.parse(readFileSync(new URL(`cli/${file}`, examples), "utf8")) as unknown,
  }));

  it.each(outputs)("$file passes the CLI output schema", ({ data }) => {
    expect(validateWithSchema("cli-output", data)).toEqual([]);
  });
});
