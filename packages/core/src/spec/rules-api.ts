// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-003 to SPEC-008 (docs/spec/spec-format.md#validation): the body's headings, defaults,
// parts, member names, references between fields, and `uses`.
import { levelTwoHeadings } from "./body.js";
import { kebabCase } from "./names.js";
import type { SpecRule } from "./rules.js";
import { Findings, hasPart, own, scopes, show, typeProblem } from "./scope.js";
import { contentNodes, extensionProps } from "./walk.js";
import type { NameSource, Prop } from "./types.js";

/** The headings every body has, with what each section holds. */
const requiredHeadings: readonly (readonly [string, string])[] = [
  ["Purpose", "what the component is for and when to use it"],
  ["Behaviour", "how it responds to input, as a list"],
  ["Never", "uses and looks that are wrong, as a list"],
];

export const spec003: SpecRule = {
  id: "SPEC-003",
  check: (file) => {
    const findings = new Findings("SPEC-003", file);
    const headings = levelTwoHeadings(file.body, file.bodyLine);
    for (const [heading, content] of requiredHeadings) {
      if (headings.has(heading)) continue;
      findings.addAtLine(
        file.bodyLine,
        `the body has no '## ${heading}' heading`,
        `Add a '## ${heading}' section: ${content}.`,
      );
    }
    return findings.list;
  },
};

export const spec004: SpecRule = {
  id: "SPEC-004",
  check: (file) => {
    const findings = new Findings("SPEC-004", file);
    const props: { segments: (string | number)[]; prop: Prop; name: string }[] = [];
    for (const scope of scopes(file.spec)) {
      for (const [name, prop] of Object.entries(scope.definition.props ?? {})) {
        props.push({ segments: [...scope.segments, "props", name], prop, name });
      }
    }
    props.push(...extensionProps(file.spec));
    for (const { segments, prop, name } of props) {
      if (prop.default === undefined) continue;
      if (prop.type === "enum" && !prop.values.includes(prop.default)) {
        findings.add(
          [...segments, "default"],
          `the default of ${name}, ${show(prop.default)}, isn't one of its values: ${prop.values.join(", ")}`,
          "Make the default one of the values, or add it to them.",
        );
      }
      if (prop.type === "array") {
        const problem = typeProblem(prop, prop.default);
        if (problem !== undefined) {
          findings.add(
            [...segments, "default"],
            `the default of ${name} ${problem}`,
            "Give the default items of the prop's items type.",
          );
        }
      }
    }
    return findings.list;
  },
};

export const spec005: SpecRule = {
  id: "SPEC-005",
  check: ({ spec, ...file }) => {
    const findings = new Findings("SPEC-005", file);
    const parts = spec.parts ?? {};
    const reported = new Set<string>();
    for (const [name, part] of Object.entries(parts)) {
      if (name === spec.name) {
        findings.add(
          ["parts", name],
          `the part ${name} has the component's name`,
          "Name the part for its role, such as Trigger or Content.",
        );
      }
      const parent = own(parts, part.parent);
      if (part.parent !== spec.name && parent === undefined) {
        findings.add(
          ["parts", name, "parent"],
          `the parent of ${name}, ${part.parent}, is neither the component ${spec.name} nor one of its parts`,
          `Set parent to ${spec.name} or to the part that holds ${name}.`,
        );
        continue;
      }
      if (parent !== undefined && part.count === "many" && parent.count === "many") {
        findings.add(
          ["parts", name, "parent"],
          `${name} and its parent ${part.parent} are both 'many' parts; in format version 0 a 'many' part can't hold another (F-0006)`,
          `Make ${name} or ${part.parent} 'one' or 'optional'.`,
        );
      }
      // Follow the parents from this part: a part met twice closes a cycle.
      const chain = [name];
      let current = part.parent;
      while (current !== spec.name) {
        const next = own(parts, current);
        if (next === undefined) break;
        const start = chain.indexOf(current);
        if (start !== -1) {
          const cycle = chain.slice(start);
          const key = [...cycle].sort().join(" ");
          if (!reported.has(key)) {
            reported.add(key);
            findings.add(
              ["parts", current, "parent"],
              `the parts' parents form a cycle: ${[...cycle, current].join(" → ")}`,
              `Make one of them a child of ${spec.name}.`,
            );
          }
          break;
        }
        chain.push(current);
        current = next.parent;
      }
    }
    return findings.list;
  },
};

export const spec006: SpecRule = {
  id: "SPEC-006",
  check: (file) => {
    const findings = new Findings("SPEC-006", file);
    for (const scope of scopes(file.spec)) {
      const seen = new Map<string, string>();
      for (const kind of ["props", "events", "methods"] as const) {
        for (const name of Object.keys(scope.definition[kind] ?? {})) {
          const earlier = seen.get(name);
          const singular = kind.slice(0, -1);
          if (earlier !== undefined) {
            findings.add(
              [...scope.segments, kind, name],
              `${scope.name} has both a ${earlier} and ${singular === "event" ? "an" : "a"} ${singular} named ${name}`,
              "Give each prop, event and method its own name.",
            );
          } else {
            seen.set(name, singular);
          }
        }
      }
    }
    return findings.list;
  },
};

export const spec007: SpecRule = {
  id: "SPEC-007",
  check: ({ spec, ...file }) => {
    const findings = new Findings("SPEC-007", file);
    if (spec.forward !== undefined && spec.forward !== "root" && !hasPart(spec, spec.forward)) {
      findings.add(
        ["forward"],
        `forward names ${spec.forward}, which is neither root nor a part`,
        "Name root, or one of the parts.",
      );
    }
    if (spec.form !== undefined) {
      for (const field of ["value", "name", "disabled", "required"] as const) {
        const name = spec.form[field];
        if (name === undefined) continue;
        const prop = own(spec.props, name);
        if (prop === undefined) {
          findings.add(
            ["form", field],
            `form.${field} names ${name}, which isn't a prop of ${spec.name}`,
            "Name a prop of the component.",
          );
        } else if (field === "value" && prop.model !== true) {
          findings.add(
            ["form", field],
            `form.value names ${name}, which isn't a model prop`,
            `Set model: true on ${name}: the submitted value is two-way bound.`,
          );
        }
      }
    }
    for (const scope of scopes(spec)) {
      const a11y = scope.definition.a11y;
      if (a11y === undefined) continue;
      const at = [...scope.segments, "a11y"];
      const source = (field: "name" | "describedBy", value: NameSource | undefined) => {
        if (value?.startsWith("prop:") === true) {
          const prop = value.slice("prop:".length);
          if (own(scope.definition.props, prop) === undefined) {
            findings.add(
              [...at, field],
              `a11y.${field} names the prop ${prop}, which ${scope.name} doesn't have`,
              `Name a prop of ${scope.name}.`,
            );
          }
        } else if (value?.startsWith("part:") === true) {
          const part = value.slice("part:".length);
          if (!hasPart(spec, part)) {
            findings.add(
              [...at, field],
              `a11y.${field} names the part ${part}, which ${spec.name} doesn't have`,
              "Name one of the parts.",
            );
          }
        }
      };
      source("name", a11y.name);
      source("describedBy", a11y.describedBy);
      for (const field of ["roving", "initial"] as const) {
        const part = a11y.focus?.[field];
        if (part !== undefined && !hasPart(spec, part)) {
          findings.add(
            [...at, "focus", field],
            `a11y.focus.${field} names the part ${part}, which ${spec.name} doesn't have`,
            "Name one of the parts.",
          );
        }
      }
    }
    return findings.list;
  },
};

export const spec008: SpecRule = {
  id: "SPEC-008",
  check: ({ spec, ...file }, all) => {
    const findings = new Findings("SPEC-008", file);
    const uses = spec.uses ?? [];
    uses.forEach((name, index) => {
      const exists = all.some((other) =>
        other.spec === undefined ? other.component === kebabCase(name) : other.spec.name === name,
      );
      if (!exists) {
        findings.add(
          ["uses", index],
          `uses names ${name}, which has no spec`,
          `Write its spec, ${kebabCase(name)}.md in the specs directory, or remove ${name} from uses.`,
        );
      }
    });
    for (const { node, segments } of contentNodes(spec)) {
      if (typeof node === "object" && "component" in node && !uses.includes(node.component)) {
        findings.add(
          [...segments, "component"],
          `the fixture renders ${node.component}, which uses doesn't list`,
          `Add ${node.component} to uses.`,
        );
      }
    }
    return findings.list;
  },
};
