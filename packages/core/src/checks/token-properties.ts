// SPDX-License-Identifier: GPL-3.0-or-later
// The token-bound properties (docs/spec/check-catalogue.md#token-bound-properties) as physical
// longhands, the logical forms that map onto them, and the shorthands that set them.
import { splitValue } from "./css-values.js";

const sides = ["top", "right", "bottom", "left"] as const;
const corners = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

/** The groups of the catalogue's table. */
export type TokenGroup = "colour" | "spacing" | "shape" | "type" | "elevation" | "motion";

interface Bound {
  readonly group: TokenGroup;
  /** The token `$type`s whose tokens fit the property, to tell a shorthand's references apart. */
  readonly types: readonly string[];
}

const colour: Bound = { group: "colour", types: ["color"] };
const spacing: Bound = { group: "spacing", types: ["dimension"] };
const shape: Bound = { group: "shape", types: ["dimension"] };

/** Every token-bound longhand, by its physical name. */
export const tokenBoundProperties: ReadonlyMap<string, Bound> = new Map<string, Bound>([
  ["color", colour],
  ["background-color", colour],
  ...sides.map((s): [string, Bound] => [`border-${s}-color`, colour]),
  ["outline-color", colour],
  ["text-decoration-color", colour],
  ["caret-color", colour],
  ["accent-color", colour],
  ["fill", colour],
  ["stroke", colour],
  ["column-rule-color", colour],
  ...sides.map((s): [string, Bound] => [`padding-${s}`, spacing]),
  ...sides.map((s): [string, Bound] => [`margin-${s}`, spacing]),
  ["row-gap", spacing],
  ["column-gap", spacing],
  ...corners.map((c): [string, Bound] => [`border-${c}-radius`, shape]),
  ...sides.map((s): [string, Bound] => [`border-${s}-width`, shape]),
  ["outline-width", shape],
  ["outline-offset", shape],
  ["font-family", { group: "type", types: ["fontFamily"] }],
  ["font-size", { group: "type", types: ["dimension"] }],
  ["font-weight", { group: "type", types: ["fontWeight"] }],
  ["line-height", { group: "type", types: ["number", "dimension"] }],
  ["letter-spacing", { group: "type", types: ["dimension"] }],
  ["box-shadow", { group: "elevation", types: ["shadow"] }],
  ["transition-duration", { group: "motion", types: ["duration"] }],
  ["transition-delay", { group: "motion", types: ["duration"] }],
  ["transition-timing-function", { group: "motion", types: ["cubicBezier"] }],
  ["animation-duration", { group: "motion", types: ["duration"] }],
  ["animation-delay", { group: "motion", types: ["duration"] }],
  ["animation-timing-function", { group: "motion", types: ["cubicBezier"] }],
]);

// Logical sides in a horizontal, left-to-right writing mode: right-to-left is out of scope for
// version 1 (docs/spec/story-matrix.md#content).
const logicalSides: Readonly<Record<string, string>> = {
  "block-start": "top",
  "block-end": "bottom",
  "inline-start": "left",
  "inline-end": "right",
};
const logicalCorners: Readonly<Record<string, string>> = {
  "start-start": "top-left",
  "start-end": "top-right",
  "end-start": "bottom-left",
  "end-end": "bottom-right",
};
const aliases: Readonly<Record<string, string>> = {
  "grid-row-gap": "row-gap",
  "grid-column-gap": "column-gap",
};

/** A longhand's physical name: `padding-inline-start` is `padding-left`. */
export function physicalProperty(name: string): string {
  const alias = aliases[name];
  if (alias !== undefined) return alias;
  let match = /^(padding|margin)-(block-start|block-end|inline-start|inline-end)$/.exec(name);
  if (match !== null) return `${match[1] ?? ""}-${logicalSides[match[2] ?? ""] ?? ""}`;
  match = /^border-(block-start|block-end|inline-start|inline-end)-(color|width|style)$/.exec(name);
  if (match !== null) return `border-${logicalSides[match[1] ?? ""] ?? ""}-${match[2] ?? ""}`;
  match = /^border-(start-start|start-end|end-start|end-end)-radius$/.exec(name);
  if (match !== null) return `border-${logicalCorners[match[1] ?? ""] ?? ""}-radius`;
  return name;
}

/** How a shorthand's components map to its longhands. */
type Layout = "box" | "pair" | "whole";

interface Shorthand {
  /** Physical longhands, in the order the box or pair layout assigns components. */
  readonly longhands: readonly string[];
  readonly layout: Layout;
}

const box = (prefix: string, suffix = ""): Shorthand => ({
  longhands: sides.map((s) => `${prefix}-${s}${suffix}`),
  layout: "box",
});
const pair = (...longhands: string[]): Shorthand => ({ longhands, layout: "pair" });
const whole = (...longhands: string[]): Shorthand => ({ longhands, layout: "whole" });
const sideOf = (side: string): string[] => [`border-${side}-width`, `border-${side}-color`];

/** The shorthands that set token-bound longhands. */
export const tokenShorthands: ReadonlyMap<string, Shorthand> = new Map<string, Shorthand>([
  ["padding", box("padding")],
  ["margin", box("margin")],
  ["border-width", box("border", "-width")],
  ["border-color", box("border", "-color")],
  ["border-radius", { longhands: corners.map((c) => `border-${c}-radius`), layout: "box" }],
  ["padding-block", pair("padding-top", "padding-bottom")],
  ["padding-inline", pair("padding-left", "padding-right")],
  ["margin-block", pair("margin-top", "margin-bottom")],
  ["margin-inline", pair("margin-left", "margin-right")],
  ["border-block-width", pair("border-top-width", "border-bottom-width")],
  ["border-inline-width", pair("border-left-width", "border-right-width")],
  ["border-block-color", pair("border-top-color", "border-bottom-color")],
  ["border-inline-color", pair("border-left-color", "border-right-color")],
  ["gap", pair("row-gap", "column-gap")],
  ["grid-gap", pair("row-gap", "column-gap")],
  ["border", whole(...sides.flatMap(sideOf))],
  ...sides.map((s): [string, Shorthand] => [`border-${s}`, whole(...sideOf(s))]),
  ["border-block", whole(...sideOf("top"), ...sideOf("bottom"))],
  ["border-inline", whole(...sideOf("left"), ...sideOf("right"))],
  ...Object.entries(logicalSides).map(([l, p]): [string, Shorthand] => [`border-${l}`, whole(...sideOf(p))]),
  ["outline", whole("outline-color", "outline-width")],
  ["text-decoration", whole("text-decoration-color")],
  ["column-rule", whole("column-rule-color")],
  ["background", whole("background-color")],
  ["caret", whole("caret-color")],
  ["font", whole("font-family", "font-size", "font-weight", "line-height")],
  ["transition", whole("transition-duration", "transition-delay", "transition-timing-function")],
  ["animation", whole("animation-duration", "animation-delay", "animation-timing-function")],
]);

/** The shorthands, as written, that can set a physical longhand. */
export function shorthandsOf(longhand: string): string[] {
  return [...tokenShorthands].filter(([, s]) => s.longhands.includes(longhand)).map(([name]) => name);
}

/** A longhand's value inside a shorthand's value. */
export interface ShorthandPart {
  /** The longhand's own component, or the whole shorthand when components can't be told apart. */
  readonly value: string;
  /** True when `value` is the whole shorthand, whose other components set other longhands. */
  readonly whole: boolean;
}

/**
 * The part of a shorthand's value that sets one longhand. Box shorthands (`padding`, `border-radius`)
 * and pairs (`gap`, `padding-inline`) assign components by position; others (`border`, `font`)
 * return the whole value. A `border-radius` with `/` is returned whole too.
 */
export function longhandInShorthand(shorthand: string, value: string, longhand: string): ShorthandPart | undefined {
  const entry = tokenShorthands.get(shorthand);
  const index = entry?.longhands.indexOf(longhand) ?? -1;
  if (entry === undefined || index < 0) return undefined;
  const components = splitValue(value);
  if (entry.layout === "whole" || value.includes("/") || value.includes(",")) return { value, whole: true };
  let picked: string | undefined;
  if (entry.layout === "pair") {
    picked = components[index] ?? components[0];
  } else {
    // top, right, bottom, left: one value for all, two for vertical and horizontal, three for top,
    // horizontal and bottom.
    const [a, b = a, c = a, d = b] = components;
    picked = [a, b, c, d][index];
  }
  return picked === undefined ? undefined : { value: picked, whole: false };
}
