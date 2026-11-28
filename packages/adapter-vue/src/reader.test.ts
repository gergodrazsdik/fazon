// SPDX-License-Identifier: GPL-3.0-or-later
// The API reader over hand-written components: the example components (test-fixtures/vue-project/)
// read as their approved API in the goldens, and each kind of drift gives one precise difference.
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VueApiFile, VueComponentApi } from "./api.js";
import { apiDifferences, createVueApiReader, parseDefault, type VueApiReader } from "./reader.js";
import { exampleNames, fixtures, golden } from "./test-support.js";

// vue-component-meta is slow under load: the 5 s default timed out in full runs (F-0033).
vi.setConfig({ testTimeout: 30_000 });

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

let project: string;
let reader: VueApiReader;

async function approvedApi(name: string): Promise<VueApiFile> {
  const text = await readFile(new URL(`src/components/${name}/generated/api.json.golden`, golden), "utf8");
  return JSON.parse(text) as VueApiFile;
}

/** Reads a component of the project against its approved API, after `edit` changes one of its files. */
async function differences(
  name: string,
  approved: Readonly<Record<string, VueComponentApi>>,
  edit?: { file: string; from: string | RegExp; to: string },
): Promise<string[]> {
  const directory = path.join(project, "src/components", name);
  if (edit === undefined) return apiDifferences(approved, reader.readComponent(directory, approved));
  const file = path.join(directory, edit.file);
  const original = await readFile(file, "utf8");
  const edited = original.replace(edit.from, edit.to);
  expect(edited).not.toBe(original);
  await writeFile(file, edited);
  try {
    return apiDifferences(approved, reader.readComponent(directory, approved));
  } finally {
    await writeFile(file, original);
  }
}

/**
 * A component the examples don't have: a slot with data, a method with a parameter and a result,
 * and its name declared with another option.
 */
const list = `<script setup lang="ts">
defineOptions({ name: "FzList", inheritAttrs: false });
defineProps<{ items: string[]; sizes?: ("sm" | "md")[] }>();
defineEmits<{ select: [index: number] }>();
defineSlots<{ item(props: { label: string; index: number }): unknown }>();
function scrollTo(index: number, smooth?: boolean): boolean {
  return index >= 0 && smooth !== false;
}
defineExpose({ scrollTo });
</script>

<template>
  <ul><li><slot name="item" label="a" :index="0" /></li></ul>
</template>
`;

const listApi: VueComponentApi = {
  file: "List.vue",
  name: "FzList",
  props: {
    items: { type: "array", items: { type: "string" }, required: true },
    sizes: { type: "array", items: { type: "enum", values: ["sm", "md"] }, required: false },
  },
  events: { select: { payload: { type: "number" } } },
  slots: { item: { required: true, props: { label: { type: "string" }, index: { type: "number" } } } },
  exposed: {
    scrollTo: { params: { index: { type: "number" }, smooth: { type: "boolean" } }, returns: { type: "boolean" } },
  },
};

beforeAll(async () => {
  project = await mkdtemp(path.join(tmpdir(), "fazon-reader-"));
  await cp(fileURLToPath(new URL("vue-project/", fixtures)), project, { recursive: true });
  await symlink(path.join(packageRoot, "node_modules"), path.join(project, "node_modules"), "dir");
  await cp(path.join(project, "src/components/button"), path.join(project, "src/components/list"), { recursive: true });
  await rm(path.join(project, "src/components/list/Button.vue"));
  await writeFile(path.join(project, "src/components/list/List.vue"), list);
  reader = createVueApiReader({ tsconfig: path.join(project, "tsconfig.json") });
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("the API reader", () => {
  it.each(exampleNames)("reads the %s example's components as their approved API", async (name) => {
    const approved = (await approvedApi(name)).components;
    const actual = reader.readComponent(path.join(project, "src/components", name), approved);
    expect(actual).toEqual(approved);
    expect(apiDifferences(approved, actual)).toEqual([]);
  });

  it("reads arrays, slot data, payloads and methods with parameters and results", () => {
    const approved = { List: listApi };
    expect(reader.readComponent(path.join(project, "src/components/list"), approved)).toEqual(approved);
  });

  it("puts an enum's values in the approved order, and keeps another order when the values differ", async () => {
    const { components } = await approvedApi("button");
    const button = components.Button;
    if (button === undefined) throw new Error("no Button");
    const reordered = {
      Button: {
        ...button,
        props: { ...button.props, size: { type: "enum", values: ["lg", "md", "sm"], required: false, default: "md" } },
      },
    } satisfies Record<string, VueComponentApi>;
    expect(reader.readComponent(path.join(project, "src/components/button"), reordered)).toEqual(reordered);
  });
});

describe("drift from the approved API", () => {
  it("a name without the prefix", async () => {
    const { components } = await approvedApi("button");
    expect(
      await differences("button", components, {
        file: "Button.vue",
        from: 'defineOptions({ name: "FzButton" });',
        to: 'defineOptions({ name: "Button" });',
      }),
    ).toEqual(['Button: the component\'s name is "Button"; the approved API says "FzButton".']);
  });

  it("a part that declares no name", async () => {
    const { components } = await approvedApi("tabs");
    expect(
      await differences("tabs", components, {
        file: "TabsTrigger.vue",
        from: 'defineOptions({ name: "FzTabsTrigger" });\n',
        to: "",
      }),
    ).toEqual([
      'TabsTrigger: the component declares no name; the approved API says "FzTabsTrigger", as defineOptions({ name: "FzTabsTrigger" }).',
    ]);
  });

  it("a missing prop", async () => {
    const { components } = await approvedApi("button");
    expect(await differences("button", components, { file: "Button.vue", from: "loading?: boolean;", to: "" })).toEqual(
      ["Button: the prop loading is missing."],
    );
  });

  it("a prop of the wrong type", async () => {
    const { components } = await approvedApi("tabs");
    expect(
      await differences("tabs", components, { file: "TabsList.vue", from: "label: string", to: "label: number" }),
    ).toEqual(["TabsList: the prop label has the type number; the approved API says string."]);
  });

  it("an enum with a value missing", async () => {
    const { components } = await approvedApi("button");
    expect(await differences("button", components, { file: "Button.vue", from: ' | "lg";', to: ";" })).toEqual([
      'Button: the prop size has the type "sm" | "md"; the approved API says "sm" | "md" | "lg".',
    ]);
  });

  it("a wrong default", async () => {
    const { components } = await approvedApi("button");
    expect(
      await differences("button", components, { file: "Button.vue", from: 'size: "md"', to: 'size: "lg"' }),
    ).toEqual(['Button: the prop size has the default "lg"; the approved API says "md".']);
  });

  it("a required prop that should be optional", async () => {
    const { components } = await approvedApi("tabs");
    expect(
      await differences("tabs", components, { file: "TabsList.vue", from: "label: string", to: "label?: string" }),
    ).toEqual(["TabsList: the prop label is optional; the approved API says required."]);
  });

  it("an extra event", async () => {
    const { components } = await approvedApi("button");
    expect(
      await differences("button", components, { file: "Button.vue", from: "click: []", to: "click: []; hover: []" }),
    ).toEqual(["Button: the event hover isn't in the approved API."]);
  });

  it("a model that isn't two-way bound", async () => {
    const { components } = await approvedApi("dialog");
    expect(
      await differences("dialog", components, {
        file: "Dialog.vue",
        from: 'const open = defineModel<boolean>("open", { default: false });',
        to: "const { open = false } = defineProps<{ open?: boolean }>();",
      }),
    ).toEqual(["Dialog: the event update:open is missing."]);
  });

  it("an optional slot that should be required", async () => {
    const { components } = await approvedApi("button");
    expect(
      await differences("button", components, {
        file: "Button.vue",
        from: "default(): unknown",
        to: "default?(): unknown",
      }),
    ).toEqual(["Button: the slot default is optional; the approved API says required."]);
  });

  it("missing slot data", async () => {
    expect(await differences("list", { List: listApi }, { file: "List.vue", from: "label: string; ", to: "" })).toEqual(
      ["List: the slot item's prop label is missing."],
    );
  });

  it("a method that isn't exposed", async () => {
    const { components } = await approvedApi("button");
    expect(
      await differences("button", components, {
        file: "Button.vue",
        from: "defineExpose({ focus: () => element.value?.focus() });",
        to: "void element;",
      }),
    ).toEqual(["Button: the method focus is missing."]);
  });

  it("a method with a parameter of the wrong type", async () => {
    expect(
      await differences(
        "list",
        { List: listApi },
        { file: "List.vue", from: "index: number, smooth", to: "index: string, smooth" },
      ),
    ).toEqual(["List: the method scrollTo's parameter index has the type string; the approved API says number."]);
  });

  it("a type the mapping can't express", async () => {
    expect(
      await differences(
        "list",
        { List: listApi },
        { file: "List.vue", from: "select: [index: number]", to: "select: [item: { index: number }]" },
      ),
    ).toEqual(["List: the event select's payload has the type { index: number; }; the approved API says number."]);
  });

  it("a part's file that doesn't exist", async () => {
    const { components } = await approvedApi("tabs");
    const directory = path.join(project, "src/components/tabs");
    const panel = path.join(directory, "TabsPanel.vue");
    const text = await readFile(panel, "utf8");
    await rm(panel);
    try {
      expect(apiDifferences(components, reader.readComponent(directory, components))).toEqual([
        "TabsPanel: TabsPanel.vue is missing.",
      ]);
    } finally {
      await writeFile(panel, text);
    }
  });
});

describe("defaults", () => {
  it("reads JSON values, single-quoted strings, and keeps any other expression", () => {
    expect(parseDefault('"md"')).toBe("md");
    expect(parseDefault("false")).toBe(false);
    expect(parseDefault('["a"]')).toEqual(["a"]);
    expect(parseDefault("'md'")).toBe("md");
    expect(parseDefault("defaultSize")).toEqual({ expression: "defaultSize" });
  });
});
