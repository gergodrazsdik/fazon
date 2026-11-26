// SPDX-License-Identifier: GPL-3.0-or-later
import type { Finding } from "../findings.js";
import { jsonPath, type PathSegment } from "../validation/validate.js";
import { proseLines } from "./body.js";
import type { SpecCheckInputs } from "./inputs.js";
import type { SpecFile } from "./load.js";
import { kebabCase } from "./names.js";
import { spec003, spec004, spec005, spec006, spec007, spec008 } from "./rules-api.js";
import { spec011, spec012, spec014, spec018 } from "./rules-checks.js";
import { extensionNotes, spec013, type SpecNote } from "./rules-extensions.js";
import { spec009 } from "./rules-fixtures.js";
import { spec010, spec015, spec016, spec017 } from "./rules-matrix.js";
import type { ValidSpecFile } from "./scope.js";

export type { ValidSpecFile } from "./scope.js";

/** One SPEC rule beyond the schema (docs/spec/spec-format.md#validation). */
export interface SpecRule {
  readonly id: string;
  /**
   * The rule's findings for one spec.
   * @param spec a spec that passes SPEC-001
   * @param all every spec in the repository, for the rules that compare specs
   * @param inputs the token set, icon set and adapter, for the rules that need them
   */
  readonly check: (spec: ValidSpecFile, all: readonly SpecFile[], inputs: SpecCheckInputs) => readonly Finding[];
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

/** What starts a placeholder of the spec template (`fazon spec new`). */
export const placeholderMarker = "TODO:";

/** Whether a text starts with the placeholder marker, after any spaces and a list item's marker. */
function isPlaceholder(text: string): boolean {
  let rest = text.trimStart();
  const item = /^(?:[-*+]|\d{1,9}[.)])(?=\s)/.exec(rest);
  if (item !== null) rest = rest.slice(item[0].length).trimStart();
  return rest.startsWith(placeholderMarker);
}

/** Every string in the front matter, with its path. */
function strings(value: unknown, segments: PathSegment[] = []): { segments: PathSegment[]; text: string }[] {
  if (typeof value === "string") return [{ segments, text: value }];
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => strings(item, [...segments, index]));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => strings(item, [...segments, key]));
  }
  return [];
}

const spec019: SpecRule = {
  id: "SPEC-019",
  check: ({ file, spec, body, bodyLine, lineOf }) => {
    const hint = "Replace it with the component's content, or remove it; the spec skill drafts the content with you.";
    const message = (text: string) => `a placeholder from the spec template is left: '${text.trim()}'`;
    const findings: Finding[] = [];
    for (const { segments, text } of strings(spec)) {
      if (!isPlaceholder(text)) continue;
      const line = lineOf(segments);
      findings.push({
        rule: "SPEC-019",
        file,
        path: jsonPath(segments),
        ...(line === undefined ? {} : { line }),
        message: message(text),
        hint,
      });
    }
    for (const { line, text } of proseLines(body, bodyLine)) {
      if (isPlaceholder(text)) findings.push({ rule: "SPEC-019", file, line, message: message(text), hint });
    }
    return findings;
  },
};

/** The SPEC rules after SPEC-001, in order. */
export const specRules: readonly SpecRule[] = [
  spec002,
  spec003,
  spec004,
  spec005,
  spec006,
  spec007,
  spec008,
  spec009,
  spec010,
  spec011,
  spec012,
  spec013,
  spec014,
  spec015,
  spec016,
  spec017,
  spec018,
  spec019,
];

/** The IDs of every rule `checkSpec` checks, in order. */
export const checkedSpecRules: readonly string[] = ["SPEC-001", ...specRules.map((rule) => rule.id)];

/**
 * Every finding for one spec: SPEC-001's, then, when the schema holds, the other rules'.
 * @param all every spec in the repository, the spec itself included
 * @param inputs the token set, icon set and adapter; the parts of SPEC-009, SPEC-011 and SPEC-013
 *   that need an input left out are skipped
 */
export function checkSpec(file: SpecFile, all: readonly SpecFile[], inputs: SpecCheckInputs = {}): readonly Finding[] {
  if (file.spec === undefined) {
    return file.findings;
  }
  const valid: ValidSpecFile = { ...file, spec: file.spec };
  return specRules.flatMap((rule) => rule.check(valid, all, inputs));
}

/** What `spec check` reports about a spec without failing it: extension blocks no adapter's schema checked (SPEC-013). */
export function specNotes(file: SpecFile, inputs: SpecCheckInputs = {}): readonly SpecNote[] {
  return file.spec === undefined ? [] : extensionNotes({ ...file, spec: file.spec }, inputs);
}
