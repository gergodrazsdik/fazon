// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";
import { exampleSpec } from "./test-support.js";

describe("vueAdapter", () => {
  it("is the adapter that fazon.yaml names `vue`", () => {
    expect(vueAdapter.id).toBe("vue");
  });

  it("names a file for the component and one for each part, and lets the agent write .vue, .ts and .css", () => {
    const files = vueAdapter.componentFiles(exampleSpec("tabs"));
    expect(files.files).toEqual([
      { name: "Tabs", exportName: "Tabs", file: "Tabs.vue" },
      { name: "List", part: "List", exportName: "TabsList", file: "TabsList.vue" },
      { name: "Trigger", part: "Trigger", exportName: "TabsTrigger", file: "TabsTrigger.vue" },
      { name: "Panel", part: "Panel", exportName: "TabsPanel", file: "TabsPanel.vue" },
    ]);
    expect(files.patterns).toEqual(["*.vue", "*.ts", "*.css"]);
  });

  it("takes map values that rename a member, and no options", () => {
    expect(vueAdapter.extensionSchema.options).toBeUndefined();
    expect(vueAdapter.extensionSchema.map).toMatchObject({ required: ["name"], additionalProperties: false });
  });
});
