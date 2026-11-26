// SPDX-License-Identifier: GPL-3.0-or-later
// SPEC-003 to SPEC-018, one rule at a time: a spec that keeps the rule, and specs that break it.
import { describe, expect, it } from "vitest";
import { axeRuleIds, catalogueRule } from "./catalogue.js";
import type { SpecCheckInputs } from "./inputs.js";
import { parseSpecFile, type SpecFile } from "./load.js";
import { checkSpec, specNotes } from "./rules.js";

const body = "\n## Purpose\n\nA label.\n\n## Behaviour\n\n- None.\n\n## Never\n\n- Never a button.\n";

/** A Chip spec: the required fields, then `extra` (YAML at the top level). */
function chip(extra = "", text = body, file = "specs/chip.md"): SpecFile {
  const parsed = parseSpecFile(
    file,
    `---\nfazon: 0\nname: Chip\ntier: primitive\nsummary: A chip.\n${extra}---\n${text}`,
  );
  expect(parsed.findings).toEqual([]);
  return parsed;
}

const inputs: SpecCheckInputs = {
  tokens: { paths: new Set(["color.text.primary", "color.blue.500"]), roles: new Set(["color.text.primary"]) },
  icons: new Set(["check"]),
  adapter: {
    id: "vue",
    extensionSchema: {
      map: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: { name: { type: "string" } },
      },
    },
  },
};

/** The findings of one rule, as `[path, message]`. */
function findings(rule: string, file: SpecFile, all: readonly SpecFile[] = [file], given = inputs) {
  return checkSpec(file, all, given)
    .filter((finding) => finding.rule === rule)
    .map((finding) => [finding.path ?? `line ${String(finding.line)}`, finding.message]);
}

/** Every finding's rule, to see that a spec breaks only the rule a test is about. */
function rules(file: SpecFile, all: readonly SpecFile[] = [file]) {
  return [...new Set(checkSpec(file, all, inputs).map((finding) => finding.rule))];
}

const tone = "props:\n  tone:\n    type: enum\n    values: [neutral, positive]\n    default: neutral\n";

describe("SPEC-003: the body's headings", () => {
  it("holds with Purpose, Behaviour and Never, closing hashes and other headings allowed", () => {
    expect(rules(chip("", "\n## Purpose ##\n\n## Extra\n\n## Behaviour\n\n  ## Never\n"))).toEqual([]);
  });

  it("finds each missing heading, at the body's first line", () => {
    const file = chip("", "\n## Purpose\n\n### Behaviour\n\n```md\n## Never\n```\n");
    expect(findings("SPEC-003", file)).toEqual([
      ["line 7", "the body has no '## Behaviour' heading"],
      ["line 7", "the body has no '## Never' heading"],
    ]);
  });
});

describe("SPEC-004: defaults", () => {
  it("holds for an enum default among its values and array items of their type", () => {
    const file = chip(`${tone}  tags:\n    type: array\n    items: { type: string }\n    default: [a, b]\n`);
    expect(rules(file)).toEqual([]);
  });

  it("finds an enum default outside its values and an array item of the wrong type", () => {
    const file = chip(
      "props:\n  tone:\n    type: enum\n    values: [neutral]\n    default: loud\n  sizes:\n    type: array\n    items: { type: enum, values: [sm] }\n    default: [sm, xl]\n",
    );
    expect(findings("SPEC-004", file)).toEqual([
      ["$.props.tone.default", "the default of tone, 'loud', isn't one of its values: neutral"],
      ["$.props.sizes.default", "the default of sizes has an item 1, 'xl', that isn't one of its values: sm"],
    ]);
  });

  it("checks the props an extension adds", () => {
    const file = chip(
      "extensions:\n  vue:\n    add:\n      props.tone:\n        type: enum\n        values: [a]\n        default: b\n",
    );
    expect(findings("SPEC-004", file)).toEqual([
      ["$.extensions.vue.add.props.tone.default", "the default of props.tone, 'b', isn't one of its values: a"],
    ]);
  });
});

const parts = (yaml: string) => `parts:\n${yaml}`;

describe("SPEC-005: parts", () => {
  it("holds for parts of the component and of other parts", () => {
    const file = chip(parts("  List:\n    parent: Chip\n    count: one\n  Item:\n    parent: List\n    count: many\n"));
    expect(rules(file)).toEqual([]);
  });

  it("finds an unknown parent, a cycle, the component's name and a many part under a many part", () => {
    const file = chip(
      parts(
        "  A:\n    parent: B\n    count: one\n  B:\n    parent: A\n    count: one\n  C:\n    parent: Nope\n    count: one\n" +
          "  Chip:\n    parent: Chip\n    count: one\n  D:\n    parent: Chip\n    count: many\n  E:\n    parent: D\n    count: many\n",
      ),
    );
    expect(findings("SPEC-005", file)).toEqual([
      ["$.parts.A.parent", "the parts' parents form a cycle: A → B → A"],
      ["$.parts.C.parent", "the parent of C, Nope, is neither the component Chip nor one of its parts"],
      ["$.parts.Chip", "the part Chip has the component's name"],
      [
        "$.parts.E.parent",
        "E and its parent D are both 'many' parts; in format version 0 a 'many' part can't hold another (F-0006)",
      ],
    ]);
  });
});

describe("SPEC-006: one name across props, events and methods", () => {
  it("holds when a slot shares a prop's name", () => {
    const file = chip("props:\n  icon:\n    type: string\nslots:\n  icon:\n    description: An icon.\n");
    expect(rules(file)).toEqual([]);
  });

  it("finds a name used twice, in the component and in a part", () => {
    const file = chip(
      "props:\n  focus:\n    type: boolean\nmethods:\n  focus:\n    description: Focuses it.\n" +
        parts(
          "  Close:\n    parent: Chip\n    count: one\n    props:\n      press:\n        type: boolean\n    events:\n      press: {}\n",
        ),
    );
    expect(findings("SPEC-006", file)).toEqual([
      ["$.methods.focus", "Chip has both a prop and a method named focus"],
      ["$.parts.Close.events.press", "Close has both a prop and an event named press"],
    ]);
  });
});

describe("SPEC-007: references between fields", () => {
  it("holds for forward, form and a11y that name what exists", () => {
    const file = chip(
      "props:\n  value:\n    type: string\n    model: true\n  label:\n    type: string\nform:\n  value: value\nforward: Input\n" +
        "a11y:\n  name: prop:label\n  describedBy: part:Input\n  focus:\n    initial: Input\n" +
        parts("  Input:\n    parent: Chip\n    count: one\n"),
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unknown names, and a form value that isn't a model prop", () => {
    const file = chip(
      "props:\n  value:\n    type: string\nform:\n  value: value\n  name: field\nforward: Input\n" +
        "a11y:\n  name: prop:label\n  describedBy: part:Hint\n  focus:\n    roving: Item\n",
    );
    expect(findings("SPEC-007", file)).toEqual([
      ["$.forward", "forward names Input, which is neither root nor a part"],
      ["$.form.value", "form.value names value, which isn't a model prop"],
      ["$.form.name", "form.name names field, which isn't a prop of Chip"],
      ["$.a11y.name", "a11y.name names the prop label, which Chip doesn't have"],
      ["$.a11y.describedBy", "a11y.describedBy names the part Hint, which Chip doesn't have"],
      ["$.a11y.focus.roving", "a11y.focus.roving names the part Item, which Chip doesn't have"],
    ]);
  });
});

describe("SPEC-008: uses", () => {
  it("holds when each used component has a spec and each component node is listed", () => {
    const button = parseSpecFile(
      "specs/button.md",
      `---\nfazon: 0\nname: Button\ntier: primitive\nsummary: A button.\nslots:\n  default:\n    required: true\n---\n${body}`,
    );
    const file = chip(
      "uses: [Button]\nslots:\n  default:\n    required: true\nfixtures:\n  one:\n    slots:\n      default: { component: Button, slots: { default: Go } }\n",
    );
    expect(rules(file, [file, button])).toEqual([]);
  });

  it("finds a use without a spec, and a component node uses doesn't list", () => {
    const file = chip(
      "uses: [Avatar]\nslots:\n  default:\n    required: true\nfixtures:\n  one:\n    slots:\n      default: [{ component: Badge }]\n",
    );
    expect(findings("SPEC-008", file)).toEqual([
      ["$.uses[0]", "uses names Avatar, which has no spec"],
      ["$.fixtures.one.slots.default[0].component", "the fixture renders Badge, which uses doesn't list"],
    ]);
  });
});

describe("SPEC-009: fixtures", () => {
  const api =
    tone +
    "  count:\n    type: number\n  label:\n    type: string\n    required: true\nslots:\n  default:\n    required: true\n  icon: {}\n";

  it("holds for fixtures that extend each other and set what exists", () => {
    const file = chip(
      `${api}fixtures:\n  base:\n    props: { label: A, tone: positive }\n    slots: { default: Go }\n  more:\n    extends: base\n    slots: { icon: { icon: check } }\n`,
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unknown and mistyped props, unknown slots and icons, and missing required ones", () => {
    const file = chip(
      `${api}fixtures:\n  one:\n    props: { tone: loud, count: two, size: lg }\n    slots: { default: Go, footer: x, icon: { icon: nope } }\n`,
    );
    expect(findings("SPEC-009", file)).toEqual([
      [
        "$.fixtures.one.props.tone",
        "the prop tone of Chip is set to 'loud', which isn't one of its values: neutral, positive",
      ],
      ["$.fixtures.one.props.count", "the prop count of Chip is set to 'two', which isn't a number"],
      ["$.fixtures.one.props.size", "Chip has no prop size"],
      ["$.fixtures.one.slots.footer", "Chip has no slot footer"],
      ["$.fixtures.one.slots.icon.icon", "the icon nope isn't in the icon set"],
      ["$.fixtures.one", "the fixture one doesn't set the prop label, which Chip requires"],
    ]);
  });

  it("doesn't check icons without an icon set", () => {
    const file = chip(`${api}fixtures:\n  one:\n    props: { label: A }\n    slots: { default: { icon: nope } }\n`);
    expect(findings("SPEC-009", file, [file], {})).toEqual([]);
  });

  it("finds an unknown base and a cycle", () => {
    const file = chip(`${api}fixtures:\n  a:\n    extends: b\n  b:\n    extends: a\n  c:\n    extends: nope\n`);
    expect(findings("SPEC-009", file)).toEqual([
      ["$.fixtures.a.extends", "the fixtures extend each other in a cycle: a → b → a"],
      ["$.fixtures.c.extends", "the fixture c extends nope, which isn't a fixture"],
    ]);
  });

  it("finds instances that don't fit their part's count, and what a part's instance sets", () => {
    const file = chip(
      parts(
        "  List:\n    parent: Chip\n    count: one\n  Item:\n    parent: List\n    count: many\n    props:\n      value:\n        type: string\n        required: true\n  Hint:\n    parent: Chip\n    count: optional\n",
      ) +
        "fixtures:\n  one:\n    parts:\n      Item:\n        - props: { value: a }\n        - props: { other: b }\n      Hint: [{}, {}]\n      Nope: [{}]\n",
    );
    expect(findings("SPEC-009", file)).toEqual([
      ["$.fixtures.one.parts.Item[1].props.other", "Item has no prop other"],
      ["$.fixtures.one.parts.Item[1]", "the prop value of Item isn't set, and Item requires it"],
      ["$.fixtures.one.parts.Nope", "the fixture one sets instances of Nope, which isn't a part of Chip"],
      [
        "$.fixtures.one",
        "the fixture one has 0 instances of List, whose count is one; it needs exactly one for each instance of its parent: 1",
      ],
      [
        "$.fixtures.one.parts.Item",
        "the fixture one has 2 instances of Item, whose count is many; it needs none, as its parent List has no instance",
      ],
      [
        "$.fixtures.one.parts.Hint",
        "the fixture one has 2 instances of Hint, whose count is optional; it needs at most one for each instance of its parent: 1",
      ],
    ]);
  });

  it("checks a component node against the used component's spec", () => {
    const button = parseSpecFile(
      "specs/button.md",
      `---\nfazon: 0\nname: Button\ntier: primitive\nsummary: A button.\n${tone}slots:\n  default:\n    required: true\n---\n${body}`,
    );
    const file = chip(
      "uses: [Button]\nslots:\n  default: {}\nfixtures:\n  one:\n    slots:\n      default: { component: Button, props: { tone: loud }, slots: { icon: x } }\n",
    );
    expect(findings("SPEC-009", file, [file, button])).toEqual([
      [
        "$.fixtures.one.slots.default.props.tone",
        "the prop tone of Button is set to 'loud', which isn't one of its values: neutral, positive",
      ],
      ["$.fixtures.one.slots.default.slots.icon", "Button has no slot icon"],
      ["$.fixtures.one.slots.default", "the slot default of Button isn't set, and Button requires it"],
    ]);
  });
});

describe("SPEC-010: the matrix", () => {
  it("holds for enum and boolean axes, part axes and listed fixtures", () => {
    const file = chip(
      `${tone}  flat:\n    type: boolean\n` +
        parts(
          "  Icon:\n    parent: Chip\n    count: one\n    props:\n      size:\n        type: enum\n        values: [sm, md]\n",
        ) +
        "fixtures:\n  one:\n    parts: { Icon: [{}] }\nmatrix:\n  axes: [tone, flat, Icon.size]\n  fixtures: [one]\n",
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds an axis of another type or no prop, an unknown fixture and an exclude's unknown part", () => {
    const file = chip(
      "props:\n  label:\n    type: string\nmatrix:\n  axes: [label, size, Nope.size]\n  fixtures: [one]\n  exclude:\n    - { part: Nope, state: hover }\n",
    );
    expect(findings("SPEC-010", file)).toEqual([
      ["$.matrix.axes[0]", "the axis label is a string prop; an axis is an enum or a boolean"],
      ["$.matrix.axes[1]", "the axis size names no prop of Chip"],
      ["$.matrix.axes[2]", "the axis Nope.size names the part Nope, which Chip doesn't have"],
      ["$.matrix.fixtures[0]", "matrix.fixtures names one, which isn't a fixture"],
      ["$.matrix.exclude[0].part", "matrix.exclude[0] names the part Nope, which Chip doesn't have"],
    ]);
  });
});

describe("SPEC-011: token rules", () => {
  it("holds for role tokens and different conditions", () => {
    const file = chip(
      `${tone}tokens:\n  - use: { color: color.text.primary }\n  - when: { props: { tone: positive } }\n    use: { color: color.text.primary }\n`,
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unknown and raw tokens, an unknown part and a property set twice", () => {
    const file = chip(
      `${tone}tokens:\n  - when: { props: { tone: positive }, state: default }\n    use: { color: color.nope, background-color: color.blue.500 }\n` +
        "  - when: { state: default, props: { tone: positive } }\n    use: { color: color.text.primary }\n  - part: Nope\n    use: { color: color.text.primary }\n",
    );
    expect(findings("SPEC-011", file)).toEqual([
      ["$.tokens[0].use.color", "color uses color.nope, which isn't in the token set"],
      ["$.tokens[0].use.background-color", "background-color uses color.blue.500, which is a raw token"],
      ["$.tokens[1].use.color", "token rules 0 and 1 both set color for the same part and condition"],
      ["$.tokens[2].part", "the token rule names the part Nope, which Chip doesn't have"],
    ]);
  });

  it("doesn't check token names without a token set", () => {
    const file = chip("tokens:\n  - use: { color: color.nope }\n");
    expect(findings("SPEC-011", file, [file], {})).toEqual([]);
  });
});

describe("SPEC-012: exemptions", () => {
  const exemption = (yaml: string) => `exemptions:\n${yaml}`;

  it("holds for a rendered check's exemption with a part and fixture, an axe rule, and a source check's", () => {
    const file = chip(
      parts("  Body:\n    parent: Chip\n    count: one\n") +
        "fixtures:\n  long:\n    parts: { Body: [{}] }\n" +
        exemption(
          "  - { check: layout, rule: scroll, part: Body, fixture: long, reason: It scrolls. }\n  - { check: a11y, rule: color-contrast, reason: A logo. }\n  - { check: lint, rule: raw-value, reason: A hairline. }\n",
        ),
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unknown checks and rules, rules that can't be exempted, and a source check's place", () => {
    const file = chip(
      exemption(
        "  - { check: style, rule: x, reason: r }\n  - { check: layout, rule: wrap, reason: r }\n  - { check: lint, rule: eslint, reason: r }\n" +
          "  - { check: visual, rule: orphan, reason: r }\n  - { check: build, rule: types, fixture: one, reason: r }\n" +
          "  - { check: a11y, rule: region, part: Nope, fixture: none, reason: r }\n",
      ),
    );
    expect(findings("SPEC-012", file).map(([path]) => path)).toEqual([
      "$.exemptions[0].check",
      "$.exemptions[1].rule",
      "$.exemptions[2].rule",
      "$.exemptions[3].rule",
      "$.exemptions[4].fixture",
      "$.exemptions[5].rule",
      "$.exemptions[5].part",
      "$.exemptions[5].fixture",
    ]);
    expect(findings("SPEC-012", file)[2]?.[1]).toBe("the lint rule eslint can't be exempted");
    expect(findings("SPEC-012", file)[4]?.[1]).toBe(
      "the exemption of the source check build names a fixture; a source check's exemption applies to all of the component's files",
    );
  });

  it("knows axe's rules, without those the check turns off", () => {
    expect(axeRuleIds().has("button-name")).toBe(true);
    expect(axeRuleIds().has("region")).toBe(false);
    expect(catalogueRule("a11y", "spec-role")).toBe(true);
    expect(catalogueRule("visual", "changed")).toBe(false);
    expect(catalogueRule("test", "missing-behaviour")).toBe(true);
    expect(catalogueRule("layout", "nope")).toBeUndefined();
  });
});

describe("SPEC-013: extensions", () => {
  const extension = (yaml: string) => `${tone}slots:\n  default: {}\nextensions:\n${yaml}`;

  it("holds for paths into the neutral API, an added replacement and a valid map", () => {
    const file = chip(
      extension(
        "  vue:\n    map:\n      props.tone: { name: color }\n    add:\n      props.asChild: { type: boolean }\n    omit:\n      slots.default: { instead: props.asChild }\n",
      ),
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds paths that don't exist or already do, a bad instead, and what the adapter's schema rejects", () => {
    const file = chip(
      extension(
        "  vue:\n    options: { a: 1 }\n    map:\n      props.size: { name: big }\n      props.tone: { label: x }\n    add:\n      props.tone: { type: string }\n      parts.Icon.props.size: { type: string }\n" +
          "    omit:\n      events.close: {}\n      slots.default: { instead: props.nope }\n",
      ),
    );
    expect(findings("SPEC-013", file)).toEqual([
      ["$.extensions.vue.map.props.size", "extensions.vue.map names props.size, which the neutral API doesn't have"],
      [
        "$.extensions.vue.omit.events.close",
        "extensions.vue.omit names events.close, which the neutral API doesn't have",
      ],
      ["$.extensions.vue.add.props.tone", "extensions.vue.add adds props.tone, which the neutral API already has"],
      [
        "$.extensions.vue.add.parts.Icon.props.size",
        "extensions.vue.add adds parts.Icon.props.size, but Chip has no part Icon",
      ],
      [
        "$.extensions.vue.omit.slots.default.instead",
        "extensions.vue.omit.slots.default names props.nope instead, which is neither in the neutral API nor added",
      ],
      ["$.extensions.vue.options", "the vue adapter takes no options"],
      ["$.extensions.vue.map.props.tone", "extensions.vue.map.props.tone: missing required key 'name'"],
      ["$.extensions.vue.map.props.tone.label", "extensions.vue.map.props.tone: unknown key 'label'"],
    ]);
  });

  it("checks only the paths of another adapter's block, and notes it", () => {
    const file = chip(
      extension("  react:\n    options: { anything: true }\n    map:\n      props.tone: { prop: color }\n"),
    );
    expect(rules(file)).toEqual([]);
    expect(specNotes(file, inputs)).toEqual([expect.objectContaining({ path: "$.extensions.react", line: 14 })]);
  });
});

describe("SPEC-014: conditions", () => {
  it("holds for props and states of the condition's part", () => {
    const file = chip(
      `${tone}states: [hover]\n` +
        parts(
          "  Icon:\n    parent: Chip\n    count: one\n    props:\n      spin:\n        type: boolean\n    states: [default, hover]\n",
        ) +
        "fixtures:\n  one:\n    parts: { Icon: [{}] }\n" +
        "tokens:\n  - part: Icon\n    when: { props: { spin: true }, state: hover }\n    use: { color: color.text.primary }\n  - when: { state: default }\n    use: { color: color.text.primary }\n" +
        "matrix:\n  axes: [tone]\n  exclude:\n    - { props: { tone: positive, Icon.spin: true } }\n    - { part: Icon, state: hover }\n",
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unknown props and states, values of the wrong type, and an exclude's unknown part prop", () => {
    const file = chip(
      `${tone}states: [hover]\n` +
        "tokens:\n  - when: { props: { tone: loud, size: lg }, state: pressed }\n    use: { color: color.text.primary }\n" +
        "judge:\n  - id: hovered\n    question: Q?\n    select: { when: { props: { tone: 1 } } }\n" +
        "matrix:\n  exclude:\n    - { props: { Nope.size: lg } }\n",
    );
    expect(findings("SPEC-014", file)).toEqual([
      [
        "$.tokens[0].when.props.tone",
        "the condition sets tone to 'loud', which isn't one of its values: neutral, positive",
      ],
      ["$.tokens[0].when.props.size", "the condition names the prop size, which Chip doesn't have"],
      ["$.tokens[0].when.state", "the condition names the state pressed, which Chip doesn't list in its states"],
      [
        "$.judge[0].select.when.props.tone",
        "the condition sets tone to 1, which isn't one of its values: neutral, positive",
      ],
      ["$.matrix.exclude[0].props.Nope.size", "the condition names Nope.size, but Chip has no part Nope"],
    ]);
  });
});

describe("SPEC-015: states can be produced", () => {
  it("holds for a recipe, a boolean prop, a pseudo-state and a story: false state", () => {
    const file = chip(
      "props:\n  disabled:\n    type: boolean\nstates: [default, disabled, hover, focus-visible, active, open, shown]\nproduce:\n  open:\n    input: [{ action: click, target: root }]\n  shown:\n    story: false\n",
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds a state with nothing to produce it, in the component and in a part", () => {
    const file = chip(
      "states: [pressed]\nproduce:\n  pressed:\n    story: true\n" +
        parts("  Icon:\n    parent: Chip\n    count: one\n    states: [spinning]\n"),
    );
    expect(findings("SPEC-015", file).map(([path]) => path)).toEqual(["$.states[0]", "$.parts.Icon.states[0]"]);
  });
});

describe("SPEC-016: recipes", () => {
  const list = parts(
    "  Item:\n    parent: Chip\n    count: many\n    props:\n      on:\n        type: boolean\n    states: [picked]\n    produce:\n      picked:\n        instance: 1\n        props: { on: true }\n",
  );

  it("holds for listed states, existing props and targets, and instances the fixtures have", () => {
    const file = chip(
      `states: [open]\nproduce:\n  open:\n    input: [{ action: click, target: 'Item[1]' }]\n${list}fixtures:\n  two:\n    parts: { Item: [{}, {}] }\n`,
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds unlisted states, unknown props and targets, a component's instance, and instances the fixtures lack", () => {
    const file = chip(
      "states: [open]\nproduce:\n  open:\n    instance: 0\n    props: { wide: true }\n    input: [{ action: hover, target: Nope }, { action: click, target: 'Item[3]' }]\n  closed:\n    story: false\n" +
        `${list}fixtures:\n  one:\n    parts: { Item: [{}] }\n`,
    );
    expect(findings("SPEC-016", file)).toEqual([
      ["$.produce.open.props.wide", "Chip has no prop wide"],
      ["$.produce.open.input[0].target", "the input target Nope names no part of Chip"],
      [
        "$.produce.open.input[1].target",
        "the input targets Item[3], but the fixture one, which the stories of open render, has 1 instance of Item",
      ],
      [
        "$.produce.open.instance",
        "the recipe for open sets instance, but open is a state of the component, not of a part",
      ],
      ["$.produce.closed", "produce has a recipe for closed, which Chip doesn't list in its states"],
      [
        "$.parts.Item.produce.picked.instance",
        "instance names Item[1], but the fixture one, which the stories of picked render, has 1 instance of Item",
      ],
    ]);
  });

  it("finds recipe values that don't fit their prop's type, as SPEC-009 does for fixtures", () => {
    const file = chip(
      `${tone}  busy:\n    type: boolean\nstates: [busy, loud]\nproduce:\n  busy:\n    props: { busy: "yes" }\n  loud:\n    props: { tone: loud }\n`,
    );
    expect(findings("SPEC-016", file)).toEqual([
      ["$.produce.busy.props.busy", "the prop busy of Chip is set to 'yes', which isn't a boolean"],
      [
        "$.produce.loud.props.tone",
        "the prop tone of Chip is set to 'loud', which isn't one of its values: neutral, positive",
      ],
    ]);
    expect(findings("SPEC-009", file)).toEqual([]);
  });
});

describe("SPEC-017: forced stories", () => {
  const matrix = `${tone}states: [default, hover]\nfixtures:\n  one: { description: One. }\n  two: { description: Two. }\nmatrix:\n  axes: [tone]\n  fixtures: [one]\n`;

  it("holds for a story the grids don't make", () => {
    const file = chip(`${matrix}  include:\n    - { fixture: two, props: { tone: positive } }\n`);
    expect(rules(file)).toEqual([]);
  });

  it("finds an unknown fixture, axis, value, part and state", () => {
    const file = chip(
      `${matrix}  include:\n    - { fixture: three, props: { size: lg, tone: loud }, state: pressed }\n    - { part: Nope, state: hover }\n`,
    );
    expect(findings("SPEC-017", file)).toEqual([
      ["$.matrix.include[0].fixture", "matrix.include[0] names three, which isn't a fixture"],
      ["$.matrix.include[0].props.size", "matrix.include[0] sets size, which isn't an axis"],
      [
        "$.matrix.include[0].props.tone",
        "matrix.include[0] sets tone to 'loud', which isn't one of its values: neutral, positive",
      ],
      ["$.matrix.include[0].state", "matrix.include[0] names the state pressed, which Chip doesn't list"],
      ["$.matrix.include[1].part", "matrix.include[1] names the part Nope, which Chip doesn't have"],
    ]);
  });

  it("finds a story an exclusion drops, as the story matrix rules expand the spec", () => {
    const file = chip(
      `${matrix}  exclude:\n    - { props: { tone: positive }, state: hover }\n  include:\n    - { props: { tone: positive }, state: hover }\n`,
    );
    expect(findings("SPEC-017", file)).toEqual([
      ["$.matrix.include[0]", "matrix.include[0] forces a story that matrix.exclude[0] drops"],
    ]);
  });
});

describe("SPEC-018: judge questions", () => {
  const judge = `${tone}states: [default, loading]\nproduce:\n  loading:\n    story: false\nfixtures:\n  one: { description: One. }\nmatrix:\n  axes: [tone]\n`;

  it("holds for own ids and selects that pick a story", () => {
    const file = chip(
      `${judge}judge:\n  - id: tone-positive\n    question: Q?\n    select: { fixture: one, when: { props: { tone: positive } } }\n  - id: all\n    question: Q?\n`,
    );
    expect(rules(file)).toEqual([]);
  });

  it("finds repeated and derived ids, unknown fixtures and parts, and a select that picks nothing", () => {
    const file = chip(
      `${judge}judge:\n  - { id: shape, question: Q? }\n  - { id: shape, question: Q? }\n  - { id: family, question: Q? }\n  - { id: axis-tone, question: Q? }\n` +
        "  - { id: a, question: Q?, select: { fixture: two, part: Nope } }\n  - { id: b, question: Q?, select: { when: { state: loading } } }\n",
    );
    expect(findings("SPEC-018", file)).toEqual([
      ["$.judge[1].id", "judge questions 0 and 1 share the id shape"],
      [
        "$.judge[2].id",
        "the id family is, or looks like, the name of a question the harness derives (story, axis-…, state-…, appearance-…, reference, family, change-…)",
      ],
      [
        "$.judge[3].id",
        "the id axis-tone is, or looks like, the name of a question the harness derives (story, axis-…, state-…, appearance-…, reference, family, change-…)",
      ],
      ["$.judge[4].select.fixture", "select names the fixture two, which isn't a fixture"],
      ["$.judge[4].select.part", "select names the part Nope, which Chip doesn't have"],
      ["$.judge[5].select", "select picks none of Chip's stories"],
    ]);
  });
});
