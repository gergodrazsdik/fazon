// SPDX-License-Identifier: GPL-3.0-or-later
// Spec exemptions applied to findings (docs/spec/check-catalogue.md#exemptions,
// docs/spec/spec-format.md#exemptions): a waived finding stays, marked exempt and not blocking; an
// exemption that waived nothing is listed as unused.
import { conditionHolds } from "../checks/tokens.js";
import type { CheckFinding, CheckId } from "../checks/types.js";
import type { StoryManifest } from "../matrix/types.js";
import type { PropValues } from "../spec/types.js";
import { storyProps, type VerifyComponent } from "./components.js";

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

/** A rendered finding's part instance, as the render saw it: its position and its states. */
export interface FindingElement {
  /** Its position among the part's instances in the story, from 0. */
  readonly instance: number;
  /** Its reflected states and the pseudo-states that matched, as token rules see them. */
  readonly states: readonly string[];
}

/**
 * The instance of `part` that holds a rendered finding's element in its story and theme: the
 * nearest ancestor-or-self that is that part's root. Undefined when the render didn't record the
 * element, as for a finding about all of a component's stories.
 */
export type FindingElements = (finding: CheckFinding, part: string) => FindingElement | undefined;

type ManifestStory = StoryManifest["stories"][number];

/** The states a story shows on a part, from its manifest: its state, when the state is the part's. */
function declaredStates(component: VerifyComponent, story: ManifestStory, part: string): string[] {
  const owner = story.state.part ?? component.spec.name;
  return owner === part && story.state.name !== "default" ? [story.state.name] : [];
}

/**
 * The props and states an exemption's `when` is compared with (docs/spec/spec-format.md#conditions):
 * those of the part it names, or of the component's root when it names none, in the finding's
 * story. The part's instance and states are those of the finding's element when the render
 * recorded it, as token rules use them; otherwise the first instance, and the state the story's
 * manifest sets on the part.
 */
function conditionSubject(
  component: VerifyComponent,
  story: ManifestStory,
  finding: CheckFinding,
  part: string,
  elements: FindingElements | undefined,
): { props: PropValues; states: readonly string[] } {
  const element = elements?.(finding, part);
  const props =
    component.manifest === undefined
      ? {}
      : storyProps(component.spec, component.manifest, story)(part, element?.instance ?? 0);
  return { props, states: element?.states ?? declaredStates(component, story, part) };
}

export interface ExemptionsResult {
  readonly findings: CheckFinding[];
  readonly unused: UnusedExemption[];
}

/**
 * Marks each finding an exemption of its component's spec waives: same check and rule, and for a
 * rendered check, the finding's part, its story's fixture, and the props and states of the part
 * the exemption names (the root when it names none) match everything the exemption names.
 * `visual` findings are never waived.
 * @param elements the rendered findings' part instances, from the rendered checks
 */
export function applyExemptions(
  findings: readonly CheckFinding[],
  components: readonly VerifyComponent[],
  elements?: FindingElements,
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
      if (exemption.when === undefined) return true;
      const subject = conditionSubject(component, story, finding, exemption.part ?? component.spec.name, elements);
      return conditionHolds(exemption.when, subject.props, subject.states);
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
