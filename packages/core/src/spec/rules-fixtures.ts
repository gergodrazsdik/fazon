// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-009 (docs/spec/spec-format.md#validation): fixtures.
import type { PathSegment } from "../validation/validate.js";
import type { SpecFile } from "./load.js";
import type { SpecRule } from "./rules.js";
import { Findings, mergedFixture, own, show, typeProblem } from "./scope.js";
import type { Api, ComponentName, PropValues, SlotContent, Spec } from "./types.js";
import { slotNodes } from "./walk.js";

export const spec009: SpecRule = {
  id: "SPEC-009",
  check: (file, all, inputs) => {
    const { spec } = file;
    const findings = new Findings("SPEC-009", file);
    const fixtures = spec.fixtures ?? {};
    const specs = new Map(
      all.flatMap((other: SpecFile) => (other.spec === undefined ? [] : [[other.spec.name, other.spec]])),
    );

    // extends: an existing fixture, with no cycles.
    const broken = new Set<string>();
    const cycles = new Set<string>();
    for (const [name, fixture] of Object.entries(fixtures)) {
      if (fixture.extends === undefined) continue;
      if (own(fixtures, fixture.extends) === undefined) {
        findings.add(
          ["fixtures", name, "extends"],
          `the fixture ${name} extends ${fixture.extends}, which isn't a fixture`,
          "Name another fixture of the spec.",
        );
        broken.add(name);
        continue;
      }
      const chain = [name];
      let current: string | undefined = fixture.extends;
      while (current !== undefined) {
        const start = chain.indexOf(current);
        if (start !== -1) {
          const cycle = chain.slice(start);
          const key = [...cycle].sort().join(" ");
          if (!cycles.has(key)) {
            cycles.add(key);
            findings.add(
              ["fixtures", current, "extends"],
              `the fixtures extend each other in a cycle: ${[...cycle, current].join(" → ")}`,
              "Make one of them extend no fixture.",
            );
          }
          broken.add(name);
          break;
        }
        chain.push(current);
        const base: string | undefined = own(fixtures, current)?.extends;
        if (base !== undefined && own(fixtures, base) === undefined) {
          // Reported for the fixture that names it.
          broken.add(name);
          break;
        }
        current = base;
      }
    }

    // What each fixture sets itself: props, slots and parts that exist, with values that fit.
    const settings = new Settings(findings, specs, inputs.icons);
    for (const [name, fixture] of Object.entries(fixtures)) {
      const at: PathSegment[] = ["fixtures", name];
      settings.check(spec, spec.name, fixture.props, fixture.slots, at);
      for (const [part, instances] of Object.entries(fixture.parts ?? {})) {
        const definition = own(spec.parts, part);
        if (definition === undefined) {
          findings.add(
            [...at, "parts", part],
            `the fixture ${name} sets instances of ${part}, which isn't a part of ${spec.name}`,
          );
          continue;
        }
        instances.forEach((instance, index) => {
          settings.check(definition, part, instance.props, instance.slots, [...at, "parts", part, index], true);
        });
      }
    }

    // After merging: the component's required props and slots, and each part's number of
    // instances. A spec without fixtures isn't checked here: its fixtures come after the API's
    // approval (docs/spec/spec-format.md#validation).
    for (const name of Object.keys(fixtures).filter((fixture) => !broken.has(fixture))) {
      const fixture = mergedFixture(spec, name);
      if (fixture === undefined) continue;
      const at: PathSegment[] = ["fixtures", name];
      for (const missing of requiredMissing(spec, fixture.props, fixture.slots)) {
        findings.add(
          at,
          `the fixture ${name} doesn't set ${missing}, which ${spec.name} requires`,
          "Set it in the fixture, or in the fixture it extends.",
        );
      }
      for (const [part, definition] of Object.entries(spec.parts ?? {})) {
        const count = own(fixture.parts, part)?.length ?? 0;
        const parents =
          definition.parent === spec.name
            ? 1
            : own(spec.parts, definition.parent) === undefined
              ? undefined
              : (own(fixture.parts, definition.parent)?.length ?? 0);
        if (parents === undefined) continue;
        let expected: string | undefined;
        if (definition.count === "one" && count !== parents) {
          expected = `exactly one for each instance of its parent: ${String(parents)}`;
        } else if (definition.count === "optional" && count > parents) {
          expected = `at most one for each instance of its parent: ${String(parents)}`;
        } else if (definition.count === "many" && parents === 0 && count > 0) {
          expected = `none, as its parent ${definition.parent} has no instance`;
        }
        if (expected === undefined) continue;
        findings.add(
          [...at, ...(own(fixture.parts, part) === undefined ? [] : ["parts", part])],
          `the fixture ${name} has ${String(count)} ${count === 1 ? "instance" : "instances"} of ${part}, whose count is ${definition.count}; it needs ${expected}`,
          definition.count === "one"
            ? `List one ${part} instance for each instance of its parent, even one that sets nothing ('- {}').`
            : undefined,
        );
      }
    }
    return findings.list;
  },
};

/** The required props and slots of an API that values and content don't set, as `the prop x`. */
function requiredMissing(api: Api, props: PropValues | undefined, slots: SlotContent | undefined): string[] {
  const missing: string[] = [];
  for (const [name, prop] of Object.entries(api.props ?? {})) {
    if (prop.required === true && own(props, name) === undefined) missing.push(`the prop ${name}`);
  }
  for (const [name, slot] of Object.entries(api.slots ?? {})) {
    if (slot.required === true && own(slots, name) === undefined) missing.push(`the slot ${name}`);
  }
  return missing;
}

/** Checks the props and slot content something sets: of the component, a part's instance, or a component node. */
class Settings {
  constructor(
    private readonly findings: Findings,
    private readonly specs: ReadonlyMap<ComponentName, Spec>,
    private readonly icons: ReadonlySet<string> | undefined,
  ) {}

  /**
   * @param api the props and slots of the component, part or used component the values are for
   * @param required whether to check that the required props and slots are set, as for a part's instance
   */
  check(
    api: Api,
    owner: ComponentName,
    props: PropValues | undefined,
    slots: SlotContent | undefined,
    at: readonly PathSegment[],
    required = false,
  ): void {
    for (const [name, value] of Object.entries(props ?? {})) {
      const prop = own(api.props, name);
      if (prop === undefined) {
        this.findings.add([...at, "props", name], `${owner} has no prop ${name}`, `Set only props ${owner} declares.`);
        continue;
      }
      const problem = typeProblem(prop, value);
      if (problem !== undefined) {
        this.findings.add(
          [...at, "props", name],
          `the prop ${name} of ${owner} is set to ${show(value)}, which ${problem}`,
        );
      }
    }
    for (const slot of Object.keys(slots ?? {})) {
      if (own(api.slots, slot) === undefined) {
        this.findings.add([...at, "slots", slot], `${owner} has no slot ${slot}`, `Fill only slots ${owner} declares.`);
      }
    }
    if (required) {
      for (const missing of requiredMissing(api, props, slots)) {
        this.findings.add(at, `${missing} of ${owner} isn't set, and ${owner} requires it`);
      }
    }
    // Every node of the content, those in component nodes' slots included.
    for (const { node, segments } of slotNodes(slots, [...at, "slots"])) {
      if (typeof node !== "object") continue;
      if ("icon" in node) {
        if (this.icons !== undefined && !this.icons.has(node.icon)) {
          this.findings.add(
            [...segments, "icon"],
            `the icon ${node.icon} isn't in the icon set`,
            "Name an icon of the set fazon.yaml's icons names (Lucide by default).",
          );
        }
      } else if ("component" in node) {
        const used = this.specs.get(node.component);
        if (used === undefined) continue;
        this.checkNode(used, node.props, node.slots, segments);
      }
    }
  }

  /** A component node's props and slots against the used component's spec; the caller walks its nested nodes. */
  private checkNode(
    used: Spec,
    props: PropValues | undefined,
    slots: SlotContent | undefined,
    at: readonly PathSegment[],
  ): void {
    for (const [name, value] of Object.entries(props ?? {})) {
      const prop = own(used.props, name);
      if (prop === undefined) {
        this.findings.add(
          [...at, "props", name],
          `${used.name} has no prop ${name}`,
          `Set only props ${used.name} declares.`,
        );
        continue;
      }
      const problem = typeProblem(prop, value);
      if (problem !== undefined) {
        this.findings.add(
          [...at, "props", name],
          `the prop ${name} of ${used.name} is set to ${show(value)}, which ${problem}`,
        );
      }
    }
    for (const slot of Object.keys(slots ?? {})) {
      if (own(used.slots, slot) === undefined) {
        this.findings.add(
          [...at, "slots", slot],
          `${used.name} has no slot ${slot}`,
          `Fill only slots ${used.name} declares.`,
        );
      }
    }
    for (const missing of requiredMissing(used, props, slots)) {
      this.findings.add(at, `${missing} of ${used.name} isn't set, and ${used.name} requires it`);
    }
  }
}
