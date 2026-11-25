// SPDX-License-Identifier: GPL-3.0-or-later
// The `a11y` check (docs/spec/check-catalogue.md#a11y): axe-core's WCAG rules on the component's
// elements, and the spec's accessibility fields compared with the rendered component.
import type { A11y, NameSource, PropValues } from "../spec/types.js";
import type { AxeOutcome, AxeRuleResult, InspectedElement } from "./snapshot.js";
import { locate, type CheckContext, type CheckFinding } from "./types.js";

/** The axe rule tags the check runs. */
export const axeTags: readonly string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Rules about a whole page, which don't apply to a story. */
export const axeRulesOff: readonly string[] = [
  "region",
  "landmark-one-main",
  "page-has-heading-one",
  "bypass",
  "document-title",
  "html-has-lang",
];

/** The options the page runner passes to `axe.run`. */
export function axeRunOptions(): Record<string, unknown> {
  return {
    runOnly: { type: "tag", values: [...axeTags] },
    rules: Object.fromEntries(axeRulesOff.map((id) => [id, { enabled: false }])),
    resultTypes: ["violations", "incomplete"],
    iframes: false,
  };
}

export interface AxeCheckResult {
  /** One finding per element per violated rule. */
  readonly findings: CheckFinding[];
  /** axe's undecided results, for the report: listed, never blocking. */
  readonly incomplete: CheckFinding[];
}

/** Turns axe's results into findings: violations fail, undecided results are listed apart. */
export function checkAxe(outcome: AxeOutcome, context: CheckContext = {}): AxeCheckResult {
  const toFindings = (results: readonly AxeRuleResult[], blocking: boolean): CheckFinding[] =>
    results.flatMap((result) =>
      result.nodes.map((node) => ({
        check: "a11y" as const,
        rule: result.id,
        message: `${result.help}. ${node.summary}`.trim(),
        ...locate(context),
        ...(node.part === undefined ? {} : { part: node.part }),
        selector: node.selector,
        blocking,
      })),
    );
  return { findings: toFindings(outcome.violations, true), incomplete: toFindings(outcome.incomplete, false) };
}

/** The accessibility fields of a spec: the component's and each part's. */
export interface A11ySpec {
  /** The component's name, its root's `data-part`. */
  readonly name: string;
  readonly a11y?: A11y;
  readonly parts?: Readonly<Record<string, { readonly a11y?: A11y }>>;
}

/** Each element name with its `a11y` block: the component, then its parts. */
export function a11yBlocks(spec: A11ySpec): [string, A11y][] {
  const blocks: [string, A11y][] = [];
  if (spec.a11y !== undefined) blocks.push([spec.name, spec.a11y]);
  for (const [part, definition] of Object.entries(spec.parts ?? {})) {
    if (definition.a11y !== undefined) blocks.push([part, definition.a11y]);
  }
  return blocks;
}

export interface SpecA11yInput {
  readonly spec: A11ySpec;
  readonly elements: readonly InspectedElement[];
  /** The props of a part's instance in this story (defaults included), for `prop:` sources. */
  readonly props?: (part: string, instance: number) => PropValues;
  readonly context?: CheckContext;
}

/**
 * The spec-driven rules `spec-role` and `spec-name` on one story: every rendered element of the
 * component and of each part with an `a11y` block has the role, and takes its name and description
 * from where the block says.
 */
export function checkSpecA11y(input: SpecA11yInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const [part, a11y] of a11yBlocks(input.spec)) {
    for (const element of input.elements.filter((e) => e.partRoot && e.part === part)) {
      const where = {
        check: "a11y" as const,
        ...locate(input.context ?? {}),
        part,
        selector: element.selector,
        blocking: true,
      };
      if (a11y.role !== undefined && element.role !== a11y.role) {
        findings.push({
          ...where,
          rule: "spec-role",
          message: `${part}'s computed role is ${element.role || "(none)"}; the spec says ${a11y.role}.`,
          expected: a11y.role,
          actual: element.role,
        });
      }
      const props = input.props?.(part, element.instance ?? 0) ?? {};
      if (a11y.name !== undefined) {
        const problem = nameProblem(a11y.name, element, props);
        if (problem !== undefined) {
          findings.push({
            ...where,
            rule: "spec-name",
            message: `${part}'s accessible name ${problem.actual}; the spec says it comes from ${problem.expected}.`,
            expected: problem.expected,
            actual: problem.actual,
          });
        }
      }
      if (a11y.describedBy !== undefined) {
        const problem = descriptionProblem(a11y.describedBy, element, props);
        if (problem !== undefined) {
          findings.push({
            ...where,
            rule: "spec-name",
            message: `${part}'s accessible description ${problem.actual}; the spec says it comes from ${problem.expected}.`,
            expected: problem.expected,
            actual: problem.actual,
          });
        }
      }
    }
  }
  return findings;
}

interface SourceProblem {
  readonly expected: string;
  readonly actual: string;
}

function quoted(text: string): string {
  return `"${text}"`;
}

function nameProblem(source: NameSource, element: InspectedElement, props: PropValues): SourceProblem | undefined {
  const actual = element.name === "" ? "is empty" : `is ${quoted(element.name)}, from ${element.nameSource}`;
  if (source === "none") return element.name === "" ? undefined : { expected: "none", actual };
  if (source === "content") {
    return element.nameSource === "contents" && element.name !== "" ? undefined : { expected: "its content", actual };
  }
  if (source.startsWith("prop:")) {
    const prop = source.slice("prop:".length);
    const value = props[prop];
    if (value === undefined) return undefined;
    const want = String(value);
    return element.name === want ? undefined : { expected: `the prop ${prop} (${quoted(want)})`, actual };
  }
  const part = source.slice("part:".length);
  return element.nameSource === "aria-labelledby" && element.labelledBy.includes(part)
    ? undefined
    : { expected: `the part ${part} (aria-labelledby)`, actual };
}

function descriptionProblem(
  source: NameSource,
  element: InspectedElement,
  props: PropValues,
): SourceProblem | undefined {
  const actual = element.description === "" ? "is empty" : `is ${quoted(element.description)}`;
  if (source === "none") return element.description === "" ? undefined : { expected: "none", actual };
  if (source === "content") return element.description !== "" ? undefined : { expected: "its content", actual };
  if (source.startsWith("prop:")) {
    const prop = source.slice("prop:".length);
    const value = props[prop];
    if (value === undefined) return undefined;
    const want = String(value);
    return element.description === want ? undefined : { expected: `the prop ${prop} (${quoted(want)})`, actual };
  }
  const part = source.slice("part:".length);
  return element.describedBy.includes(part)
    ? undefined
    : {
        expected: `the part ${part} (aria-describedby)`,
        actual: `${actual}, described by ${element.describedBy.join(", ") || "no part"}`,
      };
}

/** The ARIA attributes each part's elements carry in one story, for `spec-aria`. */
export interface AriaObservation {
  readonly part: string;
  readonly attributes: readonly string[];
}

/** What one story contributes to `spec-aria`: the `aria-*` attributes on each part's root. */
export function ariaObservations(elements: readonly InspectedElement[]): AriaObservation[] {
  return elements
    .filter((e) => e.partRoot && e.part !== undefined)
    .map((e) => ({ part: e.part ?? "", attributes: Object.keys(e.aria) }));
}

/**
 * `spec-aria`, across all of a component's stories: every ARIA attribute an `a11y.aria` block
 * lists appears on its element in at least one story. Findings name no story.
 */
export function checkSpecAria(
  spec: A11ySpec,
  observations: readonly AriaObservation[],
  context: Pick<CheckContext, "theme"> = {},
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const [part, a11y] of a11yBlocks(spec)) {
    for (const attribute of Object.keys(a11y.aria ?? {})) {
      const seen = observations.some((o) => o.part === part && o.attributes.includes(attribute));
      if (seen) continue;
      findings.push({
        check: "a11y",
        rule: "spec-aria",
        message: `${attribute} (${a11y.aria?.[attribute] ?? ""}) appears on ${part} in none of the component's stories.`,
        ...locate(context),
        part,
        expected: attribute,
        blocking: true,
      });
    }
  }
  return findings;
}
