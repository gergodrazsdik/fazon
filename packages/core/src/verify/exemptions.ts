// SPDX-License-Identifier: GPL-3.0-or-later
// Spec exemptions applied to findings (docs/spec/check-catalogue.md#exemptions,
// docs/spec/spec-format.md#exemptions): a waived finding stays, marked exempt and not blocking; an
// exemption that waived nothing is listed as unused.
import { conditionHolds } from "../checks/tokens.js";
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { StoryManifest } from "../matrix/types.js";
import type { PropValues } from "../spec/types.js";
import type { VerifyComponent } from "./components.js";

const sourceChecks: ReadonlySet<CheckId> = new Set(["build", "lint", "test", "package"]);

/** The component a finding concerns: by its story's name, or by its file: its spec, or one in its directory. */
export function findingComponent(
  finding: Pick<CheckFinding, "story" | "file">,
  components: readonly Pick<VerifyComponent, "name" | "directory" | "specFile">[],
): string | undefined {
  if (finding.story !== undefined) {
    return components.find((c) => finding.story?.startsWith(`${c.name}--`) === true)?.name;
  }
  if (finding.file !== undefined) {
    return components.find(
      (c) =>
        finding.file === c.specFile ||
        finding.file === c.directory ||
        finding.file?.startsWith(`${c.directory}/`) === true,
    )?.name;
  }
  return undefined;
}

/** An exemption that waived nothing in the run. */
export interface UnusedExemption {
  readonly component: string;
  /** Its index in the spec's `exemptions`. */
  readonly index: number;
  readonly check: string;
  readonly rule: string;
  readonly reason: string;
}

export interface ExemptionsResult {
  readonly findings: CheckFinding[];
  readonly unused: UnusedExemption[];
}

/**
 * Marks each finding an exemption of its component's spec waives: same check and rule, and for a
 * rendered check, the finding's part, its story's fixture, and the story's prop values and state
 * match everything the exemption names. `visual` findings are never waived.
 * @param props the root's prop values in a story, for `when`
 */
export function applyExemptions(
  findings: readonly CheckFinding[],
  components: readonly VerifyComponent[],
  props: (component: VerifyComponent, story: StoryManifest["stories"][number]) => PropValues = () => ({}),
): ExemptionsResult {
  const used = new Set<string>();
  const result = findings.map((finding) => {
    if (finding.check === "visual") return finding;
    const name = findingComponent(finding, components);
    const component = components.find((c) => c.name === name);
    const exemptions = component?.spec.exemptions ?? [];
    const index = exemptions.findIndex((exemption) => {
      if (exemption.check !== finding.check || exemption.rule !== finding.rule) return false;
      if (sourceChecks.has(finding.check)) return true;
      if (exemption.part !== undefined && exemption.part !== finding.part) return false;
      if (exemption.fixture === undefined && exemption.when === undefined) return true;
      const story = component?.manifest?.stories.find((s) => s.name === finding.story);
      if (story === undefined || component === undefined) return false;
      if (exemption.fixture !== undefined && exemption.fixture !== story.fixture) return false;
      return conditionHolds(
        exemption.when,
        props(component, story),
        story.state.name === "default" ? [] : [story.state.name],
      );
    });
    if (index === -1 || component === undefined) return finding;
    used.add(`${component.name}\u0000${String(index)}`);
    return { ...finding, exempt: index, blocking: false };
  });
  const unused: UnusedExemption[] = [];
  for (const component of components) {
    (component.spec.exemptions ?? []).forEach((exemption, index) => {
      if (used.has(`${component.name}\u0000${String(index)}`)) return;
      unused.push({
        component: component.name,
        index,
        check: exemption.check,
        rule: exemption.rule,
        reason: exemption.reason,
      });
    });
  }
  return { findings: result, unused };
}
