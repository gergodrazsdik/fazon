// SPDX-License-Identifier: GPL-3.0-or-later
import { AdapterError, baseStyles, buildManifest, type Spec } from "@fazon/core";
import { describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";
import { exampleInput } from "./test-support.js";

const menu: Spec = {
  fazon: 0,
  name: "Menu",
  tier: "composite",
  summary: "Actions in a list.",
  props: { open: { type: "boolean", model: true, default: true } },
  parts: {
    Group: { parent: "Menu", count: "many" },
    Item: {
      parent: "Group",
      count: "one",
      props: { checked: { type: "boolean", model: true, required: true } },
      slots: { default: { required: true }, icon: {} },
      states: ["hover"],
    },
  },
  fixtures: {
    two: {
      frame: { width: 240 },
      parts: {
        Group: [{}, {}],
        Item: [
          { props: { checked: true }, slots: { default: "Copy", icon: { icon: "copy" } } },
          {
            props: { checked: false },
            slots: { default: ["Paste", { text: " all" }], icon: { icon: "chevron-down" } },
          },
        ],
      },
    },
  },
};

async function storyFile(spec: Spec, overrides: Partial<Parameters<typeof vueAdapter.generate>[0]> = {}) {
  const input = {
    spec,
    specFile: `specs/${spec.name.toLowerCase()}.md`,
    uses: {},
    manifest: buildManifest(spec, { file: `specs/${spec.name.toLowerCase()}.md`, themes: ["dark", "light"] }),
    directory: `src/components/${spec.name.toLowerCase()}`,
    icons: "lucide" as const,
    baseStyles: baseStyles("fz"),
    prefix: "fz",
    ...overrides,
  };
  const [stories] = await vueAdapter.generate(input);
  return stories?.content ?? "";
}

describe("the story file", () => {
  it("shares a many part's children out among its instances, in order", async () => {
    const text = await storyFile(menu);
    const items = [...text.matchAll(/h\(\s*MenuGroup,\s*null,\s*\{\s*default: \(\) =>\s*h\(\s*MenuItem/g)];
    expect(items).toHaveLength(2 * 2);
    expect(text.indexOf('"Copy"')).toBeLessThan(text.indexOf('"Paste"'));
  });

  it("binds every model the fixture sets to state the story owns, and leaves the others alone", async () => {
    const text = await storyFile(menu);
    expect(text).toContain('import { h, ref } from "vue";');
    // A required model's type is its own; an optional one's may be undefined.
    expect(text).toContain("const model0 = ref<boolean>(true);");
    expect(text).toContain("const model1 = ref<boolean>(false);");
    expect(text).toContain('"onUpdate:checked": (value: boolean) => {');
    expect(text).not.toContain("onUpdate:open");
    const dialog = await storyFile(exampleInput("dialog").spec, { uses: exampleInput("dialog").uses });
    expect(dialog).toContain("const model0 = ref<boolean | undefined>(true);");
    expect(dialog).toContain('"onUpdate:open": (value: boolean | undefined) => {');
  });

  it("imports the icons it renders, and puts the frame's width and the default theme in", async () => {
    const text = await storyFile(menu);
    expect(text).toContain('import iconChevronDown from "lucide-static/icons/chevron-down.svg?raw";');
    expect(text.indexOf("iconChevronDown from")).toBeLessThan(text.indexOf("iconCopy from"));
    expect(text).toContain("decorators: [frame(240)]");
    expect(text).toContain('context.globals.theme ?? "dark"');
    expect(text).toContain('backgroundColor: "var(--fz-color-surface-base)"');
    expect(text).toContain('["Paste", " all"]');
  });

  it("renders a paragraph node as a <p> holding its text as plain text", async () => {
    const spec: Spec = {
      ...menu,
      fixtures: {
        two: {
          parts: {
            Group: [{}, {}],
            Item: [
              { props: { checked: true }, slots: { default: [{ p: "First." }, { p: 'A "quoted" <b>tag</b>.' }] } },
              { props: { checked: false }, slots: { default: { p: "Alone." } } },
            ],
          },
        },
      },
    };
    const text = (await storyFile(spec)).replace(/\s+/g, " ");
    // The text is a string argument, never innerHTML, so markup in it shows as written.
    expect(text).toContain(`[ h("p", "First."), h("p", 'A "quoted" <b>tag</b>.'), ]`);
    expect(text).toContain('{ default: () => h("p", "Alone.") }');
    expect(text).not.toContain("innerHTML: 'A");
    const dialog = await storyFile(exampleInput("dialog").spec, { uses: exampleInput("dialog").uses });
    expect(dialog.match(/h\(\s*"p",/g)).toHaveLength(4);
  });

  it("imports icons from the icon directory fazon.yaml names", async () => {
    const text = await storyFile(menu, { icons: { path: "assets/icons" } });
    expect(text).toContain('import iconCopy from "../../../../assets/icons/copy.svg?raw";');
  });

  it("renders another component by its own Vue API, from its directory", async () => {
    const text = await storyFile(exampleInput("dialog").spec, { uses: exampleInput("dialog").uses });
    expect(text).toContain('import Button from "../../button/Button.vue";');
  });

  it("refuses a used component without a spec", async () => {
    await expect(storyFile(exampleInput("dialog").spec)).rejects.toThrow(AdapterError);
    await expect(storyFile(exampleInput("dialog").spec)).rejects.toThrow("Dialog uses Button, which has no spec.");
  });

  it("refuses a fixture that sets a prop extensions.vue omits", async () => {
    const spec: Spec = { ...menu, extensions: { vue: { omit: { "parts.Item.props.checked": {} } } } };
    await expect(storyFile(spec)).rejects.toThrow(/sets Item's checked, which its Vue API doesn't have/);
  });

  it("refuses instances it can't share out among their parent's", async () => {
    const spec: Spec = {
      ...menu,
      fixtures: {
        two: { parts: { Group: [{}, {}], Item: [{ props: { checked: true }, slots: { default: "Copy" } }] } },
      },
    };
    await expect(storyFile(spec)).rejects.toThrow(/can't be shared among 2 instances of Group/);
  });
});
