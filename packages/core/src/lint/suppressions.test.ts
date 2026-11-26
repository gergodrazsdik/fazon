// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { inlineSuppression, normalizeLiteral, tokenBoundProperty } from "../index.js";
import { isAllowedValue, isUnitlessNumber } from "./properties.js";

describe("inlineSuppression", () => {
  it.each([
    [" eslint-disable-next-line no-console", "eslint-disable-next-line"],
    [" eslint-disable-line", "eslint-disable-line"],
    ["eslint-disable", "eslint-disable"],
    [" eslint-enable ", "eslint-enable"],
    [" eslint no-console: off ", "eslint"],
    [" stylelint-disable-next-line fazon/raw-value", "stylelint-disable-next-line"],
    [" stylelint-disable", "stylelint-disable"],
    [" stylelint-enable", "stylelint-enable"],
    [" @ts-ignore", "@ts-ignore"],
    [" @ts-expect-error: the types are wrong", "@ts-expect-error"],
    ["* @ts-nocheck", "@ts-nocheck"],
    ["\n * eslint-disable\n ", "eslint-disable"],
  ])("finds %j", (text, directive) => {
    expect(inlineSuppression(text)).toBe(directive);
  });

  it.each([" a comment about eslint-disable", " eslint-disabled", " @ts-check", " eslintrc", " eslint", " stylelint"])(
    "leaves %j",
    (text) => {
      expect(inlineSuppression(text)).toBeUndefined();
    },
  );

  it("takes an adapter's own directives", () => {
    expect(inlineSuppression(" @vue-ignore", ["@vue-ignore"])).toBe("@vue-ignore");
    expect(inlineSuppression(" @vue-ignore")).toBeUndefined();
  });
});

describe("the token-bound values", () => {
  it("allows zero with any unit and the allowed keywords", () => {
    for (const value of ["0", "0px", "-0", "0.0rem", ".0em", "0%", "0ms", "AUTO", "currentColor", "100%"]) {
      expect(isAllowedValue(value), value).toBe(true);
    }
    for (const value of ["1px", "0.5rem", "50%", "red", "revert-layer", "10"]) {
      expect(isAllowedValue(value), value).toBe(false);
    }
  });

  it("tells a unitless number", () => {
    expect(["2", "-1", "0.5", ".5", "1e3", "+3"].every(isUnitlessNumber)).toBe(true);
    expect(["2px", "1.", "x", "--1", "1e"].map(isUnitlessNumber)).toEqual([false, true, false, false, false]);
  });

  it("knows the properties and leaves positioning and sizing out", () => {
    expect(tokenBoundProperty("Padding-Inline-Start")?.types).toEqual(["dimension"]);
    expect(tokenBoundProperty("border-end-start-radius")?.types).toEqual(["dimension"]);
    expect(tokenBoundProperty("border-block-color")?.types).toEqual(["color"]);
    expect(tokenBoundProperty("border")?.free).toBeDefined();
    for (const property of ["top", "left", "inset", "transform", "width", "height", "opacity", "z-index"]) {
      expect(tokenBoundProperty(property), property).toBeUndefined();
    }
  });

  it("normalises literals for comparison with a token's value", () => {
    expect(normalizeLiteral("#FFF")).toBe("#ffffff");
    expect(normalizeLiteral("0.10s")).toBe("100ms");
    expect(normalizeLiteral(".875rem")).toBe("0.875rem");
    expect(normalizeLiteral(" Inter,  sans-serif ")).toBe("inter, sans-serif");
  });

  it("checks long inputs in linear time", () => {
    const long = "1".repeat(100_000);
    const started = performance.now();
    expect(isAllowedValue(`${long}x`)).toBe(false);
    expect(isUnitlessNumber(`${long}x`)).toBe(false);
    expect(normalizeLiteral(`${long}.${long}#`)).toBe(`${long}.${long}#`);
    expect(inlineSuppression(`${" ".repeat(100_000)}x`)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
