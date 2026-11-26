// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-011, SPEC-012, SPEC-014 and SPEC-018 (docs/spec/spec-format.md#validation): token rules,
// exemptions, conditions and judge questions.
import { isDeepStrictEqual } from "node:util";
import { buildManifest } from "../matrix/build.js";
import type { Story, StoryManifest } from "../matrix/types.js";
import type { PathSegment } from "../validation/validate.js";
import { catalogueRule, checkCatalogue, isCheckId } from "./catalogue.js";
import type { SpecRule } from "./rules.js";
import { conditionProblems, Findings, hasPart, own, propOf } from "./scope.js";
import type { ComponentName, KebabName, PropValue, Spec, When } from "./types.js";

/** Every condition of a spec, with its part and where it is: token rules', exemptions', judge questions' and `matrix.exclude`'s. */
function conditions(spec: Spec) {
  const list: {
    condition: { readonly props?: Readonly<Record<string, PropValue>>; readonly state?: KebabName };
    part: ComponentName | undefined;
    segments: PathSegment[];
    partProps: boolean;
  }[] = [];
  (spec.tokens ?? []).forEach((rule, index) => {
    if (rule.when !== undefined)
      list.push({ condition: rule.when, part: rule.part, segments: ["tokens", index, "when"], partProps: false });
  });
  (spec.exemptions ?? []).forEach((exemption, index) => {
    // A source check's exemption names no condition at all: SPEC-012 reports one.
    const source = isCheckId(exemption.check) && checkCatalogue[exemption.check].kind === "source";
    if (exemption.when !== undefined && !source) {
      list.push({
        condition: exemption.when,
        part: exemption.part,
        segments: ["exemptions", index, "when"],
        partProps: false,
      });
    }
  });
  (spec.judge ?? []).forEach((question, index) => {
    const when = question.select?.when;
    if (when !== undefined) {
      list.push({
        condition: when,
        part: question.select?.part,
        segments: ["judge", index, "select", "when"],
        partProps: false,
      });
    }
  });
  (spec.matrix?.exclude ?? []).forEach((condition, index) => {
    list.push({ condition, part: condition.part, segments: ["matrix", "exclude", index], partProps: true });
  });
  return list;
}

export const spec014: SpecRule = {
  id: "SPEC-014",
  check: (file) => {
    const findings = new Findings("SPEC-014", file);
    for (const { condition, part, segments, partProps } of conditions(file.spec)) {
      // A condition of a part the spec doesn't have is the owning rule's finding.
      if (part !== undefined && !hasPart(file.spec, part)) continue;
      for (const problem of conditionProblems(file.spec, condition, part, segments, partProps)) {
        findings.add(problem.segments, problem.message, problem.hint);
      }
    }
    return findings.list;
  },
};

/** A condition as a key: equal conditions give equal keys, whatever the order of their props. */
function conditionKey(when: When | undefined): string {
  const props = Object.entries(when?.props ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([props, when?.state ?? null]);
}

export const spec011: SpecRule = {
  id: "SPEC-011",
  check: (file, _all, inputs) => {
    const { spec } = file;
    const findings = new Findings("SPEC-011", file);
    const set = new Map<string, number>();
    (spec.tokens ?? []).forEach((rule, index) => {
      const at: PathSegment[] = ["tokens", index];
      if (rule.part !== undefined && !hasPart(spec, rule.part)) {
        findings.add([...at, "part"], `the token rule names the part ${rule.part}, which ${spec.name} doesn't have`);
      }
      for (const [property, token] of Object.entries(rule.use)) {
        const where = [...at, "use", property];
        if (inputs.tokens !== undefined) {
          if (!inputs.tokens.paths.has(token)) {
            findings.add(
              where,
              `${property} uses ${token}, which isn't in the token set`,
              "Name a role token of the token set.",
            );
          } else if (!inputs.tokens.roles.has(token)) {
            findings.add(
              where,
              `${property} uses ${token}, which is a raw token`,
              "Specs name role tokens only: name the role token that refers to it.",
            );
          }
        }
        const key = JSON.stringify([rule.part ?? null, conditionKey(rule.when), property]);
        const earlier = set.get(key);
        if (earlier !== undefined) {
          findings.add(
            where,
            `token rules ${String(earlier)} and ${String(index)} both set ${property} for the same part and condition`,
            "Keep one of them, or make their conditions differ.",
          );
        } else {
          set.set(key, index);
        }
      }
    });
    return findings.list;
  },
};

export const spec012: SpecRule = {
  id: "SPEC-012",
  check: (file) => {
    const { spec } = file;
    const findings = new Findings("SPEC-012", file);
    (spec.exemptions ?? []).forEach((exemption, index) => {
      const at: PathSegment[] = ["exemptions", index];
      if (!isCheckId(exemption.check)) {
        findings.add(
          [...at, "check"],
          `the exemption names the check ${exemption.check}, which the check catalogue doesn't have`,
          `Name one of: ${Object.keys(checkCatalogue).join(", ")}.`,
        );
        return;
      }
      const { kind, rules } = checkCatalogue[exemption.check];
      const exemptable = catalogueRule(exemption.check, exemption.rule);
      if (exemptable === undefined) {
        findings.add(
          [...at, "rule"],
          `the check ${exemption.check} has no rule ${exemption.rule}`,
          `Name one of its rules: ${Object.keys(rules).join(", ")}${exemption.check === "a11y" ? ", or the ID of an axe rule the check runs" : ""}.`,
        );
      } else if (!exemptable) {
        findings.add(
          [...at, "rule"],
          `the ${exemption.check} rule ${exemption.rule} can't be exempted`,
          exemption.check === "visual"
            ? "No visual rule can be exempted: update the baseline instead."
            : "Change the code or the lint configuration instead.",
        );
      }
      if (kind === "source") {
        for (const field of ["part", "fixture", "when"] as const) {
          if (exemption[field] !== undefined) {
            findings.add(
              [...at, field],
              `the exemption of the source check ${exemption.check} names a ${field}; a source check's exemption applies to all of the component's files`,
              `Remove ${field}.`,
            );
          }
        }
        return;
      }
      if (exemption.part !== undefined && !hasPart(spec, exemption.part)) {
        findings.add(
          [...at, "part"],
          `the exemption names the part ${exemption.part}, which ${spec.name} doesn't have`,
        );
      }
      if (exemption.fixture !== undefined && own(spec.fixtures, exemption.fixture) === undefined) {
        findings.add([...at, "fixture"], `the exemption names the fixture ${exemption.fixture}, which isn't a fixture`);
      }
    });
    return findings.list;
  },
};

/** The judge's own question names (docs/spec/judge.md#the-rubric): whole names, then prefixes. */
const derivedNames: readonly string[] = ["story", "reference", "family"];
const derivedPrefixes: readonly string[] = ["axis-", "state-", "appearance-", "change-"];

/** A prop's value in a story (docs/spec/story-matrix.md#exclusions): the story sets it, else its fixture, else its default. */
function valueIn(
  spec: Spec,
  manifest: StoryManifest,
  story: Story,
  part: ComponentName | undefined,
  prop: string,
): unknown {
  let value: unknown;
  for (const { target, props } of story.set ?? []) {
    const onTarget = part === undefined ? target === "root" : target.startsWith(`${part}[`);
    if (onTarget && Object.hasOwn(props, prop)) value = props[prop];
  }
  if (value !== undefined) return value;
  const fixture = own(manifest.fixtures, story.fixture);
  const props = part === undefined ? fixture?.props : own(fixture?.parts, part)?.[0]?.props;
  const set = own(props, prop);
  return set ?? propOf(spec, part, prop)?.default;
}

/** Whether a judge question's `select` picks a story: its fixture, and its condition on the part's (or the component's) props and state. */
function picks(
  spec: Spec,
  manifest: StoryManifest,
  story: Story,
  select: NonNullable<NonNullable<Spec["judge"]>[number]["select"]>,
): boolean {
  if (select.fixture !== undefined && story.fixture !== select.fixture) return false;
  const when = select.when;
  if (when?.state !== undefined) {
    if (
      when.state === "default"
        ? story.state.name !== "default"
        : story.state.name !== when.state || story.state.part !== select.part
    ) {
      return false;
    }
  }
  return Object.entries(when?.props ?? {}).every(([prop, expected]) =>
    isDeepStrictEqual(valueIn(spec, manifest, story, select.part, prop), expected),
  );
}

export const spec018: SpecRule = {
  id: "SPEC-018",
  check: (file) => {
    const { spec } = file;
    const findings = new Findings("SPEC-018", file);
    const seen = new Map<string, number>();
    let manifest: StoryManifest | null | undefined;
    const stories = () => {
      if (manifest === undefined) {
        try {
          manifest = buildManifest(spec, { file: file.file, themes: ["default"] });
        } catch {
          // A spec the story matrix rules can't expand breaks another rule, which reports it.
          manifest = null;
        }
      }
      return manifest;
    };
    (spec.judge ?? []).forEach((question, index) => {
      const at: PathSegment[] = ["judge", index];
      const earlier = seen.get(question.id);
      if (earlier !== undefined) {
        findings.add(
          [...at, "id"],
          `judge questions ${String(earlier)} and ${String(index)} share the id ${question.id}`,
          "Give each question its own id.",
        );
      } else {
        seen.set(question.id, index);
      }
      if (derivedNames.includes(question.id) || derivedPrefixes.some((prefix) => question.id.startsWith(prefix))) {
        findings.add(
          [...at, "id"],
          `the id ${question.id} is, or looks like, the name of a question the harness derives (story, axis-…, state-…, appearance-…, reference, family, change-…)`,
          "Choose an id that names what the question asks about.",
        );
      }
      const select = question.select;
      if (select === undefined) return;
      let valid = true;
      if (select.fixture !== undefined && own(spec.fixtures, select.fixture) === undefined) {
        findings.add([...at, "select", "fixture"], `select names the fixture ${select.fixture}, which isn't a fixture`);
        valid = false;
      }
      if (select.part !== undefined && !hasPart(spec, select.part)) {
        findings.add(
          [...at, "select", "part"],
          `select names the part ${select.part}, which ${spec.name} doesn't have`,
        );
        valid = false;
      }
      if (select.when !== undefined && conditionProblems(spec, select.when, select.part, []).length > 0) valid = false;
      if (!valid) return;
      const built = stories();
      if (built === null) return;
      if (!built.stories.some((story) => picks(spec, built, story, select))) {
        findings.add(
          [...at, "select"],
          `select picks none of ${spec.name}'s stories`,
          "Select a fixture, part and condition some story shows; a state whose recipe says 'story: false' is shown only by a matrix.include story.",
        );
      }
    });
    return findings.list;
  },
};
