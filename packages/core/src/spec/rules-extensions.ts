// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-013 (docs/spec/spec-format.md#validation): extensions. The core checks every block's paths;
// the consumer's adapter's schema checks its own block's `options` and `map` values.
import { validateWithJsonSchema, type PathSegment } from "../validation/validate.js";
import type { SpecCheckInputs } from "./inputs.js";
import type { SpecRule } from "./rules.js";
import { Findings, hasPart, lineAt, own, scopeOf, type ValidSpecFile } from "./scope.js";
import type { Spec } from "./types.js";
import { parseMemberPath } from "./walk.js";

/** Whether the neutral API has the member a path names. */
function hasMember(spec: Spec, path: string): boolean {
  const member = parseMemberPath(path);
  if (member === undefined) return false;
  const scope = member.part === undefined ? spec : scopeOf(spec, member.part);
  const members: Readonly<Record<string, unknown>> | undefined = scope?.[member.kind];
  return own(members, member.name) !== undefined;
}

export const spec013: SpecRule = {
  id: "SPEC-013",
  check: (file, _all, inputs) => {
    const { spec } = file;
    const findings = new Findings("SPEC-013", file);
    for (const [adapter, extension] of Object.entries(spec.extensions ?? {})) {
      const at: PathSegment[] = ["extensions", adapter];
      for (const operation of ["map", "omit"] as const) {
        for (const path of Object.keys(extension[operation] ?? {})) {
          if (!hasMember(spec, path)) {
            findings.add(
              [...at, operation, path],
              `extensions.${adapter}.${operation} names ${path}, which the neutral API doesn't have`,
              operation === "map"
                ? "Map a member the spec declares, or add it with add."
                : "Omit a member the spec declares.",
            );
          }
        }
      }
      const added = Object.keys(extension.add ?? {});
      for (const path of added) {
        const part = parseMemberPath(path)?.part;
        if (part !== undefined && !hasPart(spec, part)) {
          findings.add(
            [...at, "add", path],
            `extensions.${adapter}.add adds ${path}, but ${spec.name} has no part ${part}`,
            "Add members to a part the spec declares.",
          );
        } else if (hasMember(spec, path)) {
          findings.add(
            [...at, "add", path],
            `extensions.${adapter}.add adds ${path}, which the neutral API already has`,
            "Add only members the neutral API lacks; use map to change how an existing one maps.",
          );
        }
      }
      for (const [path, omission] of Object.entries(extension.omit ?? {})) {
        const instead = omission.instead;
        if (instead !== undefined && !hasMember(spec, instead) && !added.includes(instead)) {
          findings.add(
            [...at, "omit", path, "instead"],
            `extensions.${adapter}.omit.${path} names ${instead} instead, which is neither in the neutral API nor added`,
            `Name a member the spec declares, or one extensions.${adapter}.add adds.`,
          );
        }
      }
      if (adapter === inputs.adapter?.id) {
        const schema = inputs.adapter.extensionSchema;
        if (extension.options !== undefined) {
          if (schema.options === undefined) {
            findings.add(
              [...at, "options"],
              `the ${adapter} adapter takes no options`,
              `Remove extensions.${adapter}.options.`,
            );
          } else {
            for (const problem of validateWithJsonSchema(schema.options, extension.options)) {
              findings.add(
                [...at, "options", ...problem.segments, ...(problem.key === undefined ? [] : [problem.key])],
                `extensions.${adapter}.options${problem.path.slice(1)}: ${problem.message}`,
              );
            }
          }
        }
        for (const [path, value] of Object.entries(extension.map ?? {})) {
          for (const problem of validateWithJsonSchema(schema.map, value)) {
            findings.add(
              [...at, "map", path, ...problem.segments, ...(problem.key === undefined ? [] : [problem.key])],
              `extensions.${adapter}.map.${path}${problem.path.slice(1)}: ${problem.message}`,
            );
          }
        }
      }
    }
    return findings.list;
  },
};

/** Something `spec check` reports that isn't a finding: it doesn't fail the spec. */
export interface SpecNote {
  readonly file: string;
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

/**
 * SPEC-013's notes: each extensions block for an adapter other than the consumer's, whose
 * `options` and `map` values no adapter schema checked. None without the consumer's adapter.
 */
export function extensionNotes(file: ValidSpecFile, inputs: SpecCheckInputs): SpecNote[] {
  const used = inputs.adapter?.id;
  if (used === undefined) return [];
  return Object.keys(file.spec.extensions ?? {})
    .filter((adapter) => adapter !== used)
    .map((adapter) => {
      const line = lineAt(file, ["extensions", adapter]);
      return {
        file: file.file,
        path: `$.extensions.${adapter}`,
        ...(line === undefined ? {} : { line }),
        message: `extensions.${adapter} is for an adapter this repository doesn't use (it uses ${used}): its paths were checked, its options and map values weren't`,
      };
    });
}
