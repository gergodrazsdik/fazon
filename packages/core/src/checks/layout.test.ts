// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { checkLayout, isInteractive, outsideBy, targetSizeFailures } from "./layout.js";
import type { InspectedElement, PageInspection } from "./snapshot.js";
import { element } from "./test-support.js";

const frame = {
  selector: "[data-fazon-frame]",
  box: { x: 0, y: 0, width: 192, height: 72 },
  contentBox: { x: 16, y: 16, width: 160, height: 40 },
};

const inspect = (...elements: InspectedElement[]): PageInspection => ({
  viewport: { width: 1024, height: 768 },
  frame,
  elements,
});

const rules = (inspection: PageInspection) => checkLayout(inspection).map((f) => [f.rule, f.selector]);

describe("checkLayout", () => {
  it("passes a root inside the frame with its text inside it", () => {
    const button = element({ textBoxes: [{ x: 32, y: 24, width: 60, height: 24 }] });
    expect(rules(inspect(button))).toEqual([]);
  });

  it("finds a root that extends outside the frame's content box (overflow)", () => {
    const findings = checkLayout(inspect(element({ box: { x: 16, y: 16, width: 200, height: 40 } })), {
      story: "button--long-label--default",
      theme: "dark",
    });
    expect(findings).toEqual([
      expect.objectContaining({
        check: "layout",
        rule: "overflow",
        story: "button--long-label--default",
        theme: "dark",
        part: "Button",
        blocking: true,
      }),
    ]);
  });

  it("finds content outside an element whose overflow is visible (overflow), within half a pixel", () => {
    const text = (width: number) => element({ textBoxes: [{ x: 16, y: 24, width, height: 24 }] });
    expect(rules(inspect(text(100.4)))).toEqual([]);
    expect(rules(inspect(text(140)))).toEqual([["overflow", '[data-part="Button"]']]);
    const child = element({
      selector: "span",
      partRoot: false,
      parent: 0,
      box: { x: 16, y: 16, width: 120, height: 20 },
    });
    expect(rules(inspect(element(), child))).toEqual([["overflow", '[data-part="Button"]']]);
    expect(rules(inspect(element(), { ...child, position: "fixed" }))).toEqual([]);
    expect(rules(inspect(element({ overflowX: "hidden", overflowY: "hidden" }), child))).toEqual([]);
  });

  it("finds text cut off by hidden overflow, an ellipsis or a line clamp (clipped-text)", () => {
    const clipped = {
      overflowX: "hidden",
      overflowY: "hidden",
      textOverflow: "ellipsis",
      scrollWidth: 495,
      textBoxes: [{ x: 32, y: 24, width: 463, height: 24 }],
    };
    expect(rules(inspect(element(clipped)))).toEqual([["clipped-text", '[data-part="Button"]']]);
    expect(rules(inspect(element({ ...clipped, textBoxes: [] })))).toEqual([]);
    expect(rules(inspect(element({ ...clipped, scrollWidth: 100 })))).toEqual([]);
    const clamped = {
      overflowX: "hidden",
      overflowY: "hidden",
      lineClamp: "2",
      scrollHeight: 72,
      textBoxes: [{ x: 16, y: 16, width: 90, height: 72 }],
    };
    expect(rules(inspect(element(clamped)))).toEqual([["clipped-text", '[data-part="Button"]']]);
  });

  it("finds an element that scrolls (scroll)", () => {
    expect(rules(inspect(element({ overflowY: "auto", overflowX: "auto", scrollHeight: 96 })))).toEqual([
      ["scroll", '[data-part="Button"]'],
    ]);
    expect(rules(inspect(element({ overflowY: "scroll", overflowX: "auto" })))).toEqual([]);
  });
});

describe("target-size", () => {
  const target = (x: number, size = 16, overrides: Partial<InspectedElement> = {}) =>
    element({ selector: `#t${String(x)}`, role: "button", box: { x, y: 16, width: size, height: size }, ...overrides });

  it("treats roles and the tab order as interactive", () => {
    expect(isInteractive(element({ role: "tab" }))).toBe(true);
    expect(isInteractive(element({ role: "generic", tabbable: true }))).toBe(true);
    expect(isInteractive(element({ role: "generic" }))).toBe(false);
  });

  it("passes undersized targets whose 24 px circles don't overlap", () => {
    expect(targetSizeFailures([target(16), target(40)])).toEqual([]);
  });

  it("fails undersized targets whose circles overlap", () => {
    const failures = targetSizeFailures([target(16), target(36)]);
    expect(failures.map((f) => [f.element.selector, f.other.selector])).toEqual([
      ["#t16", "#t36"],
      ["#t36", "#t16"],
    ]);
  });

  it("fails an undersized target whose circle overlaps a large target", () => {
    expect(targetSizeFailures([target(16), target(34, 32)]).map((f) => f.element.selector)).toEqual(["#t16"]);
  });

  it("excepts inline targets in text, and doesn't compare a target with its ancestors", () => {
    expect(
      targetSizeFailures([target(16, 16, { inlineInText: true }), target(36)]).map((f) => f.element.selector),
    ).toEqual(["#t36"]);
    expect(targetSizeFailures([target(16, 40), target(20, 16, { parent: 0 })])).toEqual([]);
  });

  it("reports through checkLayout with the measured size", () => {
    const findings = checkLayout(inspect(target(16), target(36)));
    expect(findings[0]).toMatchObject({ rule: "target-size", expected: "24x24", actual: "16x16" });
  });
});

describe("outsideBy", () => {
  it("measures the worst side", () => {
    expect(outsideBy({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(0);
    expect(outsideBy({ x: -2, y: 0, width: 15, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(3);
  });
});
