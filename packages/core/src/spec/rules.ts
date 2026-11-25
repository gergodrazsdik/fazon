// SPDX-License-Identifier: GPL-3.0-or-later
import type { Finding } from "../findings.js";
import type { SpecFile } from "./load.js";
import { kebabCase } from "./names.js";
import type { Spec } from "./types.js";

/** A spec file whose front matter passes SPEC-001. */
export type ValidSpecFile = SpecFile & { readonly spec: Spec };

/** One SPEC rule beyond the schema (docs/spec/spec-format.md#validation). */
export interface SpecRule {
  readonly id: string;
  /**
   * The rule's findings for one spec.
   * @param spec a spec that passes SPEC-001
   * @param all every spec in the repository, for the rules that compare specs
   */
  readonly check: (spec: ValidSpecFile, all: readonly SpecFile[]) => readonly Finding[];
}

const spec002: SpecRule = {
  id: "SPEC-002",
  check: ({ file, component, spec, lineOf }, all) => {
    const findings: Finding[] = [];
    const line = lineOf(["name"]);
    const at = { rule: "SPEC-002", file, path: "$.name", ...(line === undefined ? {} : { line }) };
    const expected = kebabCase(spec.name);
    if (component !== expected) {
      findings.push({
        ...at,
        message: `the file name is '${component}.md', but the name ${spec.name} needs '${expected}.md'`,
        hint: `Rename the file to '${expected}.md', or change name to match the file.`,
      });
    }
    const others = all
      .filter((other) => other.file !== file && other.spec?.name === spec.name)
      .map((other) => other.file);
    if (others.length > 0) {
      findings.push({
        ...at,
        message: `the name ${spec.name} is also used by ${others.join(", ")}`,
        hint: "Give each component its own name, in one spec.",
      });
    }
    return findings;
  },
};

/** The SPEC rules after SPEC-001, in order. The rest of SPEC-003 to SPEC-018 arrive in M2. */
export const specRules: readonly SpecRule[] = [spec002];

/** The IDs of every rule `checkSpec` checks. */
export const checkedSpecRules: readonly string[] = ["SPEC-001", ...specRules.map((rule) => rule.id)];

/** Every finding for one spec: SPEC-001's, then, when the schema holds, the other rules'. */
export function checkSpec(file: SpecFile, all: readonly SpecFile[]): readonly Finding[] {
  if (file.spec === undefined) {
    return file.findings;
  }
  const valid: ValidSpecFile = { ...file, spec: file.spec };
  return specRules.flatMap((rule) => rule.check(valid, all));
}
