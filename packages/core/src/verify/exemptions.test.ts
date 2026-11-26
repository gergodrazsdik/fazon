// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { CheckFinding } from "../checks/types.js";
import type { Exemption } from "../spec/types.js";
import { storyProps } from "./components.js";
import { applyExemptions, findingComponent } from "./exemptions.js";
import { exampleButton } from "./test-support.js";

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

const props = (
  component: Awaited<ReturnType<typeof exampleButton>>,
  story: NonNullable<Awaited<ReturnType<typeof exampleButton>>["manifest"]>["stories"][number],
) =>
  component.manifest === undefined ? {} : storyProps(component.spec, component.manifest, story)(component.spec.name, 0);

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
    const { findings, unused } = applyExemptions([finding({})], [button], props);
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
    expect(applyExemptions([disabled, hover], [button], props).findings.map((f) => f.blocking)).toEqual([false, true]);
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
