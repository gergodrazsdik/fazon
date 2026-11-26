// SPDX-License-Identifier: GPL-3.0-or-later
// The token-bound properties of docs/spec/check-catalogue.md#token-bound-properties, with their
// sides, corners and logical forms, and the shorthands that set them.
import type { TokenType } from "../tokens/types.js";

// The allowed values are the rendered `tokens` check's: one definition for both checks.
export { isAllowedValue } from "../checks/css-values.js";

/** A value node, as the lint rules see it: a word, a string, or a function's name. */
export interface ValuePart {
  readonly type: "word" | "string" | "function";
  /** The word, the string's content, or the function's name, in lower case. */
  readonly value: string;
}

/** How the lint rules check one token-bound property, or one shorthand that sets some. */
export interface TokenBoundProperty {
  /** The token types that fit the property, for the fixes a message suggests. */
  readonly types: readonly TokenType[];
  /**
   * For a shorthand that also sets properties that aren't token-bound: whether a part of the value
   * belongs to one of those, such as `solid` in `border`. Undefined for a token-bound longhand.
   */
  readonly free?: (part: ValuePart) => boolean;
}

const sides = ["top", "right", "bottom", "left"] as const;
const logicalSides = ["block", "inline", "block-start", "block-end", "inline-start", "inline-end"] as const;

/** `padding`, `padding-top` … `padding-inline-end`. */
function boxForms(name: string): string[] {
  return [name, ...[...sides, ...logicalSides].map((side) => `${name}-${side}`)];
}

/** `border-color`, `border-top-color` … `border-inline-end-color`. */
function borderForms(part: string): string[] {
  return [`border-${part}`, ...[...sides, ...logicalSides].map((side) => `border-${side}-${part}`)];
}

const radiusForms = [
  "border-radius",
  ...["top-left", "top-right", "bottom-right", "bottom-left", "start-start", "start-end", "end-start", "end-end"].map(
    (corner) => `border-${corner}-radius`,
  ),
];

const groups: readonly (readonly [readonly string[], TokenType])[] = [
  [
    [
      "color",
      "background-color",
      ...borderForms("color"),
      "outline-color",
      "text-decoration-color",
      "caret-color",
      "accent-color",
      "fill",
      "stroke",
      "column-rule-color",
    ],
    "color",
  ],
  [
    [
      ...boxForms("padding"),
      ...boxForms("margin"),
      "gap",
      "row-gap",
      "column-gap",
      "grid-gap",
      "grid-row-gap",
      "grid-column-gap",
    ],
    "dimension",
  ],
  [[...radiusForms, ...borderForms("width"), "outline-width", "outline-offset"], "dimension"],
  [["font-family"], "fontFamily"],
  [["font-size", "letter-spacing"], "dimension"],
  [["font-weight"], "fontWeight"],
  [["line-height"], "number"],
  [["box-shadow"], "shadow"],
  [["transition-duration", "transition-delay", "animation-duration", "animation-delay"], "duration"],
  [["transition-timing-function", "animation-timing-function"], "cubicBezier"],
];

const lineStyles = new Set(["hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);
const timingKeywords = new Set(["ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end"]);
const timingFunctions = new Set(["cubic-bezier", "steps", "linear"]);
const fontKeywords = new Set([
  "italic",
  "oblique",
  "small-caps",
  "ultra-condensed",
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "semi-expanded",
  "expanded",
  "extra-expanded",
  "ultra-expanded",
]);
const widthKeywords = new Set(["thin", "medium", "thick"]);
// The fraction needs its dot, so no two quantifiers split the same run of digits (linear time).
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const dimension = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)$/i;

/** Whether a value part is a colour: a hex colour, a named or system colour, or a colour function. */
export function isColor(part: ValuePart): boolean {
  if (part.type === "function") return colorFunctions.has(part.value);
  if (part.type !== "word") return false;
  return /^#[0-9a-f]{3,8}$/i.test(part.value) || namedColors.has(part.value);
}

const colorFunctions = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "device-cmyk",
  "contrast-color",
]);

// The CSS named colours (CSS Color 4) and the system colours (CSS Color 4, section 6.2).
const namedColors = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod " +
    "darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon " +
    "darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray " +
    "dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
    "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon " +
    "lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon " +
    "lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta " +
    "maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen " +
    "mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen " +
    "seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato " +
    "turquoise violet wheat white whitesmoke yellow yellowgreen " +
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext " +
    "graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext"
  ).split(" "),
);

const notColor = (part: ValuePart) => !isColor(part);

const borderShorthand: TokenBoundProperty = {
  types: ["dimension", "color"],
  free: (part) => part.type === "word" && lineStyles.has(part.value),
};

/** Shorthands that set token-bound properties alongside others. */
const shorthands: Readonly<Record<string, TokenBoundProperty>> = {
  ...Object.fromEntries(
    ["border", ...[...sides, ...logicalSides].map((side) => `border-${side}`)].map((name) => [name, borderShorthand]),
  ),
  outline: borderShorthand,
  // column-rule-width isn't token-bound; only its colour is.
  "column-rule": {
    types: ["color"],
    free: (part) =>
      part.type === "word" &&
      (lineStyles.has(part.value) || widthKeywords.has(part.value) || dimension.test(part.value)),
  },
  background: { types: ["color"], free: notColor },
  "text-decoration": { types: ["color"], free: notColor },
  font: {
    types: ["fontFamily", "fontWeight", "dimension", "number"],
    free: (part) => part.type === "word" && fontKeywords.has(part.value),
  },
  transition: {
    types: ["duration", "cubicBezier"],
    free: (part) =>
      part.type === "word" &&
      !timingKeywords.has(part.value) &&
      !number.test(part.value) &&
      !dimension.test(part.value),
  },
  animation: {
    types: ["duration", "cubicBezier"],
    // Names and keywords such as `infinite` or `forwards`, and the iteration count.
    free: (part) =>
      (part.type === "word" && !timingKeywords.has(part.value) && !dimension.test(part.value)) ||
      (part.type === "function" && !timingFunctions.has(part.value)),
  },
};

const longhands = new Map<string, TokenBoundProperty>();
for (const [names, type] of groups) for (const name of names) longhands.set(name, { types: [type] });
longhands.set("box-shadow", { types: ["shadow"], free: (part) => part.type === "word" && part.value === "inset" });

/**
 * How the lint rules check a property: undefined when it isn't token-bound and sets no token-bound
 * property. Vendor prefixes are ignored; positioning and sizing are out of scope.
 */
export function tokenBoundProperty(property: string): TokenBoundProperty | undefined {
  const name = property.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, "");
  return longhands.get(name) ?? shorthands[name];
}

/** Whether a word is a unitless number, which `calc()`, `min()`, `max()` and `clamp()` accept. */
export function isUnitlessNumber(word: string): boolean {
  return number.test(word);
}
