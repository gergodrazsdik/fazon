// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from "vitest";
import type { StoryManifest } from "../matrix/types.js";
import type { VerifyComponent } from "./components.js";
import { reflectedStateProblems, setByProps, type ReflectingElement } from "./reflected-states.js";
import { exampleComponent } from "./test-support.js";

let button: VerifyComponent;
let dialog: VerifyComponent;
let tabs: VerifyComponent;
beforeAll(async () => {
  [button, dialog, tabs] = await Promise.all([
    exampleComponent("button"),
    exampleComponent("dialog"),
    exampleComponent("tabs"),
  ]);
});

const manifestOf = (component: VerifyComponent): StoryManifest => {
  if (component.manifest === undefined) throw new Error(`${component.name} has no manifest.`);
  return component.manifest;
};

const root = (part: string, states: string[] = [], instance = 0): ReflectingElement => ({
  part,
  partRoot: true,
  instance,
  states,
});

describe("setByProps", () => {
  it("holds for a boolean prop of the state's name and a recipe with props", () => {
    expect(setByProps(button.spec, { name: "disabled" })).toBe(true);
    expect(setByProps(button.spec, { name: "loading" })).toBe(true);
    expect(setByProps(dialog.spec, { name: "closed" })).toBe(true);
    expect(setByProps(tabs.spec, { name: "disabled", part: "Trigger" })).toBe(true);
  });

  it("doesn't hold for default, pseudo-states, or a state no props produce", () => {
    expect(setByProps(button.spec, { name: "default" })).toBe(false);
    expect(setByProps(button.spec, { name: "hover" })).toBe(false);
    expect(setByProps(button.spec, { name: "focus-visible" })).toBe(false);
    expect(setByProps(tabs.spec, { name: "selected", part: "Trigger" })).toBe(false);
    const byInput = {
      ...dialog.spec,
      produce: { closed: { input: [{ action: "click" as const, target: "Close" }] } },
    };
    expect(setByProps(byInput, { name: "closed" })).toBe(false);
  });
});

describe("MATRIX-005", () => {
  it("holds when each state set by props is on its target in every theme", () => {
    const manifest = manifestOf(button);
    const rendered = (story: string) => {
      const state = manifest.stories.find((s) => s.name === story)?.state.name ?? "default";
      return [root("Button", ["variant", "size", ...(["disabled", "loading"].includes(state) ? [state] : [])])];
    };
    expect(reflectedStateProblems(button.spec, manifest, rendered)).toEqual([]);
  });

  it("fails a story whose target doesn't carry the state it sets, naming the story and themes", () => {
    const manifest = manifestOf(button);
    const rendered = (story: string, theme: string) => {
      const state = manifest.stories.find((s) => s.name === story)?.state.name ?? "default";
      if (state === "loading" && theme === "dark") return [root("Button")];
      return [root("Button", state === "disabled" ? [] : [state])];
    };
    const problems = reflectedStateProblems(button.spec, manifest, rendered);
    const disabled = manifest.stories.filter((s) => s.state.name === "disabled");
    expect(problems).toHaveLength(disabled.length + manifest.stories.filter((s) => s.state.name === "loading").length);
    expect(problems[0]).toBe(
      `MATRIX-005 ${disabled[0]?.name ?? ""} (light, dark): the story sets the state disabled by props, ` +
        `but its target the root (data-part="Button") doesn't carry data-disabled`,
    );
    expect(problems.some((p) => p.includes("--loading (dark):"))).toBe(true);
  });

  it("looks for a part's state on the instance its recipe names", () => {
    const spec = { ...tabs.spec, parts: { ...tabs.spec.parts } };
    const trigger = spec.parts.Trigger;
    if (trigger === undefined) throw new Error("The example Tabs has no Trigger.");
    spec.parts.Trigger = {
      ...trigger,
      produce: { ...trigger.produce, disabled: { props: { disabled: true }, instance: 1 } },
    };
    const [first] = manifestOf(tabs).stories;
    if (first === undefined) throw new Error("The example Tabs has no stories.");
    const manifest: StoryManifest = {
      ...manifestOf(tabs),
      stories: [{ ...first, name: "tabs--three--trigger-disabled", state: { name: "disabled", part: "Trigger" } }],
    };
    const on = (instance: number) => () => [
      root("Tabs"),
      root("Trigger", ["selected"], 0),
      root("Trigger", instance === 1 ? ["disabled"] : [], 1),
      root("Trigger", instance === 2 ? ["disabled"] : [], 2),
    ];
    expect(reflectedStateProblems(spec, manifest, on(1))).toEqual([]);
    expect(reflectedStateProblems(spec, manifest, on(2))).toEqual([
      "MATRIX-005 tabs--three--trigger-disabled (light, dark): the story sets the state disabled by props, " +
        "but its target Trigger[1] doesn't carry data-disabled",
    ]);
  });

  it("needs a story: false state on a root of its part in at least one of the component's renders", () => {
    const manifest = manifestOf(tabs);
    const shown = (story: string, theme: string) =>
      story === manifest.stories[1]?.name && theme === "dark"
        ? [root("Tabs"), root("Trigger", ["selected"]), root("Trigger", ["disabled"], 1)]
        : [root("Tabs"), root("Trigger", ["selected"]), root("Trigger", [], 1)];
    expect(reflectedStateProblems(tabs.spec, manifest, shown)).toEqual([]);
    // On an element of another part, or nowhere: not reflected.
    const elsewhere = () => [root("Tabs", ["selected"]), root("Trigger"), root("Panel", ["disabled"])];
    expect(reflectedStateProblems(tabs.spec, manifest, elsewhere)).toEqual([
      "MATRIX-005 Tabs: the state selected of Trigger has story: false, but no Trigger element carries data-selected in any of the component's stories",
      "MATRIX-005 Tabs: the state disabled of Trigger has story: false, but no Trigger element carries data-disabled in any of the component's stories",
    ]);
  });

  it("leaves out stories that didn't render, and has nothing to say when none did", () => {
    expect(reflectedStateProblems(tabs.spec, manifestOf(tabs), () => undefined)).toEqual([]);
    expect(reflectedStateProblems(button.spec, manifestOf(button), () => undefined)).toEqual([]);
  });
});
