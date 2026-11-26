// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-010 and SPEC-015 to SPEC-017 (docs/spec/spec-format.md#validation): the matrix hooks, and
// how states are produced. The story matrix rules (packages/core/src/matrix/) expand the spec;
// SPEC-017's check for forced stories a grid already makes, or an exclusion drops, is theirs.
import { buildManifest, pseudoStates } from "../matrix/build.js";
import { MatrixError } from "../matrix/error.js";
import type { PathSegment } from "../validation/validate.js";
import { checkProps } from "./rules-fixtures.js";
import type { SpecRule } from "./rules.js";
import {
  Findings,
  hasPart,
  instanceCount,
  listsState,
  mergedFixture,
  own,
  propOf,
  scopeOf,
  scopes,
  show,
  splitKey,
  stateFixtures,
} from "./scope.js";
import type { Spec } from "./types.js";

/** The values an axis takes, or undefined when it names no enum or boolean prop. */
function axisValues(spec: Spec, key: string): readonly (string | boolean)[] | undefined {
  const { part, prop } = splitKey(key);
  if (part !== undefined && !hasPart(spec, part)) return undefined;
  const definition = propOf(spec, part, prop);
  if (definition?.type === "enum") return definition.values;
  if (definition?.type === "boolean") return [false, true];
  return undefined;
}

export const spec010: SpecRule = {
  id: "SPEC-010",
  check: (file) => {
    const { spec } = file;
    const findings = new Findings("SPEC-010", file);
    const matrix = spec.matrix;
    if (matrix === undefined) return [];
    (matrix.axes ?? []).forEach((key, index) => {
      const at = ["matrix", "axes", index];
      const { part, prop } = splitKey(key);
      if (part !== undefined && !hasPart(spec, part)) {
        findings.add(at, `the axis ${key} names the part ${part}, which ${spec.name} doesn't have`);
        return;
      }
      const definition = propOf(spec, part, prop);
      if (definition === undefined) {
        findings.add(
          at,
          `the axis ${key} names no prop of ${part ?? spec.name}`,
          "Name an enum or boolean prop, as <prop> or <Part>.<prop>.",
        );
      } else if (definition.type !== "enum" && definition.type !== "boolean") {
        findings.add(at, `the axis ${key} is a ${definition.type} prop; an axis is an enum or a boolean`);
      }
    });
    (matrix.fixtures ?? []).forEach((name, index) => {
      if (own(spec.fixtures, name) === undefined) {
        findings.add(["matrix", "fixtures", index], `matrix.fixtures names ${name}, which isn't a fixture`);
      }
    });
    (matrix.exclude ?? []).forEach((condition, index) => {
      if (condition.part !== undefined && !hasPart(spec, condition.part)) {
        findings.add(
          ["matrix", "exclude", index, "part"],
          `matrix.exclude[${String(index)}] names the part ${condition.part}, which ${spec.name} doesn't have`,
        );
      }
    });
    return findings.list;
  },
};

export const spec015: SpecRule = {
  id: "SPEC-015",
  check: (file) => {
    const findings = new Findings("SPEC-015", file);
    for (const scope of scopes(file.spec)) {
      (scope.definition.states ?? []).forEach((state, index) => {
        if (state === "default") return;
        const recipe = own(scope.definition.produce, state);
        if (recipe?.props !== undefined || recipe?.input !== undefined || recipe?.story === false) return;
        if (own(scope.definition.props, state)?.type === "boolean") return;
        if (Object.hasOwn(pseudoStates, state)) return;
        findings.add(
          [...scope.segments, "states", index],
          `the state ${state} of ${scope.name} can't be produced: it has no recipe with props or input, no boolean prop of its name, and isn't hover, focus-visible or active`,
          `Add a recipe under produce.${state}, or 'story: false' when the fixtures already show it.`,
        );
      });
    }
    return findings.list;
  },
};

export const spec016: SpecRule = {
  id: "SPEC-016",
  check: (file) => {
    const { spec } = file;
    const findings = new Findings("SPEC-016", file);
    for (const scope of scopes(spec)) {
      for (const [state, recipe] of Object.entries(scope.definition.produce ?? {})) {
        const at: PathSegment[] = [...scope.segments, "produce", state];
        if (!(scope.definition.states ?? []).includes(state)) {
          findings.add(
            at,
            `produce has a recipe for ${state}, which ${scope.name} doesn't list in its states`,
            `Add ${state} to the states of ${scope.name}, or remove the recipe.`,
          );
        }
        // A recipe's props exist and fit their types, as a fixture's do (SPEC-009).
        checkProps(findings, scope.definition, scope.name, recipe.props, at);
        // The fixtures the state's stories render, merged; those that can't be merged fail SPEC-009.
        const fixtures = stateFixtures(spec, state, scope.part).flatMap((name) => {
          const fixture = mergedFixture(spec, name);
          return fixture === undefined ? [] : [[name, fixture] as const];
        });
        const below = (part: string, index: number, segments: PathSegment[], what: string) => {
          for (const [name, fixture] of fixtures) {
            const count = instanceCount(fixture, part);
            if (index >= count) {
              findings.add(
                segments,
                `${what} ${part}[${String(index)}], but the fixture ${name}, which the stories of ${state} render, has ${String(count)} ${count === 1 ? "instance" : "instances"} of ${part}`,
              );
            }
          }
        };
        (recipe.input ?? []).forEach((step, index) => {
          if (step.action === "press") return;
          const match = /^([A-Z][A-Za-z0-9]*)(?:\[([0-9]+)\])?$/.exec(step.target);
          if (match === null) return;
          const part = match[1] ?? "";
          const segments = [...at, "input", index, "target"];
          if (!hasPart(spec, part)) {
            findings.add(segments, `the input target ${step.target} names no part of ${spec.name}`);
            return;
          }
          below(part, match[2] === undefined ? 0 : Number(match[2]), segments, "the input targets");
        });
        if (recipe.instance !== undefined) {
          if (scope.part === undefined) {
            findings.add(
              [...at, "instance"],
              `the recipe for ${state} sets instance, but ${state} is a state of the component, not of a part`,
              "Remove instance: a state of the component applies to its root.",
            );
          } else {
            below(scope.part, recipe.instance, [...at, "instance"], "instance names");
          }
        }
      }
    }
    return findings.list;
  },
};

export const spec017: SpecRule = {
  id: "SPEC-017",
  check: (file) => {
    const { spec } = file;
    const findings = new Findings("SPEC-017", file);
    const include = spec.matrix?.include ?? [];
    const axes = spec.matrix?.axes ?? [];
    include.forEach((point, index) => {
      const at: PathSegment[] = ["matrix", "include", index];
      if (point.fixture !== undefined && own(spec.fixtures, point.fixture) === undefined) {
        findings.add(
          [...at, "fixture"],
          `matrix.include[${String(index)}] names ${point.fixture}, which isn't a fixture`,
        );
      }
      for (const [key, value] of Object.entries(point.props ?? {})) {
        if (!axes.includes(key)) {
          findings.add(
            [...at, "props", key],
            `matrix.include[${String(index)}] sets ${key}, which isn't an axis`,
            `Set only the axes: ${axes.join(", ") || "the matrix has none"}.`,
          );
          continue;
        }
        const values = axisValues(spec, key);
        if (values !== undefined && !values.includes(value as string | boolean)) {
          findings.add(
            [...at, "props", key],
            `matrix.include[${String(index)}] sets ${key} to ${show(value)}, which isn't one of its values: ${values.map(String).join(", ")}`,
          );
        }
      }
      if (point.part !== undefined && !hasPart(spec, point.part)) {
        findings.add(
          [...at, "part"],
          `matrix.include[${String(index)}] names the part ${point.part}, which ${spec.name} doesn't have`,
        );
      } else if (point.state !== undefined) {
        const scope = scopeOf(spec, point.part);
        if (scope !== undefined && !listsState(scope, point.state)) {
          findings.add(
            [...at, "state"],
            `matrix.include[${String(index)}] names the state ${point.state}, which ${point.part ?? spec.name} doesn't list`,
          );
        }
      }
    });
    if (include.length === 0 || findings.list.length > 0) return findings.list;
    // Whether a grid already makes a forced story, or an exclusion drops it: the expansion tells.
    // A spec it can't expand for another reason breaks another rule, which reports it.
    try {
      buildManifest(spec, { file: file.file, themes: ["default"] });
    } catch (error) {
      if (error instanceof MatrixError && error.rule === "SPEC-017") {
        findings.add(error.segments, error.message, "Remove the entry, or change it to a story the grids don't make.");
      } else if (!(error instanceof MatrixError)) {
        throw error;
      }
    }
    return findings.list;
  },
};
