// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from "vitest";
import type { TokenIndex } from "../tokens/build.js";
import type { InspectedElement, RenderedFont, StyleSource, TextFonts } from "./snapshot.js";
import { element, fixtureTokenIndex, style } from "./test-support.js";
import { checkTokens, conditionHolds, tokenRuleExpectations, tokenRuleLonghands } from "./tokens.js";

let index: TokenIndex;
beforeAll(async () => {
  index = await fixtureTokenIndex();
});

// The browser's own button styles, as the DevTools protocol reports them in the verifier image.
const userAgentButton = style(
  "user-agent",
  {
    "margin-top": "0em",
    color: "buttontext",
    "letter-spacing": "normal",
    "line-height": "normal",
    "font-family": "",
    "padding-block-start": "1px",
    "padding-inline-start": "6px",
    "border-top-width": "2px",
    "border-top-color": "buttonborder",
    "background-color": "buttonface",
  },
  { shorthands: { font: "" } },
);

// The fixtures' .button rule (docs/spec/examples/checks/tokens/pass.html).
const buttonRule = style(
  "author",
  {
    "margin-top": "0px",
    "padding-top": "",
    "padding-right": "",
    "padding-bottom": "",
    "padding-left": "",
    "border-top-width": "0px",
    "border-top-color": "transparent",
    "border-top-left-radius": "",
    "background-color": "var(--color-action-primary)",
    color: "var(--color-text-on-action)",
    "font-family": "inherit",
    "font-size": "inherit",
    "font-weight": "var(--font-weight-medium)",
    "line-height": "inherit",
    "letter-spacing": "normal",
  },
  {
    selector: ".button",
    shorthands: { padding: "var(--space-inset-sm) var(--space-inset-md)", "border-radius": "var(--radius-control)" },
  },
);

const button = (...extra: StyleSource[]): InspectedElement =>
  element({ styles: { matched: [userAgentButton, buttonRule, ...extra], inherited: [] } });

const rules = (elements: InspectedElement[], options: Partial<Parameters<typeof checkTokens>[0]> = {}) =>
  checkTokens({ elements, index, context: { story: "button--label--default", theme: "light" }, ...options }).map(
    (f) => [f.rule, f.actual],
  );

describe("checkTokens", () => {
  it("passes a button styled with role tokens", () => {
    expect(rules([button()])).toEqual([]);
  });

  it("finds a raw token (raw-token), with the story and theme", () => {
    const findings = checkTokens({
      elements: [button(style("author", { "background-color": "var(--color-blue-600)" }))],
      index,
      context: { story: "button--label--default", theme: "light" },
    });
    expect(findings).toEqual([
      expect.objectContaining({
        check: "tokens",
        rule: "raw-token",
        story: "button--label--default",
        theme: "light",
        part: "Button",
        selector: '[data-part="Button"]',
        expected: "a role token",
        actual: "color.blue.600",
        blocking: true,
      }),
    ]);
  });

  it("finds literals (raw-value), also inside math functions", () => {
    expect(
      rules([button(style("author", { "padding-left": "12px", "font-size": "calc(var(--font-size-body) * 1.25)" }))]),
    ).toEqual([["raw-value", "12px"]]);
    expect(rules([button(style("author", { "margin-top": "calc(var(--space-inset-sm) + 2px)" }))])).toEqual([
      ["raw-value", "2px"],
    ]);
  });

  it("finds custom properties that are no token (unknown-token)", () => {
    expect(rules([button(style("author", { color: "var(--brand)" }))])).toEqual([["unknown-token", "--brand"]]);
    expect(rules([button(style("author", { color: "var(--_undefined)" }))])).toEqual([
      ["unknown-token", "--_undefined"],
    ]);
  });

  it("follows component-local properties on the element and its ancestors", () => {
    const local = style("author", { "--_fg": "var(--color-text-primary)", color: "var(--_fg)" });
    expect(rules([button(local)])).toEqual([]);
    const inheritedRaw: InspectedElement = element({
      styles: {
        matched: [userAgentButton, buttonRule, style("author", { color: "var(--_fg)" })],
        inherited: [[style("author", { "--_fg": "#ff0000" })]],
      },
    });
    expect(rules([inheritedRaw])).toEqual([["raw-value", "#ff0000"]]);
  });

  it("checks only the token-like literals of a shorthand whose parts can't be told apart", () => {
    const border = style(
      "author",
      { "border-top-color": "", "border-top-width": "" },
      { shorthands: { border: "var(--radius-control) solid #000" } },
    );
    expect(rules([button(border)])).toEqual([["raw-value", "#000"]]);
  });

  it("finds the browser's own values where no author declaration applies (user-agent)", () => {
    const plain = element({
      styles: {
        matched: [userAgentButton, style("author", { "background-color": "var(--color-action-primary)" })],
        inherited: [],
      },
    });
    expect(rules([plain])).toEqual([
      ["user-agent", "buttontext"],
      ["user-agent", "buttonborder"],
      ["user-agent", "1px"],
      ["user-agent", "6px"],
      ["user-agent", "2px"],
      ["user-agent", "(the browser's font)"],
    ]);
  });

  it("ignores implicit and unset properties", () => {
    const outline = style("author", { "outline-width": "(implicit)", "outline-color": "(implicit)" });
    expect(rules([button(outline)])).toEqual([]);
  });

  it("applies the token rules (token-rule), following inherited values to the frame's base styles", () => {
    const label = element({
      selector: '[data-part="Button"] > span:nth-child(1)',
      tag: "span",
      partRoot: false,
      parent: 0,
      styles: { matched: [], inherited: [] },
    });
    const expected = (e: InspectedElement) =>
      e.partRoot
        ? new Map([
            ["background-color", "color.action.primary"],
            ["color", "color.text.primary"],
          ])
        : new Map([
            ["color", "color.text.on-action"],
            ["font-size", "font-size.body"],
          ]);
    const findings = checkTokens({ elements: [button(), label], index, expected });
    expect(findings.map((f) => [f.selector, f.rule, f.expected, f.actual])).toEqual([
      ['[data-part="Button"]', "token-rule", "color.text.primary", "color.text.on-action"],
    ]);
  });

  it("refuses an element inspected without styles", () => {
    expect(() => checkTokens({ elements: [element()], index })).toThrow(/without its styles/);
  });
});

describe("pseudo-elements", () => {
  // A checkbox-like control whose mark is its ::before.
  const withPseudo = (
    pseudoElements: InspectedElement["pseudoElements"],
    ...extra: StyleSource[]
  ): InspectedElement => ({
    ...button(...extra),
    ...(pseudoElements === undefined ? {} : { pseudoElements }),
  });
  const mark = (declarations: Record<string, string>, origin: StyleSource["origin"] = "author") =>
    style(origin, { content: '""', ...declarations }, { selector: ".button::before" });

  it("finds a raw colour in a ::before, named by its originating element's selector and part", () => {
    const findings = checkTokens({
      elements: [
        withPseudo([
          { pseudo: "::before", styles: { matched: [mark({ "background-color": "#2154d9" })], inherited: [] } },
        ]),
      ],
      index,
      context: { story: "button--label--default", theme: "light" },
    });
    expect(findings).toEqual([
      expect.objectContaining({
        check: "tokens",
        rule: "raw-value",
        part: "Button",
        selector: '[data-part="Button"]::before',
        actual: "#2154d9",
        blocking: true,
      }),
    ]);
  });

  it("applies the same rules to every pseudo-element it inspected", () => {
    const pseudo = [
      {
        pseudo: "::before",
        styles: { matched: [mark({ "background-color": "var(--color-action-primary)" })], inherited: [] },
      },
      {
        pseudo: "::after",
        styles: { matched: [mark({ "border-top-color": "var(--color-blue-600)" })], inherited: [] },
      },
      { pseudo: "::marker", styles: { matched: [mark({ color: "var(--brand)" })], inherited: [] } },
    ] as const;
    const findings = checkTokens({ elements: [withPseudo(pseudo)], index });
    expect(findings.map((f) => [f.selector, f.rule, f.actual])).toEqual([
      ['[data-part="Button"]::after', "raw-token", "color.blue.600"],
      ['[data-part="Button"]::marker', "unknown-token", "--brand"],
    ]);
  });

  it("follows a component-local property to its originating element", () => {
    const own = style("author", { "--_mark": "var(--color-text-on-action)" }, { selector: ".button" });
    const inherited = [[own]];
    const local = withPseudo(
      [{ pseudo: "::before", styles: { matched: [mark({ "background-color": "var(--_mark)" })], inherited } }],
      own,
    );
    expect(rules([local])).toEqual([]);
    const raw = style("author", { "--_mark": "#ffffff" }, { selector: ".button" });
    const rawLocal = withPseudo(
      [{ pseudo: "::before", styles: { matched: [mark({ "background-color": "var(--_mark)" })], inherited: [[raw]] } }],
      raw,
    );
    expect(rules([rawLocal])).toEqual([["raw-value", "#ffffff"]]);
  });

  it("finds a placeholder that keeps the browser's colour (user-agent)", () => {
    const userAgent = style("user-agent", { color: "rgb(117, 117, 117)" }, { selector: "::-webkit-input-placeholder" });
    const placeholder = (...extra: StyleSource[]) =>
      withPseudo([{ pseudo: "::placeholder", styles: { matched: [userAgent, ...extra], inherited: [] } }]);
    expect(checkTokens({ elements: [placeholder()], index }).map((f) => [f.selector, f.rule, f.actual])).toEqual([
      ['[data-part="Button"]::placeholder', "user-agent", "rgb(117, 117, 117)"],
    ]);
    expect(rules([placeholder(style("author", { color: "var(--color-text-primary)" }))])).toEqual([]);
  });

  it("leaves inherited values to the element that declares them, and token rules to the part's root", () => {
    const expected = () => new Map([["background-color", "color.action.primary"]]);
    const inheriting = withPseudo([{ pseudo: "::before", styles: { matched: [mark({})], inherited: [] } }]);
    expect(checkTokens({ elements: [inheriting], index, expected })).toEqual([]);
  });
});

describe("font-fallback", () => {
  const dejaVu: RenderedFont = { family: "DejaVu Sans", postScriptName: "DejaVuSans", custom: false, glyphs: 12 };
  const inter: RenderedFont = { family: "Inter", postScriptName: "Inter-Regular", custom: true, glyphs: 12 };
  const withFonts = (fonts: Partial<TextFonts>, ...extra: StyleSource[]): InspectedElement => ({
    ...button(...extra),
    fonts: {
      family: '"Inter Variable", Inter, system-ui, sans-serif',
      first: "Inter Variable",
      faces: [],
      rendered: [],
      ...fonts,
    },
  });

  it("passes text rendered with a loaded web font of the first family", () => {
    const fonts = { faces: ["unloaded", "loaded"], rendered: [inter, { ...dejaVu, glyphs: 1 }] };
    expect(rules([withFonts(fonts)])).toEqual([]);
  });

  it("finds a first family that no face declares and no installed font provides", () => {
    const findings = checkTokens({
      elements: [withFonts({ family: "Inter, system-ui, sans-serif", first: "Inter", rendered: [dejaVu] })],
      index,
    });
    expect(findings).toEqual([
      expect.objectContaining({
        check: "tokens",
        rule: "font-fallback",
        selector: '[data-part="Button"]',
        expected: "Inter",
        actual: "DejaVu Sans",
        blocking: true,
      }),
    ]);
    expect(findings[0]?.message).toMatch(/font-family \(font-family\.body\) names Inter first.*no font face/);
  });

  it("finds a web font whose faces haven't loaded, or that rendered nothing", () => {
    expect(rules([withFonts({ faces: ["error"], rendered: [dejaVu] })])).toEqual([["font-fallback", "DejaVu Sans"]]);
    expect(rules([withFonts({ faces: ["loaded"], rendered: [dejaVu] })])).toEqual([["font-fallback", "DejaVu Sans"]]);
  });

  it("passes an installed font by its family or PostScript name, and generic families", () => {
    expect(rules([withFonts({ first: "DejaVu Sans", rendered: [dejaVu] })])).toEqual([]);
    expect(rules([withFonts({ first: "dejavusans", rendered: [dejaVu] })])).toEqual([]);
    expect(rules([withFonts({ first: "system-ui", rendered: [dejaVu] })])).toEqual([]);
    expect(rules([withFonts({ first: "Inter", rendered: [] })])).toEqual([]);
  });

  it("leaves out a font family that doesn't come from a token", () => {
    const raw = style("author", { "font-family": "Inter, sans-serif" }, { selector: ".raw" });
    expect(rules([withFonts({ first: "Inter", rendered: [dejaVu] }, raw)]).map(([rule]) => rule)).toEqual([
      "raw-value",
      "raw-value",
    ]);
  });
});

describe("token rules", () => {
  it("hold by props and states", () => {
    expect(conditionHolds(undefined, {}, [])).toBe(true);
    expect(conditionHolds({ props: { variant: "primary" } }, { variant: "primary" }, [])).toBe(true);
    expect(conditionHolds({ props: { variant: "primary" } }, { variant: "ghost" }, [])).toBe(false);
    expect(conditionHolds({ state: "hover" }, {}, ["hover"])).toBe(true);
    expect(conditionHolds({ state: "default" }, {}, [])).toBe(true);
    expect(conditionHolds({ state: "default" }, {}, ["selected"])).toBe(false);
  });

  it("expand shorthands to longhands", () => {
    expect(tokenRuleLonghands("border-color")).toEqual([
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
    ]);
    expect(tokenRuleLonghands("padding-inline-start")).toEqual(["padding-left"]);
  });

  it("pick the most specific matching rule for each property", () => {
    const expected = tokenRuleExpectations(
      [
        {
          when: { props: { variant: "primary" } },
          use: { "background-color": "color.action.primary", color: "color.text.on-action" },
        },
        {
          when: { props: { variant: "primary" }, state: "hover" },
          use: { "background-color": "color.action.primary-hover" },
        },
        { part: "Icon", use: { color: "color.text.primary" } },
      ],
      { component: "Button", props: () => ({ variant: "primary" }) },
    );
    const hovered = expected(element({ states: ["hover"] }));
    expect(Object.fromEntries(hovered ?? [])).toEqual({
      "background-color": "color.action.primary-hover",
      color: "color.text.on-action",
    });
    expect(Object.fromEntries(expected(element()) ?? [])["background-color"]).toBe("color.action.primary");
    expect(expected(element({ part: "Icon" }))?.get("color")).toBe("color.text.primary");
    expect(expected(element({ partRoot: false }))).toBeUndefined();
  });
});
