// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parseSpecFile } from "./load.js";
import { applyProposal, proposalSchema, readProposal, type ProposedApi } from "./proposal.js";
import { checkSpec } from "./rules.js";

const example = (name: string) =>
  readFileSync(new URL(`../../../../docs/spec/examples/specs/valid/${name}.md`, import.meta.url), "utf8");

/** A spec as `fazon spec new` writes it, with its placeholders filled in. */
const fresh = [
  "---",
  "# Every field: docs/spec/spec-format.md in the Fazon repository.",
  "fazon: 0",
  "name: Badge",
  "tier: primitive",
  "summary: Shows a short status.",
  "# The API (props, events, slots, methods, forward, form, parts) comes from `fazon propose` and",
  "# `fazon approve`; states, a11y, fixtures, matrix and tokens build on it.",
  "---",
  "",
  "## Purpose",
  "",
  "A status label.",
  "",
  "## Behaviour",
  "",
  "- Doesn't respond to input.",
  "",
  "## Never",
  "",
  "- Never interactive.",
  "",
].join("\n");

/** An object without some of its keys. */
const without = (value: object, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

const spec = (text: string, file = "specs/badge.md") => {
  const parsed = parseSpecFile(file, text);
  if (parsed.spec === undefined) throw new Error(JSON.stringify(parsed.findings));
  return parsed.spec;
};

describe("proposalSchema", () => {
  const validate = new Ajv2020({ strict: false }).compile(proposalSchema());

  it("takes the API fields of a valid spec", () => {
    const tabs = spec(example("tabs"), "specs/tabs.md");
    const { props, events, slots, methods, extensions } = tabs;
    const parts = Object.fromEntries(
      Object.entries(tabs.parts ?? {}).map(([name, part]) => {
        return [name, without(part, ["states", "produce", "a11y"])];
      }),
    );
    expect(validate({ props, events, slots, methods, parts, extensions })).toBe(true);
  });

  it("refuses fields outside the API, on the component and on its parts", () => {
    expect(validate({ states: ["default"] })).toBe(false);
    expect(validate({ parts: { Item: { parent: "List", count: "many", states: ["default"] } } })).toBe(false);
    expect(validate({ props: { tone: { type: "enum" } } })).toBe(false);
  });
});

describe("readProposal", () => {
  const api = { props: { tone: { type: "string" } } };

  it("reads the structured output first", () => {
    expect(readProposal({ structuredOutput: api, finalText: "{}" })).toEqual({ api });
  });

  it("reads the final message: the whole of it, its last fenced block, or the object in it", () => {
    expect(readProposal({ finalText: JSON.stringify(api) })).toEqual({ api });
    expect(
      readProposal({ finalText: "Here:\n```json\n{}\n```\nand\n```json\n" + JSON.stringify(api) + "\n```\n" }),
    ).toEqual({
      api,
    });
    expect(readProposal({ finalText: `The API is ${JSON.stringify(api)}.` })).toEqual({ api });
  });

  it("says why an answer has no API", () => {
    expect(readProposal({ finalText: "I couldn't." })).toEqual({
      problem: "the agent's answer has no API: no JSON object in its structured output or final message",
    });
    expect(readProposal({})).toHaveProperty("problem");
    expect(readProposal({ structuredOutput: [api] })).toHaveProperty("problem");
    expect(readProposal({ structuredOutput: { ...api, states: ["default"], name: "X" } })).toEqual({
      problem:
        "the agent's answer has fields that aren't API fields: states, name; only props, events, slots, methods, forward, form, parts, extensions are",
    });
  });
});

describe("applyProposal", () => {
  const badgeApi: ProposedApi = {
    props: {
      tone: {
        type: "enum",
        values: ["neutral", "positive"],
        default: "neutral",
        description: "The status it shows, which sets its colours; a description long enough to pass eighty columns.",
      },
    },
    slots: { default: { required: true, description: "The label." } },
  };

  it("writes a new API after the summary, in the format's order, and keeps every other line", () => {
    const { text, changed } = applyProposal(fresh, spec(fresh), badgeApi, "vue");
    expect(changed).toEqual(["props", "slots"]);
    expect(text).toBe(
      fresh.replace(
        "summary: Shows a short status.\n",
        [
          "summary: Shows a short status.",
          "props:",
          "  tone:",
          "    type: enum",
          "    values:",
          "      - neutral",
          "      - positive",
          "    default: neutral",
          "    description: The status it shows, which sets its colours; a description long enough to pass eighty columns.",
          "slots:",
          "  default:",
          "    required: true",
          "    description: The label.",
          "",
        ].join("\n"),
      ),
    );
    const written = parseSpecFile("specs/badge.md", text);
    expect(written.spec).toMatchObject(badgeApi);
    expect(checkSpec(written, [written])).toEqual([]);
  });

  it("replaces and removes API fields in place, leaving the rest of the file byte for byte", () => {
    const button = example("button");
    const before = spec(button, "specs/button.md");
    const proposal: ProposedApi = {
      props: { size: { type: "enum", values: ["sm", "md"], default: "md" } },
      ...(before.events === undefined ? {} : { events: before.events }),
      ...(before.slots === undefined ? {} : { slots: before.slots }),
      forward: "root",
    };
    const { text, changed } = applyProposal(button, before, proposal, "vue");
    expect(changed).toEqual(["props", "methods"]);
    const after = spec(text, "specs/button.md");
    expect(after.props).toEqual(proposal.props);
    expect(after.methods).toBeUndefined();
    expect(without(after, ["props", "methods"])).toEqual(without(before, ["props", "methods"]));
    // Everything from `events:` on is the same text, without the methods block.
    const from = (source: string) => source.slice(source.indexOf("events:"));
    expect(from(text)).toBe(
      from(button).replace("methods:\n  focus:\n    description: Moves focus to the button.\n", ""),
    );
    expect(text.startsWith("---\n# A primitive: one element, no parts.\nfazon: 0\nname: Button\n")).toBe(true);
  });

  it("keeps a part's states, produce and a11y, and drops a part the proposal leaves out", () => {
    const tabs = example("tabs");
    const before = spec(tabs, "specs/tabs.md");
    const trigger = before.parts?.Trigger;
    expect(trigger?.states).toBeDefined();
    const proposal: ProposedApi = {
      ...(before.props === undefined ? {} : { props: before.props }),
      parts: { Trigger: { parent: "List", count: "many" }, List: { parent: "Tabs", count: "one" } },
    };
    const { text, changed } = applyProposal(tabs, before, proposal, "vue");
    expect(changed).toContain("parts");
    const after = spec(text, "specs/tabs.md");
    expect(after.parts?.Trigger).toEqual({
      parent: "List",
      count: "many",
      ...(trigger?.states === undefined ? {} : { states: trigger.states }),
      ...(trigger?.produce === undefined ? {} : { produce: trigger.produce }),
      ...(trigger?.a11y === undefined ? {} : { a11y: trigger.a11y }),
    });
    expect(Object.keys(after.parts ?? {})).toEqual(["Trigger", "List"]);
  });

  it("replaces the adapter's own extensions block, and keeps the other adapters' blocks", () => {
    const tabs = example("tabs");
    const before = spec(tabs, "specs/tabs.md");
    expect(Object.keys(before.extensions ?? {})).toEqual(expect.arrayContaining(["vue", "angular"]));
    const proposal: ProposedApi = {
      ...Object.fromEntries(
        Object.entries(before).filter(([key]) =>
          ["props", "events", "slots", "methods", "forward", "form", "parts"].includes(key),
        ),
      ),
      extensions: { vue: { reason: "Reka UI's composition pattern" } },
    };
    const after = spec(applyProposal(tabs, before, proposal, "vue").text, "specs/tabs.md");
    expect(after.extensions?.vue).toEqual({ reason: "Reka UI's composition pattern" });
    const others = Object.fromEntries(Object.entries(before.extensions ?? {}).filter(([id]) => id !== "vue"));
    expect(Object.fromEntries(Object.entries(after.extensions ?? {}).filter(([id]) => id !== "vue"))).toEqual(others);
  });

  it("changes nothing when the proposal is the spec's API", () => {
    const button = example("button");
    const before = spec(button, "specs/button.md");
    const { props, events, slots, methods, forward } = before;
    const api = { props, events, slots, methods, forward } as ProposedApi;
    expect(applyProposal(button, before, api, "vue")).toEqual({ text: button, changed: [] });
  });

  it("refuses a spec whose front matter can't be edited by field", () => {
    const flow = "---\n{ fazon: 0, name: Badge, tier: primitive, summary: A status. }\n---\n";
    expect(() => applyProposal(flow, spec(fresh), badgeApi, "vue")).toThrow(/block mapping/);
    expect(() => applyProposal("# Badge\n", spec(fresh), badgeApi, "vue")).toThrow(/front matter/);
  });
});
