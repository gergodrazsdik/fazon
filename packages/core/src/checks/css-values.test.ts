// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { classifyComponent, isAllowedValue, looksLikeTokenValue, parseValue, splitValue } from "./css-values.js";
import { longhandInShorthand, physicalProperty, shorthandsOf } from "./token-properties.js";

describe("splitValue", () => {
  it("splits at spaces, commas and slashes, keeping functions and strings whole", () => {
    expect(splitValue("0 1px var(--a, 2px) rgb(0 0 0 / 50%)")).toEqual([
      "0",
      "1px",
      "var(--a, 2px)",
      "rgb(0 0 0 / 50%)",
    ]);
    expect(splitValue('Inter, "Helvetica Neue", sans-serif')).toEqual(["Inter", '"Helvetica Neue"', "sans-serif"]);
    expect(splitValue("500 var(--fs)/1.5 sans-serif")).toEqual(["500", "var(--fs)", "1.5", "sans-serif"]);
  });
});

describe("the allowed values", () => {
  it.each(["0", "0px", "0.0rem", "-0", "0%", "auto", "none", "normal", "inherit", "initial", "unset", "revert"])(
    "allow %s",
    (value) => {
      expect(isAllowedValue(value)).toBe(true);
    },
  );
  it.each(["currentColor", "currentcolor", "transparent", "100%", "TRANSPARENT", "rgba(0, 0, 0, 0)"])(
    "allow %s",
    (value) => {
      expect(isAllowedValue(value)).toBe(true);
    },
  );
  it.each(["1px", "0.5rem", "50%", "red", "#000", "bold", "ease", "1", "rgba(0, 0, 0, 0.5)"])(
    "don't allow %s",
    (value) => {
      expect(isAllowedValue(value)).toBe(false);
    },
  );
});

describe("the number patterns", () => {
  it.each(["0", "0px", "0.0em", ".0", "-0%", "00.00rem", "+0."])("read %s as zero", (value) => {
    expect(isAllowedValue(value)).toBe(true);
  });
  it.each(["0.5", "0.05px", "1a", ".", "0..0", "-"])("don't read %s as zero", (value) => {
    expect(isAllowedValue(value)).toBe(false);
  });
  it.each(["1.5", ".5", "1e3", "1.", "-2", "+3.25e-2"])("read %s as a number", (value) => {
    expect(classifyComponent(value).kind).toBe("number");
  });
  it.each(["1a", ".", "1.2.3", "e3"])("don't read %s as a number", (value) => {
    expect(classifyComponent(value).kind).toBe("literal");
  });

  it("take linear time on long runs of digits", () => {
    for (const digit of ["0", "1"]) {
      const value = `${digit.repeat(100_000)}x!`;
      const start = performance.now();
      isAllowedValue(value);
      classifyComponent(value);
      looksLikeTokenValue(value);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

describe("classifyComponent", () => {
  it("reads var() with and without a fallback", () => {
    expect(classifyComponent("var(--color-text-primary)")).toEqual({
      kind: "var",
      name: "--color-text-primary",
      text: "var(--color-text-primary)",
    });
    expect(classifyComponent("var(--_gap, var(--space-2))")).toMatchObject({
      kind: "var",
      name: "--_gap",
      fallback: "var(--space-2)",
    });
  });

  it("splits math functions into operands", () => {
    const calc = classifyComponent("calc(var(--space-2) * 2 - 1px)");
    expect(calc.kind).toBe("math");
    expect(calc.kind === "math" ? calc.operands.map((o) => [o.kind, o.text]) : []).toEqual([
      ["var", "var(--space-2)"],
      ["number", "2"],
      ["literal", "1px"],
    ]);
    const clamp = classifyComponent("clamp(0px, (var(--a) + var(--b)), 100%)");
    expect(clamp.kind === "math" ? clamp.operands.map((o) => o.kind) : []).toEqual(["allowed", "math", "allowed"]);
  });

  it("tells numbers from literals", () => {
    expect(parseValue("1.5 2px bold #fff").map((c) => c.kind)).toEqual(["number", "literal", "literal", "literal"]);
  });
});

describe("looksLikeTokenValue", () => {
  it.each(["2px", "1.5", "#2154d9", "red", "rgb(0 0 0)", "cubic-bezier(0, 0, 1, 1)"])("is true for %s", (v) => {
    expect(looksLikeTokenValue(v)).toBe(true);
  });
  it.each(["solid", "dashed", "opacity", "underline", "ease-in", "infinite"])("is false for %s", (v) => {
    expect(looksLikeTokenValue(v)).toBe(false);
  });
});

describe("the token-bound properties", () => {
  it("map logical longhands to physical ones, left to right", () => {
    expect(physicalProperty("padding-inline-start")).toBe("padding-left");
    expect(physicalProperty("margin-block-end")).toBe("margin-bottom");
    expect(physicalProperty("border-inline-end-color")).toBe("border-right-color");
    expect(physicalProperty("border-start-end-radius")).toBe("border-top-right-radius");
    expect(physicalProperty("grid-row-gap")).toBe("row-gap");
    expect(physicalProperty("color")).toBe("color");
  });

  it("know the shorthands of a longhand", () => {
    expect(shorthandsOf("padding-left")).toEqual(["padding", "padding-inline"]);
    expect(shorthandsOf("border-top-color")).toEqual([
      "border-color",
      "border-block-color",
      "border",
      "border-top",
      "border-block",
      "border-block-start",
    ]);
  });

  it("take box and pair components by position", () => {
    expect(longhandInShorthand("padding", "var(--a)", "padding-left")).toEqual({ value: "var(--a)", whole: false });
    expect(longhandInShorthand("padding", "var(--a) var(--b)", "padding-left")).toEqual({
      value: "var(--b)",
      whole: false,
    });
    expect(longhandInShorthand("padding", "var(--a) var(--b) var(--c)", "padding-bottom")?.value).toBe("var(--c)");
    expect(longhandInShorthand("padding", "var(--a) var(--b) var(--c)", "padding-left")?.value).toBe("var(--b)");
    expect(longhandInShorthand("margin", "1px 2px 3px 4px", "margin-left")?.value).toBe("4px");
    expect(longhandInShorthand("gap", "var(--a) var(--b)", "column-gap")?.value).toBe("var(--b)");
    expect(longhandInShorthand("gap", "var(--a)", "column-gap")?.value).toBe("var(--a)");
    expect(longhandInShorthand("border-radius", "var(--r)", "border-bottom-left-radius")?.value).toBe("var(--r)");
  });

  it("return other shorthands whole", () => {
    expect(longhandInShorthand("border", "var(--w) solid var(--c)", "border-top-color")).toEqual({
      value: "var(--w) solid var(--c)",
      whole: true,
    });
    expect(longhandInShorthand("border-radius", "var(--a) / var(--b)", "border-top-left-radius")?.whole).toBe(true);
    expect(longhandInShorthand("padding", "var(--a)", "color")).toBeUndefined();
  });
});
