// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { stripImportant, winningDeclarations } from "./cascade.js";
import { style } from "./test-support.js";

const winner = (sources: Parameters<typeof winningDeclarations>[0], property: string) => {
  const declaration = winningDeclarations(sources).get(property);
  return declaration === undefined ? undefined : [declaration.origin, declaration.value, declaration.declaredAs];
};

describe("winningDeclarations", () => {
  it("lets later sources win, and author styles beat the browser's", () => {
    const sources = [
      style("user-agent", { "padding-inline-start": "6px", color: "buttontext" }),
      style("author", { color: "var(--a)" }, { selector: ".b" }),
      style("author", { color: "var(--b)" }, { selector: ".b" }),
    ];
    expect(winner(sources, "color")).toEqual(["author", "var(--b)", "color"]);
    expect(winner(sources, "padding-left")).toEqual(["user-agent", "6px", "padding-inline-start"]);
  });

  it("treats logical and physical forms as one property, in cascade order", () => {
    const sources = [
      style("author", { "padding-left": "var(--a)" }),
      style("author", { "padding-inline-start": "var(--b)" }),
    ];
    expect(winner(sources, "padding-left")).toEqual(["author", "var(--b)", "padding-inline-start"]);
  });

  it("puts important declarations above normal ones and the inline style", () => {
    const sources = [
      style("author", { color: "var(--a) !important" }),
      style("author", { color: "var(--b)" }),
      style("inline", { color: "var(--c)" }),
    ];
    expect(winner(sources, "color")).toEqual(["author", "var(--a)", "color"]);
    expect(winner([...sources, style("inline", { color: "var(--d) !important" })], "color")?.[1]).toBe("var(--d)");
    expect(winner([style("user-agent", { color: "red !important" }), ...sources], "color")?.[0]).toBe("user-agent");
  });

  it("reverses layer order for important declarations", () => {
    const sources = [
      style("author", { color: "var(--first) !important" }, { layer: "base" }),
      style("author", { color: "var(--second) !important" }, { layer: "components" }),
      style("author", { color: "var(--unlayered) !important" }),
    ];
    expect(winner(sources, "color")?.[1]).toBe("var(--first)");
    const normal = [
      style("author", { color: "var(--first)" }, { layer: "base" }),
      style("author", { color: "var(--unlayered)" }),
    ];
    expect(winner(normal, "color")?.[1]).toBe("var(--unlayered)");
  });

  it("reads a longhand left empty by a shorthand with a custom property from the shorthand", () => {
    const sources = [
      style(
        "author",
        { "padding-top": "", "padding-right": "", "padding-bottom": "", "padding-left": "" },
        { shorthands: { padding: "var(--y) var(--x)" } },
      ),
    ];
    expect(winner(sources, "padding-right")).toEqual(["author", "var(--x)", "padding"]);
    const border = winningDeclarations([
      style("author", { "border-top-color": "" }, { shorthands: { border: "var(--w) solid var(--c)" } }),
    ]).get("border-top-color");
    expect(border).toMatchObject({ value: "var(--w) solid var(--c)", whole: true, declaredAs: "border" });
  });

  it("marks implicit longhands, which keep their initial value", () => {
    const sources = [
      style("user-agent", { "outline-width": "2px" }),
      style("author", { "outline-width": "(implicit)" }),
    ];
    expect(winningDeclarations(sources).get("outline-width")).toMatchObject({ origin: "author", implicit: true });
  });

  it("keeps custom properties by name", () => {
    expect(winner([style("author", { "--_bg": "var(--color-action-primary)" })], "--_bg")?.[1]).toBe(
      "var(--color-action-primary)",
    );
  });
});

describe("stripImportant", () => {
  it("removes a trailing !important", () => {
    expect(stripImportant("4px !important")).toBe("4px");
    expect(stripImportant("4px")).toBe("4px");
    expect(stripImportant("var(--a) ! IMPORTANT  ")).toBe("var(--a)");
    expect(stripImportant("4px important")).toBe("4px important");
  });

  it("takes linear time on long runs of spaces", () => {
    const start = performance.now();
    stripImportant(`4px${" ".repeat(100_000)}x`);
    stripImportant(`4px!${" ".repeat(100_000)}x`);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
