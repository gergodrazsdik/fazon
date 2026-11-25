// SPDX-License-Identifier: GPL-3.0-or-later
import { AdapterError, type Spec } from "@fazon/core";
import { describe, expect, it } from "vitest";
import { apiFile, mapComponent, typeExpression } from "./api.js";
import { exampleSpec } from "./test-support.js";

const base: Spec = {
  fazon: 0,
  name: "Select",
  tier: "form-control",
  summary: "One option of a list.",
  props: {
    value: { type: "string", model: true },
    open: { type: "boolean", model: true, default: false },
    name: { type: "string" },
    sizes: { type: "array", items: { type: "enum", values: ["sm", "md"] }, default: ["sm"] },
  },
  events: { change: { payload: { type: "string", description: "The value." } }, dismiss: {} },
  slots: { default: { required: true }, item: { data: { label: { type: "string" }, index: { type: "number" } } } },
  methods: { focus: {}, select: { params: { index: { type: "number" } }, returns: { type: "boolean" } } },
  form: { value: "value", name: "name" },
  parts: { Option: { parent: "Select", count: "many", props: { value: { type: "string", required: true } } } },
};

describe("the Vue API mapping", () => {
  it("maps the model named value to modelValue, and each model to its update event", () => {
    const { components } = apiFile(mapComponent(base, "specs/select.md"), "specs/select.md");
    const select = components.Select;
    expect(Object.keys(select?.props ?? {})).toEqual(["modelValue", "open", "name", "sizes"]);
    expect(select?.events).toEqual({
      change: { payload: { type: "string" } },
      dismiss: {},
      "update:modelValue": { payload: { type: "string" } },
      "update:open": { payload: { type: "boolean" } },
    });
    expect(select?.props.open).toEqual({ type: "boolean", required: false, default: false });
    expect(select?.props.sizes).toEqual({
      type: "array",
      items: { type: "enum", values: ["sm", "md"] },
      required: false,
      default: ["sm"],
    });
  });

  it("maps slot data to scoped slot props, methods to exposed members, and parts to their own files", () => {
    const file = apiFile(mapComponent(base, "specs/select.md"), "specs/select.md");
    expect(file.components.Select?.slots).toEqual({
      default: { required: true, props: {} },
      item: { required: false, props: { label: { type: "string" }, index: { type: "number" } } },
    });
    expect(file.components.Select?.exposed).toEqual({
      focus: { params: {} },
      select: { params: { index: { type: "number" } }, returns: { type: "boolean" } },
    });
    expect(file.components.SelectOption).toMatchObject({ file: "SelectOption.vue", slots: {} });
    expect(file.form).toEqual({ value: "modelValue", name: "name" });
    expect(file.forward).toBe("Select");
  });

  it("gives a part's parent a default slot for its parts", () => {
    const tabs = apiFile(mapComponent(exampleSpec("tabs"), "specs/tabs.md"), "specs/tabs.md");
    expect(tabs.components.Tabs?.slots).toEqual({ default: { required: true, props: {} } });
    expect(tabs.components.TabsList?.slots).toEqual({ default: { required: false, props: {} } });
    const dialog = apiFile(mapComponent(exampleSpec("dialog"), "specs/dialog.md"), "specs/dialog.md");
    expect(dialog.forward).toBe("DialogContent");
  });

  it("applies extensions.vue: omit, add and map", () => {
    const spec: Spec = {
      ...base,
      extensions: {
        vue: {
          omit: { "events.dismiss": {}, "parts.Option.props.value": { reason: "Not needed" } },
          add: { "parts.Option.props.asChild": { type: "boolean", default: false }, "slots.empty": {} },
          map: { "props.value": { name: "selected" }, "methods.focus": { name: "focusInput" } },
        },
        react: { map: { "props.open": { controlled: true } } },
      },
    };
    const { components } = apiFile(mapComponent(spec, "specs/select.md"), "specs/select.md");
    expect(Object.keys(components.Select?.props ?? {})).toEqual(["selected", "open", "name", "sizes"]);
    expect(Object.keys(components.Select?.events ?? {})).toEqual(["change", "update:selected", "update:open"]);
    expect(Object.keys(components.Select?.slots ?? {})).toEqual(["default", "item", "empty"]);
    expect(Object.keys(components.Select?.exposed ?? {})).toEqual(["focusInput", "select"]);
    expect(components.SelectOption?.props).toEqual({ asChild: { type: "boolean", required: false, default: false } });
  });

  it.each([
    [{ options: { tag: "x" } }, /takes none/],
    [{ map: { "props.value": { name: "Selected" } } }, /must be \{ name: <camelCase> \}/],
    [{ map: { "props.value": { name: "selected", lazy: true } } }, /must be \{ name: <camelCase> \}/],
    [{ map: { "props.missing": { name: "other" } } }, /doesn't have/],
    [{ omit: { "slots.missing": {} } }, /doesn't have/],
    [{ add: { "props.name": { type: "string" } } }, /already has/],
    [{ map: { "props.name": { name: "open" } } }, /two props named open/],
    [{ add: { "parts.Missing.props.x": { type: "string" } } }, /no part Missing/],
  ])("refuses a block it can't apply: %j", (vue, message) => {
    const spec = { ...base, extensions: { vue } } as Spec;
    expect(() => mapComponent(spec, "specs/select.md")).toThrow(AdapterError);
    expect(() => mapComponent(spec, "specs/select.md")).toThrow(message);
  });

  it("writes TypeScript types", () => {
    expect(typeExpression({ type: "enum", values: ["sm", "md"] })).toBe('"sm" | "md"');
    expect(typeExpression({ type: "array", items: { type: "enum", values: ["a", "b"] } })).toBe('("a" | "b")[]');
    expect(typeExpression({ type: "array", items: { type: "enum", values: ["a"] } })).toBe('"a"[]');
    expect(typeExpression({ type: "array", items: { type: "number" } })).toBe("number[]");
  });
});
