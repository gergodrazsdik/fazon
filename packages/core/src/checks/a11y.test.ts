// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  a11yBlocks,
  ariaObservations,
  axeRulesOff,
  axeRunOptions,
  checkAxe,
  checkSpecA11y,
  checkSpecAria,
  type A11ySpec,
} from "./a11y.js";
import type { PropValues } from "../spec/types.js";
import type { AxeOutcome } from "./snapshot.js";
import { element } from "./test-support.js";

describe("axe-core's results", () => {
  it("run the WCAG A and AA tags without the rules about a whole page", () => {
    const options = axeRunOptions();
    expect(options.runOnly).toEqual({ type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] });
    expect(Object.keys(options.rules as object)).toEqual([...axeRulesOff]);
  });

  it("make a finding per element of each violation, and list undecided results apart", () => {
    const outcome: AxeOutcome = {
      version: "4.14.1",
      violations: [
        {
          id: "button-name",
          help: "Buttons must have discernible text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
          impact: "critical",
          nodes: [{ selector: '[data-part="Button"]', part: "Button", summary: "Fix any of the following: …" }],
        },
      ],
      incomplete: [
        {
          id: "color-contrast",
          help: "Elements must meet minimum color contrast ratio thresholds",
          helpUrl: "",
          nodes: [{ selector: ".label", summary: "Background is a gradient" }],
        },
      ],
    };
    const { findings, incomplete } = checkAxe(outcome, { story: "button--icon--default", theme: "light" });
    expect(findings).toEqual([
      {
        check: "a11y",
        rule: "button-name",
        message: "Buttons must have discernible text. Fix any of the following: …",
        story: "button--icon--default",
        theme: "light",
        part: "Button",
        selector: '[data-part="Button"]',
        blocking: true,
      },
    ]);
    expect(incomplete).toEqual([
      expect.objectContaining({ rule: "color-contrast", blocking: false, selector: ".label" }),
    ]);
  });
});

const dialog: A11ySpec = {
  name: "Dialog",
  a11y: { role: "dialog", name: "part:Title", describedBy: "part:Description", aria: { "aria-modal": "true" } },
  parts: {
    Title: { a11y: { role: "heading", name: "content" } },
    Close: { a11y: { role: "button", name: "prop:label", describedBy: "none" } },
    Body: {},
  },
};

const rendered = {
  root: element({
    part: "Dialog",
    role: "dialog",
    name: "Delete the file?",
    nameSource: "aria-labelledby",
    labelledBy: ["Title"],
    description: "It can't be restored.",
    describedBy: ["Description"],
    aria: { "aria-modal": "true" },
  }),
  title: element({ part: "Title", role: "heading", name: "Delete the file?", nameSource: "contents" }),
  close: element({ part: "Close", role: "button", name: "Close", nameSource: "aria-label" }),
};

const specRules = (elements = Object.values(rendered), props = (): PropValues => ({ label: "Close" })) =>
  checkSpecA11y({ spec: dialog, elements, props }).map((f) => [f.rule, f.part, f.expected]);

describe("the spec's accessibility fields", () => {
  it("lists the blocks of the component and its parts", () => {
    expect(a11yBlocks(dialog).map(([part]) => part)).toEqual(["Dialog", "Title", "Close"]);
  });

  it("pass when roles, names and descriptions come from where the spec says", () => {
    expect(specRules()).toEqual([]);
  });

  it("find a role that differs (spec-role)", () => {
    expect(specRules([{ ...rendered.root, role: "alertdialog" }])).toEqual([["spec-role", "Dialog", "dialog"]]);
  });

  it("find a name from another source (spec-name)", () => {
    expect(specRules([{ ...rendered.title, nameSource: "aria-label" }])).toEqual([
      ["spec-name", "Title", "its content"],
    ]);
    expect(specRules([{ ...rendered.root, labelledBy: ["Body"] }])).toEqual([
      ["spec-name", "Dialog", "the part Title (aria-labelledby)"],
    ]);
    expect(specRules([rendered.close], () => ({ label: "Dismiss" }))).toEqual([
      ["spec-name", "Close", 'the prop label ("Dismiss")'],
    ]);
    expect(specRules([{ ...rendered.close, description: "Closes the dialog" }])).toEqual([
      ["spec-name", "Close", "none"],
    ]);
    expect(specRules([{ ...rendered.root, describedBy: [] }])).toEqual([
      ["spec-name", "Dialog", "the part Description (aria-describedby)"],
    ]);
  });

  it("skip a prop source when the story doesn't set the prop", () => {
    expect(specRules([{ ...rendered.close, name: "" }], () => ({}))).toEqual([]);
  });

  it("find a listed ARIA attribute that no story sets (spec-aria)", () => {
    const observations = ariaObservations([rendered.root, rendered.title]);
    expect(checkSpecAria(dialog, observations)).toEqual([]);
    const without = ariaObservations([{ ...rendered.root, aria: {} }]);
    expect(checkSpecAria(dialog, without)).toEqual([
      expect.objectContaining({ check: "a11y", rule: "spec-aria", part: "Dialog", expected: "aria-modal" }),
    ]);
  });
});
