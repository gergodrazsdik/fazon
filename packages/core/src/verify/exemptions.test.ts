// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { CheckFinding } from "../checks/types.js";
import type { Exemption } from "../spec/types.js";
import type { VerifyComponent } from "./components.js";
import { applyExemptions, findingComponent, type FindingElement, type FindingElements } from "./exemptions.js";
import { exampleButton, exampleComponent } from "./test-support.js";

const withExemptions = async (exemptions: Exemption[]) => {
  const button = await exampleButton();
  return exampleButton({ spec: { ...button.spec, exemptions } });
};

const finding = (overrides: Partial<CheckFinding>): CheckFinding => ({
  check: "layout",
  rule: "scroll",
  message: "it scrolls",
  story: "button--long-label--variant-primary--size-md--default",
  theme: "light",
  part: "Button",
  blocking: true,
  ...overrides,
});

const withSpecExemptions = async (name: "dialog" | "tabs", exemptions: Exemption[]): Promise<VerifyComponent> => {
  const component = await exampleComponent(name);
  return exampleComponent(name, { spec: { ...component.spec, exemptions } });
};

/** The rendered elements by selector, for one part, as the rendered checks would record them. */
const recorded =
  (part: string, bySelector: Record<string, FindingElement>): FindingElements =>
  (f, asked) =>
    asked === part && f.selector !== undefined ? bySelector[f.selector] : undefined;

describe("exemptions", () => {
  it("waive the findings they match, which stay, marked exempt and not blocking", async () => {
    const button = await withExemptions([{ check: "layout", rule: "scroll", reason: "the label scrolls by design" }]);
    const { findings, unused } = applyExemptions([finding({})], [button]);
    expect(findings).toEqual([{ ...finding({}), exempt: 0, blocking: false }]);
    expect(unused).toEqual([]);
  });

  it("of a source check apply to every file of the component, and to no other component's", async () => {
    const button = await withExemptions([{ check: "lint", rule: "raw-value", reason: "r" }]);
    const own: CheckFinding = {
      check: "lint",
      rule: "raw-value",
      message: "m",
      file: "src/components/button/Button.vue",
      blocking: true,
    };
    const other: CheckFinding = { ...own, file: "src/components/tabs/Tabs.vue" };
    const { findings } = applyExemptions([own, other], [button]);
    expect(findings.map((f) => f.blocking)).toEqual([false, true]);
  });

  it("of a rendered check match the part, fixture and condition they name", async () => {
    const button = await withExemptions([
      { check: "layout", rule: "scroll", part: "Icon", reason: "another part" },
      { check: "layout", rule: "scroll", fixture: "label", reason: "another fixture" },
      { check: "layout", rule: "scroll", when: { props: { variant: "ghost" } }, reason: "another variant" },
      {
        check: "layout",
        rule: "scroll",
        fixture: "long-label",
        when: { props: { variant: "primary" } },
        reason: "this one",
      },
    ]);
    const { findings, unused } = applyExemptions([finding({})], [button]);
    expect(findings[0]).toMatchObject({ exempt: 3, blocking: false });
    expect(unused.map((u) => u.index)).toEqual([0, 1, 2]);
  });

  it("match a story's state", async () => {
    const button = await withExemptions([
      { check: "a11y", rule: "color-contrast", when: { state: "disabled" }, reason: "r" },
    ]);
    const disabled = finding({
      check: "a11y",
      rule: "color-contrast",
      story: "button--label--variant-primary--size-md--disabled",
    });
    const hover = finding({
      check: "a11y",
      rule: "color-contrast",
      story: "button--label--variant-primary--size-md--hover",
    });
    expect(applyExemptions([disabled, hover], [button]).findings.map((f) => f.blocking)).toEqual([false, true]);
  });

  it("that name a part match that part's state, not the root's or another part's", async () => {
    const dialog = await withSpecExemptions("dialog", [
      { check: "layout", rule: "scroll", part: "Close", when: { state: "hover" }, reason: "r" },
    ]);
    const at = (story: string, part: string) =>
      finding({ story: `dialog--confirm--content-size-md--${story}`, part, selector: `[data-part="${part}"]` });
    const findings = [
      at("close-hover", "Close"),
      at("default", "Close"),
      at("close-hover", "Content"),
      at("closed", "Close"),
    ];
    expect(applyExemptions(findings, [dialog]).findings.map((f) => f.blocking)).toEqual([false, true, true, true]);
  });

  it("without a part match the root's state, not a part's", async () => {
    const tabs = await withSpecExemptions("tabs", [
      { check: "layout", rule: "scroll", when: { state: "hover" }, reason: "r" },
    ]);
    const hover = finding({ story: "tabs--three--orientation-horizontal--trigger-hover", part: "Trigger" });
    expect(applyExemptions([hover], [tabs]).findings[0]?.blocking).toBe(true);
  });

  it("that name a part match the props and states of the instance the finding is in", async () => {
    const tabs = await withSpecExemptions("tabs", [
      { check: "layout", rule: "scroll", part: "Trigger", when: { props: { disabled: true } }, reason: "disabled" },
      { check: "a11y", rule: "color-contrast", part: "Trigger", when: { state: "hover" }, reason: "hovered" },
    ]);
    const elements = recorded("Trigger", {
      "#first": { instance: 0, states: ["hover"] },
      "#second": { instance: 1, states: [] },
    });
    const disabled = (selector: string) =>
      finding({ story: "tabs--one-disabled--orientation-horizontal--default", part: "Trigger", selector });
    const hovered = (selector: string) =>
      finding({
        check: "a11y",
        rule: "color-contrast",
        story: "tabs--three--orientation-horizontal--trigger-hover",
        part: "Trigger",
        selector,
      });
    const findings = [disabled("#second"), disabled("#first"), hovered("#first"), hovered("#second")];
    expect(applyExemptions(findings, [tabs], elements).findings.map((f) => f.blocking)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("with a fixture and part but no condition match every story of that fixture", async () => {
    const dialog = await exampleComponent("dialog");
    const long = finding({ story: "dialog--long-content--content-size-md--default", part: "Content" });
    const confirm = finding({ story: "dialog--confirm--content-size-md--default", part: "Content" });
    expect(applyExemptions([long, confirm], [dialog]).findings.map((f) => f.exempt)).toEqual([0, undefined]);
  });

  it("never waive visual", async () => {
    const button = await withExemptions([{ check: "visual", rule: "changed", reason: "r" }]);
    const { findings, unused } = applyExemptions([finding({ check: "visual", rule: "changed" })], [button]);
    expect(findings[0]?.blocking).toBe(true);
    expect(unused).toHaveLength(1);
  });
});

describe("a finding's component", () => {
  it("is its story's, or its file's: in the component's directory, or its spec", async () => {
    const button = await exampleButton();
    const group = await exampleButton({
      name: "button-group",
      directory: "src/components/button-group",
      specFile: "specs/button-group.md",
    });
    const all = [button, group];
    expect(findingComponent({ story: "button-group--label--default" }, all)).toBe("button-group");
    expect(findingComponent({ story: "button--label--default" }, all)).toBe("button");
    expect(findingComponent({ file: "src/components/button-group/ButtonGroup.vue" }, all)).toBe("button-group");
    expect(findingComponent({ file: "specs/button.md" }, all)).toBe("button");
    expect(findingComponent({ file: "package.json" }, all)).toBeUndefined();
    expect(findingComponent({}, all)).toBeUndefined();
  });
});
