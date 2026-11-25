// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseSpecFile } from "../spec/load.js";
import type { Part, Spec } from "../spec/types.js";
import { validateWithSchema } from "../validation/validate.js";
import { buildManifest, type BuildManifestOptions } from "./build.js";
import { MatrixError } from "./error.js";
import type { StoryManifest } from "./types.js";

const options: BuildManifestOptions = { file: "specs/chip.md", themes: ["light", "dark"] };

/** A small spec to vary: a Chip with two enum props, a boolean, and an optional part. */
function chip(overrides: Partial<Spec> = {}): Spec {
  return {
    fazon: 0,
    name: "Chip",
    tier: "primitive",
    summary: "A compact label.",
    props: {
      tone: { type: "enum", values: ["neutral", "info", "danger"], default: "info" },
      size: { type: "enum", values: ["sm", "md"] },
      removable: { type: "boolean" },
      disabled: { type: "boolean", default: false },
    },
    states: ["default", "hover", "disabled"],
    fixtures: {
      text: { slots: { default: "Draft" } },
      long: { extends: "text", slots: { default: "A label long enough to wrap" }, frame: { width: 80 } },
    },
    matrix: { axes: ["tone", "size"], fixtures: ["text", "long"] },
    ...overrides,
  };
}

function build(spec: Spec, more: Partial<BuildManifestOptions> = {}): StoryManifest {
  const manifest = buildManifest(spec, { ...options, ...more });
  expect(validateWithSchema("story-manifest", manifest)).toEqual([]);
  return manifest;
}

function names(manifest: StoryManifest): string[] {
  return manifest.stories.map((story) => story.name);
}

function failure(run: () => unknown): MatrixError {
  try {
    run();
  } catch (error) {
    if (error instanceof MatrixError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a MatrixError");
}

describe("the axes grid", () => {
  it("is every combination in product order, the first axis slowest, at the first fixture", () => {
    const axes = build(chip()).stories.filter((story) => story.grid === "axes");
    expect(axes.map((story) => [story.fixture, story.axes])).toEqual([
      ["text", { tone: "neutral", size: "sm" }],
      ["text", { tone: "neutral", size: "md" }],
      ["text", { tone: "info", size: "sm" }],
      ["text", { tone: "info", size: "md" }],
      ["text", { tone: "danger", size: "sm" }],
      ["text", { tone: "danger", size: "md" }],
    ]);
    expect(axes.every((story) => story.state.name === "default" && story.input === undefined)).toBe(true);
  });

  it("takes a boolean axis as false, then true", () => {
    const manifest = build(chip({ matrix: { axes: ["removable"] } }));
    expect(manifest.stories.filter((story) => story.grid === "axes").map((story) => story.axes)).toEqual([
      { removable: false },
      { removable: true },
    ]);
  });

  it("sets the root's axes in one entry, and a part's axis on every instance", () => {
    const spec = chip({
      parts: {
        Icon: { parent: "Chip", count: "many", props: { iconSize: { type: "enum", values: ["xs", "sm"] } } },
      },
      matrix: { axes: ["tone", "Icon.iconSize", "size"] },
    });
    const [first] = build(spec).stories;
    expect(first?.name).toBe("chip--text--tone-neutral--icon-icon-size-xs--size-sm--default");
    expect(first?.set).toEqual([
      { target: "root", props: { tone: "neutral", size: "sm" } },
      { target: "Icon[*]", props: { iconSize: "xs" } },
    ]);
  });

  it("is one story without axes, with no set", () => {
    const manifest = build(chip({ matrix: {}, states: [] }));
    expect(manifest.stories).toEqual([
      {
        name: "chip--text--default",
        storybookId: "chip--text-default",
        grid: "axes",
        fixture: "text",
        axes: {},
        state: { name: "default" },
        judge: ["light", "dark"],
      },
    ]);
  });

  it("rejects an axis that isn't an enum or boolean prop", () => {
    const spec = chip({
      props: { label: { type: "string" } },
      matrix: { axes: ["label"] },
    });
    expect(failure(() => buildManifest(spec, options))).toMatchObject({
      rule: "SPEC-010",
      path: "$.matrix.axes[0]",
    });
    expect(failure(() => buildManifest(chip({ matrix: { axes: ["shape"] } }), options)).rule).toBe("SPEC-010");
  });
});

describe("the states grid", () => {
  it("shows each state against the first axis's values, the other axes at their defaults", () => {
    const states = build(chip()).stories.filter((story) => story.grid === "states");
    expect(states.map((story) => story.name)).toEqual([
      "chip--text--tone-neutral--size-sm--hover",
      "chip--text--tone-info--size-sm--hover",
      "chip--text--tone-danger--size-sm--hover",
      "chip--text--tone-neutral--size-sm--disabled",
      "chip--text--tone-info--size-sm--disabled",
      "chip--text--tone-danger--size-sm--disabled",
    ]);
  });

  it("is one story per state without axes", () => {
    const manifest = build(chip({ matrix: {} }));
    expect(names(manifest)).toEqual(["chip--text--default", "chip--text--hover", "chip--text--disabled"]);
  });

  it("takes the component's states, then each part's in declaration order", () => {
    const spec = chip({
      matrix: {},
      states: ["hover"],
      parts: {
        Remove: { parent: "Chip", count: "optional", states: ["default", "focus-visible", "active"] },
        Badge: { parent: "Chip", count: "one", states: ["hover"] },
      },
    });
    expect(build(spec).stories.map((story) => story.state)).toEqual([
      { name: "default" },
      { name: "hover" },
      { name: "focus-visible", part: "Remove" },
      { name: "active", part: "Remove" },
      { name: "hover", part: "Badge" },
    ]);
  });

  it("gives a state whose recipe says story: false no story", () => {
    const spec = chip({ matrix: {}, produce: { disabled: { story: false } } });
    expect(names(build(spec))).toEqual(["chip--text--default", "chip--text--hover"]);
  });
});

describe("producing states", () => {
  const option: Part = {
    parent: "Chip",
    count: "many",
    props: { selected: { type: "boolean", default: false }, label: { type: "string" } },
    states: ["hover", "focus-visible", "active", "selected", "pressed"],
    produce: {
      pressed: { instance: 2, props: { label: "Pressed" }, input: [{ action: "click", target: "Option" }] },
      active: { instance: 2 },
    },
  };
  const spec = chip({
    matrix: {},
    states: ["open", "hover", "disabled"],
    produce: { open: { props: { removable: true }, input: [{ action: "press", key: "Enter" }] } },
    parts: { Option: option },
    fixtures: { text: { parts: { Option: [{}, {}, {}] } } },
  });
  const byState = new Map(build(spec).stories.map((story) => [story.name.split("--").at(-1), story]));

  it("uses a recipe's props and input, with `<Part>` as its first instance", () => {
    expect(byState.get("open")).toMatchObject({
      set: [{ target: "root", props: { removable: true } }],
      input: [{ action: "press", key: "Enter" }],
    });
    expect(byState.get("option-pressed")).toMatchObject({
      set: [{ target: "Option[2]", props: { label: "Pressed" } }],
      input: [{ action: "click", target: "Option[0]" }],
    });
  });

  it("sets a boolean prop of the state's name, on the root or the part's first instance", () => {
    expect(byState.get("disabled")?.set).toEqual([{ target: "root", props: { disabled: true } }]);
    expect(byState.get("option-selected")?.set).toEqual([{ target: "Option[0]", props: { selected: true } }]);
  });

  it("produces pseudo-states by input, on the root or `<Part>[default]`", () => {
    expect(byState.get("hover")?.input).toEqual([{ action: "hover", target: "root" }]);
    expect(byState.get("option-hover")?.input).toEqual([{ action: "hover", target: "Option[default]" }]);
    expect(byState.get("option-focus-visible")?.input).toEqual([{ action: "focus", target: "Option[default]" }]);
  });

  it("applies a recipe's instance to the rule that produces the state", () => {
    expect(byState.get("option-active")?.input).toEqual([{ action: "pointer-down", target: "Option[2]" }]);
  });

  it("fails SPEC-015 for a state it can't produce", () => {
    const highlighted = {
      ...option,
      states: [...(option.states ?? []), "highlighted"],
      produce: { ...option.produce, highlighted: { instance: 1 } },
    };
    const error = failure(() => buildManifest({ ...spec, parts: { Option: highlighted } }, options));
    expect(error).toMatchObject({ rule: "SPEC-015", path: "$.parts.Option.states[5]" });
    expect(error.message).toContain("highlighted of Option");
  });
});

describe("the fixtures grid", () => {
  it("renders each other fixture at the defaults, after the states grid", () => {
    const manifest = build(chip());
    const fixtures = manifest.stories.filter((story) => story.grid === "fixtures");
    expect(fixtures.map((story) => story.name)).toEqual(["chip--long--tone-info--size-sm--default"]);
    expect(manifest.stories.at(-1)?.grid).toBe("fixtures");
  });

  it("merges extends: props and slots by name, parts replaced per part, frame replaced", () => {
    const spec = chip({
      fixtures: {
        base: {
          description: "The base.",
          props: { tone: "danger", removable: true },
          slots: { default: "Base", icon: { icon: "check" } },
          parts: { Option: [{ props: { label: "a" } }], Badge: [{}] },
          frame: { width: 200 },
        },
        child: {
          extends: "base",
          props: { removable: false },
          slots: { default: "Child" },
          parts: { Option: [{ props: { label: "b" } }, { props: { label: "c" } }] },
          frame: { width: 100 },
        },
      },
      matrix: { fixtures: ["base", "child"] },
    });
    expect(buildManifest(spec, options).fixtures).toStrictEqual({
      base: {
        props: { tone: "danger", removable: true },
        slots: { default: "Base", icon: { icon: "check" } },
        parts: { Option: [{ props: { label: "a" } }], Badge: [{}] },
        frame: { width: 200 },
      },
      child: {
        props: { tone: "danger", removable: false },
        slots: { default: "Child", icon: { icon: "check" } },
        parts: { Option: [{ props: { label: "b" } }, { props: { label: "c" } }], Badge: [{}] },
        frame: { width: 100 },
      },
    });
  });

  it("renders only the spec's first fixture without matrix.fixtures", () => {
    const manifest = build(chip({ matrix: { axes: ["tone"] } }));
    expect(Object.keys(manifest.fixtures)).toEqual(["text"]);
    expect(manifest.stories.some((story) => story.grid === "fixtures")).toBe(false);
  });

  it("renders the empty fixture for a spec with no fixtures", () => {
    const { fixtures, ...rest } = chip();
    const manifest = build({ ...rest, matrix: { axes: ["size"] } });
    expect(manifest.fixtures).toEqual({ empty: {} });
    expect(manifest.stories[0]?.name).toBe("chip--empty--size-sm--default");
    expect(fixtures).toBeDefined();
  });

  it("fails on a fixture it can't find or merge", () => {
    expect(failure(() => buildManifest(chip({ matrix: { fixtures: ["text", "wide"] } }), options))).toMatchObject({
      rule: "SPEC-010",
      path: "$.matrix.fixtures[1]",
    });
    const cycle = chip({ fixtures: { a: { extends: "b" }, b: { extends: "a" } }, matrix: {} });
    expect(failure(() => buildManifest(cycle, options))).toMatchObject({
      rule: "SPEC-009",
      path: "$.fixtures.a.extends",
    });
    const missing = chip({ fixtures: { a: { extends: "z" } }, matrix: {} });
    expect(failure(() => buildManifest(missing, options)).message).toBe(
      "the fixture 'a' extends 'z', which doesn't exist",
    );
  });
});

describe("exclusions", () => {
  it("drop the stories of every grid that match every field of a condition", () => {
    const spec = chip({
      matrix: { axes: ["tone", "size"], fixtures: ["text", "long"], exclude: [{ props: { size: "sm" } }] },
    });
    const manifest = build(spec);
    expect(manifest.stories.filter((story) => story.grid === "axes").map((story) => story.axes)).toEqual([
      { tone: "neutral", size: "md" },
      { tone: "info", size: "md" },
      { tone: "danger", size: "md" },
    ]);
    // The default size is sm, so the states and fixtures grids are dropped whole.
    expect(manifest.stories.every((story) => story.grid === "axes")).toBe(true);
  });

  it("match a state of the component, or of the part the condition names", () => {
    const spec = chip({
      matrix: {
        axes: ["tone"],
        exclude: [
          { state: "hover", props: { tone: "danger" } },
          { part: "Remove", state: "hover" },
        ],
      },
      parts: { Remove: { parent: "Chip", count: "optional", states: ["hover"] } },
    });
    expect(names(build(spec)).filter((name) => name.includes("hover"))).toEqual([
      "chip--text--tone-neutral--hover",
      "chip--text--tone-info--hover",
    ]);
  });

  it("take a prop's value from the state, then the fixture, then its default", () => {
    const fromState = chip({ matrix: { axes: ["tone"], exclude: [{ props: { disabled: true } }] } });
    expect(names(build(fromState)).some((name) => name.endsWith("--disabled"))).toBe(false);
    expect(names(build(fromState))).toHaveLength(3 + 3);

    const fromFixture = chip({
      fixtures: { text: { props: { removable: true } }, plain: {} },
      matrix: { fixtures: ["text", "plain"], exclude: [{ props: { removable: true } }] },
    });
    expect(names(build(fromFixture))).toEqual(["chip--plain--default"]);

    const fromDefault = chip({ matrix: { fixtures: ["text", "long"], exclude: [{ props: { disabled: false } }] } });
    expect(names(build(fromDefault))).toEqual(["chip--text--disabled"]);
  });

  it("take a part's prop from the state on that part, else the part's first instance in the fixture", () => {
    const spec = chip({
      states: [],
      parts: {
        Option: {
          parent: "Chip",
          count: "many",
          props: { selected: { type: "boolean", default: false }, kind: { type: "enum", values: ["a", "b"] } },
          states: ["selected"],
        },
      },
      fixtures: {
        text: { parts: { Option: [{ props: { kind: "b" } }, { props: { kind: "a" } }] } },
        other: { parts: { Option: [{ props: { kind: "a" } }] } },
      },
      matrix: {
        fixtures: ["text", "other"],
        exclude: [{ props: { "Option.kind": "b" } }, { part: "Option", props: { selected: true } }],
      },
    });
    expect(names(build(spec))).toEqual(["chip--other--default"]);
  });
});

describe("forced stories", () => {
  it("add a combination the grids cut, in the order of matrix.include, seen by the judge in every theme", () => {
    const spec = chip({
      matrix: {
        axes: ["tone", "size"],
        fixtures: ["text", "long"],
        include: [
          { props: { size: "md" }, state: "hover" },
          { fixture: "long", props: { tone: "danger", size: "md" } },
        ],
      },
    });
    const included = build(spec).stories.filter((story) => story.grid === "include");
    expect(included).toEqual([
      {
        name: "chip--text--tone-info--size-md--hover",
        storybookId: "chip--text-tone-info-size-md-hover",
        grid: "include",
        fixture: "text",
        axes: { tone: "info", size: "md" },
        state: { name: "hover" },
        set: [{ target: "root", props: { tone: "info", size: "md" } }],
        input: [{ action: "hover", target: "root" }],
        judge: ["light", "dark"],
      },
      expect.objectContaining({ name: "chip--long--tone-danger--size-md--default", judge: ["light", "dark"] }),
    ]);
  });

  it("may render a fixture outside matrix.fixtures, which the manifest then lists", () => {
    const spec = chip({
      fixtures: {
        text: {},
        long: { slots: { default: "Long" } },
        icon: { extends: "long", slots: { icon: { icon: "x" } } },
      },
      matrix: { axes: ["tone"], fixtures: ["text", "long"], include: [{ fixture: "icon", state: "disabled" }] },
    });
    const manifest = build(spec);
    expect(Object.keys(manifest.fixtures)).toEqual(["text", "long", "icon"]);
    expect(manifest.fixtures.icon).toEqual({ slots: { default: "Long", icon: { icon: "x" } } });
    expect(manifest.stories.at(-1)).toMatchObject({
      name: "chip--icon--tone-info--disabled",
      set: [
        { target: "root", props: { tone: "info" } },
        { target: "root", props: { disabled: true } },
      ],
    });
  });

  it("produce a state whose recipe says story: false", () => {
    const spec = chip({
      matrix: { include: [{ state: "disabled" }, { part: "Tab", state: "selected" }] },
      produce: { disabled: { story: false } },
      parts: { Tab: { parent: "Chip", count: "many", states: ["selected"], produce: { selected: { story: false } } } },
    });
    const manifest = build(spec);
    expect(manifest.stories.map((story) => [story.grid, story.name])).toEqual([
      ["axes", "chip--text--default"],
      ["states", "chip--text--hover"],
      ["include", "chip--text--disabled"],
      ["include", "chip--text--tab-selected"],
    ]);
    expect(manifest.stories[2]?.set).toEqual([{ target: "root", props: { disabled: true } }]);
    expect(manifest.stories[3]?.set).toBeUndefined();
    expect(manifest.stories[3]?.input).toBeUndefined();
  });

  it("fail SPEC-017 for a story a grid already makes, or one an exclude condition drops", () => {
    const made = chip({ matrix: { axes: ["tone"], include: [{ props: { tone: "danger" }, state: "hover" }] } });
    const error = failure(() => buildManifest(made, options));
    expect(error).toMatchObject({ rule: "SPEC-017", path: "$.matrix.include[0]" });
    expect(error.message).toContain("the states grid already makes");

    const forced = { fixture: "long", props: { tone: "danger" } };
    const twice = chip({ matrix: { axes: ["tone"], fixtures: ["text", "long"], include: [forced, forced] } });
    expect(failure(() => buildManifest(twice, options))).toMatchObject({
      rule: "SPEC-017",
      path: "$.matrix.include[1]",
    });

    const dropped = chip({
      matrix: { axes: ["tone"], exclude: [{ props: { size: "md" } }], include: [{ state: "hover" }] },
      props: { ...chip().props, size: { type: "enum", values: ["sm", "md"], default: "md" } },
    });
    expect(failure(() => buildManifest(dropped, options)).message).toContain("matrix.exclude[0] drops");
  });

  it("fail SPEC-017 for a fixture, axis, value or state that doesn't exist", () => {
    const cases: [Spec["matrix"], string][] = [
      [{ include: [{ fixture: "wide" }] }, "$.matrix.include[0].fixture"],
      [{ axes: ["tone"], include: [{ props: { size: "md" } }] }, "$.matrix.include[0].props.size"],
      [{ axes: ["tone"], include: [{ props: { tone: "loud" } }] }, "$.matrix.include[0].props.tone"],
      [{ include: [{ state: "pressed" }] }, "$.matrix.include[0].state"],
      [{ include: [{ part: "Remove", state: "hover" }] }, "$.matrix.include[0].state"],
    ];
    for (const [matrix, path] of cases) {
      expect(
        failure(() => buildManifest(chip({ ...(matrix === undefined ? {} : { matrix }) }), options)),
      ).toMatchObject({
        rule: "SPEC-017",
        path,
      });
    }
  });
});

describe("themes", () => {
  it("put the default theme first; the judge sees the axes and include grids in every theme, the rest in the default", () => {
    const spec = chip({
      matrix: {
        axes: ["tone", "size"],
        fixtures: ["text", "long"],
        include: [{ props: { size: "md" }, state: "disabled" }],
      },
    });
    const manifest = build(spec, { themes: ["light", "dark", "contrast"], defaultTheme: "dark" });
    expect(manifest.themes).toEqual(["dark", "light", "contrast"]);
    const judge = Object.fromEntries(manifest.stories.map((story) => [story.grid, story.judge]));
    expect(judge).toEqual({
      axes: ["dark", "light", "contrast"],
      states: ["dark"],
      fixtures: ["dark"],
      include: ["dark", "light", "contrast"],
    });
  });

  it("must be a list with the default theme in it", () => {
    expect(() => buildManifest(chip(), { ...options, themes: [] })).toThrow("no themes");
    expect(() => buildManifest(chip(), { ...options, defaultTheme: "sepia" })).toThrow("isn't one of the themes");
    expect(() => buildManifest(chip(), { ...options, themes: ["light", "light"] })).toThrow("repeat");
  });
});

describe("the manifest", () => {
  it("shares no objects with the spec", () => {
    const spec = chip({ produce: { disabled: { props: { disabled: true, tone: "neutral" } } } });
    const manifest = buildManifest(spec, options);
    expect(manifest.fixtures.text).not.toBe(spec.fixtures?.text);
    expect(manifest.fixtures.text?.slots).not.toBe(spec.fixtures?.text?.slots);
    const disabled = manifest.stories.find((story) => story.state.name === "disabled");
    expect(disabled?.set?.at(-1)?.props).not.toBe(spec.produce?.disabled?.props);
  });

  it("is the same for the same spec", () => {
    expect(buildManifest(chip(), options)).toStrictEqual(buildManifest(chip(), options));
  });
});

describe("MatrixError", () => {
  it("is a finding in the spec file, at the line of its path", () => {
    const text = [
      "---",
      "fazon: 0",
      "name: Chip",
      "tier: primitive",
      "summary: A compact label.",
      "states: [pressed]",
      "---",
      "",
    ].join("\n");
    const file = parseSpecFile("specs/chip.md", text);
    const { spec } = file;
    if (spec === undefined) {
      throw new Error("the spec doesn't pass SPEC-001");
    }
    const error = failure(() => buildManifest(spec, options));
    expect(error.toFinding(file)).toEqual({
      rule: "SPEC-015",
      file: "specs/chip.md",
      path: "$.states[0]",
      line: 6,
      message:
        "the state pressed of Chip can't be produced: it has no recipe with props or input, no boolean prop of its name, and isn't hover, focus-visible or active",
    });
  });
});
