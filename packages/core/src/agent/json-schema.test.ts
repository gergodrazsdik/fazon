// SPDX-License-Identifier: GPL-3.0-or-later
import { Ajv } from "ajv";
import ajvFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { proposalSchema } from "../spec/proposal.js";
import { claudeCodeJsonSchema } from "./json-schema.js";

/** Compiles a schema as Claude Code 2.1.332 does: draft-07, with Ajv's default strict mode, which rejects unknown keywords. */
function compileAsClaudeCode(schema: object): void {
  const ajv = new Ajv({ allErrors: true });
  ajvFormats.default(ajv);
  ajv.compile(schema);
}

describe("the schema given to Claude Code", () => {
  it("drops $schema and unevaluatedProperties, and renames $defs, its $refs and dependentRequired", () => {
    expect(
      claudeCodeJsonSchema({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { a: { $ref: "#/$defs/name" }, b: { type: "string" } },
        dependentRequired: { a: ["b"] },
        unevaluatedProperties: false,
        $defs: { name: { type: "string", pattern: "^[a-z]+$" } },
      }),
    ).toEqual({
      type: "object",
      properties: { a: { $ref: "#/definitions/name" }, b: { type: "string" } },
      dependencies: { a: ["b"] },
      definitions: { name: { type: "string", pattern: "^[a-z]+$" } },
    });
  });

  it("makes the proposal schema compile as draft-07 in strict mode, which the 2020-12 original doesn't", () => {
    expect(() => {
      compileAsClaudeCode(proposalSchema());
    }).toThrow();
    expect(() => {
      compileAsClaudeCode(claudeCodeJsonSchema(proposalSchema()));
    }).not.toThrow();
  });
});
