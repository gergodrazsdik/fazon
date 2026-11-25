// SPDX-License-Identifier: GPL-3.0-or-later
// The `layout` check (docs/spec/check-catalogue.md#layout), measured on the rendered boxes of the
// component's elements.
import type { InspectedElement, PageInspection } from "./snapshot.js";
import { locate, type Box, type CheckContext, type CheckFinding } from "./types.js";

/** The `layout` check's rules. */
export type LayoutRule = "overflow" | "clipped-text" | "scroll" | "target-size";

/** The roles that make an element interactive, besides being in the tab order. */
export const interactiveRoles: readonly string[] = [
  "button",
  "link",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "option",
  "combobox",
  "textbox",
  "searchbox",
  "slider",
];

/** The WCAG 2.5.8 minimum, in CSS pixels. */
export const minimumTargetSize = 24;

// Sub-pixel layout: an edge counts as outside only beyond this, in CSS pixels.
const tolerance = 0.5;

const clips = new Set(["hidden", "clip"]);
const scrolls = new Set(["auto", "scroll"]);

/** Runs the `layout` check on one rendered story. */
export function checkLayout(inspection: PageInspection, context: CheckContext = {}): CheckFinding[] {
  const { elements } = inspection;
  const findings: CheckFinding[] = [];
  const finding = (element: InspectedElement, rule: LayoutRule, message: string, extra: Partial<CheckFinding> = {}) =>
    findings.push({
      check: "layout",
      rule,
      message,
      ...locate(context),
      ...(element.part === undefined ? {} : { part: element.part }),
      selector: element.selector,
      ...extra,
      blocking: true,
    });
  const children = new Map<number, InspectedElement[]>();
  elements.forEach((element) => {
    if (element.parent === undefined) return;
    children.set(element.parent, [...(children.get(element.parent) ?? []), element]);
  });
  const subtreeHasText = (index: number): boolean =>
    (elements[index]?.textBoxes.length ?? 0) > 0 || elements.some((e, i) => e.parent === index && subtreeHasText(i));

  elements.forEach((element, index) => {
    if (!rendered(element)) return;
    const visible = element.overflowX === "visible" && element.overflowY === "visible";

    if (element.parent === undefined && element.inFrame) {
      const outside = outsideBy(element.box, inspection.frame.contentBox);
      if (outside > tolerance) {
        finding(element, "overflow", `The component's root extends ${px(outside)} outside the frame's content box.`, {
          expected: describeBox(inspection.frame.contentBox),
          actual: describeBox(element.box),
        });
      }
    }

    if (visible) {
      const boxes = [
        ...(children.get(index) ?? []).filter((c) => rendered(c) && c.position !== "fixed").map((c) => c.box),
        ...element.textBoxes,
      ];
      const outside = Math.max(0, ...boxes.map((b) => outsideBy(b, element.box)));
      if (outside > tolerance) {
        finding(element, "overflow", `Content extends ${px(outside)} outside the element, whose overflow is visible.`);
      }
    }

    const clipping =
      clips.has(element.overflowX) ||
      clips.has(element.overflowY) ||
      element.textOverflow === "ellipsis" ||
      (element.lineClamp !== "none" && element.lineClamp !== "");
    const larger = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
    if (clipping && !visible && larger && subtreeHasText(index)) {
      finding(
        element,
        "clipped-text",
        `Text is cut off: the content is ${String(element.scrollWidth)} by ${String(element.scrollHeight)} px ` +
          `in a box that shows ${String(element.clientWidth)} by ${String(element.clientHeight)} px.`,
        {
          expected: `${String(element.clientWidth)}x${String(element.clientHeight)}`,
          actual: `${String(element.scrollWidth)}x${String(element.scrollHeight)}`,
        },
      );
    }

    const scrollsX = scrolls.has(element.overflowX) && element.scrollWidth > element.clientWidth;
    const scrollsY = scrolls.has(element.overflowY) && element.scrollHeight > element.clientHeight;
    if (scrollsX || scrollsY) {
      finding(
        element,
        "scroll",
        `The element scrolls ${scrollsX && scrollsY ? "both ways" : scrollsX ? "horizontally" : "vertically"}: ` +
          `its content is ${String(element.scrollWidth)} by ${String(element.scrollHeight)} px in a ` +
          `${String(element.clientWidth)} by ${String(element.clientHeight)} px box. Declare intended scrolling ` +
          "with an exemption.",
      );
    }
  });

  for (const target of targetSizeFailures(elements)) {
    finding(
      target.element,
      "target-size",
      `The ${target.element.role || target.element.tag} target is ${px(target.element.box.width)} by ` +
        `${px(target.element.box.height)}, under ${String(minimumTargetSize)} by ${String(minimumTargetSize)}, ` +
        `and a ${String(minimumTargetSize)} px circle centred on it overlaps ${target.other.selector} (WCAG 2.5.8).`,
      {
        expected: `${String(minimumTargetSize)}x${String(minimumTargetSize)}`,
        actual: `${trim(target.element.box.width)}x${trim(target.element.box.height)}`,
      },
    );
  }
  return findings;
}

/** Whether an element is interactive (docs/spec/check-catalogue.md#layout). */
export function isInteractive(element: InspectedElement): boolean {
  return interactiveRoles.includes(element.role) || element.tabbable;
}

/**
 * The undersized targets that fail WCAG 2.5.8: smaller than 24 by 24 CSS pixels, and a 24 px circle
 * centred on the target's box intersects another target, or the circle of another undersized
 * target. Inline targets in a line of text are excepted; a target and its own ancestors or
 * descendants aren't compared.
 */
export function targetSizeFailures(
  elements: readonly InspectedElement[],
): { element: InspectedElement; other: InspectedElement }[] {
  const radius = minimumTargetSize / 2;
  const targets = elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => isInteractive(element) && rendered(element));
  const undersized = (e: InspectedElement) =>
    e.box.width < minimumTargetSize - 0.01 || e.box.height < minimumTargetSize - 0.01;
  const related = (a: number, b: number) => isAncestor(elements, a, b) || isAncestor(elements, b, a);
  const failures: { element: InspectedElement; other: InspectedElement }[] = [];
  for (const target of targets) {
    if (!undersized(target.element) || target.element.inlineInText) continue;
    const centre = centreOf(target.element.box);
    const other = targets.find(({ element, index }) => {
      if (index === target.index || related(index, target.index)) return false;
      if (distanceToBox(centre, element.box) < radius) return true;
      return undersized(element) && distance(centre, centreOf(element.box)) < 2 * radius;
    });
    if (other !== undefined) failures.push({ element: target.element, other: other.element });
  }
  return failures;
}

function rendered(element: InspectedElement): boolean {
  return (
    element.display !== "none" && element.visibility !== "hidden" && (element.box.width > 0 || element.box.height > 0)
  );
}

function isAncestor(elements: readonly InspectedElement[], ancestor: number, of: number): boolean {
  let at = elements[of]?.parent;
  while (at !== undefined) {
    if (at === ancestor) return true;
    at = elements[at]?.parent;
  }
  return false;
}

/** How far a box reaches outside another, on its worst side; 0 when inside. */
export function outsideBy(inner: Box, outer: Box): number {
  return Math.max(
    0,
    outer.x - inner.x,
    outer.y - inner.y,
    inner.x + inner.width - (outer.x + outer.width),
    inner.y + inner.height - (outer.y + outer.height),
  );
}

function centreOf(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToBox(point: { x: number; y: number }, box: Box): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function px(value: number): string {
  return `${trim(value)} px`;
}

function describeBox(box: Box): string {
  return `${trim(box.width)}x${trim(box.height)} at ${trim(box.x)},${trim(box.y)}`;
}
