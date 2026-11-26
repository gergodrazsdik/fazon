// SPDX-License-Identifier: GPL-3.0-or-later
// Reading CSS values for the token-bound properties (docs/spec/check-catalogue.md#token-bound-properties):
// splitting a value into its components, `var()` references, the allowed values and math functions.

/** The keywords a token-bound property may take without a token, lowercase. */
export const allowedKeywords: readonly string[] = [
  "auto",
  "none",
  "normal",
  "inherit",
  "initial",
  "unset",
  "revert",
  "currentcolor",
  "transparent",
];

// The fraction needs its dot, so no run of digits can be split two ways (no polynomial backtracking).
const zero = /^[+-]?(0+(?:\.0*)?|\.0+)([a-z]+|%)?$/i;
const number = /^[+-]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const dimension = /^[+-]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?([a-z]+|%)$/i;
const mathFunctions = new Set(["calc", "min", "max", "clamp"]);

/** One component of a value. */
export type ValueComponent =
  | { readonly kind: "var"; readonly name: string; readonly fallback?: string; readonly text: string }
  | { readonly kind: "allowed"; readonly text: string }
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "math"; readonly operands: readonly ValueComponent[]; readonly text: string }
  | { readonly kind: "literal"; readonly text: string };

/**
 * Splits a value at the top level into its components: whitespace, commas and slashes separate
 * them; a function with its arguments is one component; strings stay whole.
 */
export function splitValue(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  const flush = () => {
    if (current !== "") parts.push(current);
    current = "";
  };
  for (const char of value) {
    if (quote !== undefined) {
      current += char;
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === "(") {
      depth += 1;
      current += char;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (depth === 0 && (/\s/.test(char) || char === "," || char === "/")) {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return parts;
}

/** Splits a function's arguments at top-level commas. */
function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of args) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** `name(args)` as its lowercase name and the text between the parentheses. */
export function parseFunction(text: string): { name: string; args: string } | undefined {
  const match = /^([a-z-]+)\((.*)\)$/is.exec(text.trim());
  if (match === null) return undefined;
  return { name: (match[1] ?? "").toLowerCase(), args: match[2] ?? "" };
}

/** The operands of a math function: arguments split further at `+`, `-`, `*` and `/` between spaces. */
function mathOperands(args: string): string[] {
  const operands: string[] = [];
  const push = (text: string) => {
    if (text.trim() !== "") operands.push(text.trim());
  };
  for (const argument of splitArguments(args)) {
    let current = "";
    let depth = 0;
    for (let i = 0; i < argument.length; i += 1) {
      const char = argument.charAt(i);
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      // `+` and `-` are operators only between spaces; `*` and `/` anywhere.
      const spaced = /\s/.test(argument.charAt(i - 1)) && /\s/.test(argument.charAt(i + 1));
      if (depth === 0 && (char === "*" || char === "/" || ((char === "+" || char === "-") && spaced))) {
        push(current);
        current = "";
      } else {
        current += char;
      }
    }
    push(current);
  }
  return operands;
}

/** Classifies one component of a value. */
export function classifyComponent(text: string): ValueComponent {
  const fn = parseFunction(text);
  if (fn?.name === "var") {
    const [name = "", ...rest] = splitArguments(fn.args);
    const fallback = rest.join(", ").trim();
    return { kind: "var", name: name.trim(), text, ...(fallback === "" ? {} : { fallback }) };
  }
  if (fn !== undefined && mathFunctions.has(fn.name)) {
    const operands = mathOperands(fn.args).map((operand) => {
      // A parenthesised group inside calc() is a nested calculation.
      const inner = /^\((.*)\)$/s.exec(operand);
      return inner === null ? classifyComponent(operand) : classifyComponent(`calc(${inner[1] ?? ""})`);
    });
    return { kind: "math", operands, text };
  }
  if (isAllowedValue(text)) return { kind: "allowed", text };
  if (number.test(text)) return { kind: "number", text };
  return { kind: "literal", text };
}

/** Splits and classifies a whole value. */
export function parseValue(value: string): ValueComponent[] {
  return splitValue(value).map(classifyComponent);
}

/**
 * How Chromium's DevTools protocol reports `transparent` in a matched rule: it serialises the
 * keyword as this colour, which is the same colour, so it counts as the keyword.
 */
const serializedTransparent = "rgba(0, 0, 0, 0)";

/** `0` with any unit, `100%`, or one of the allowed keywords. */
export function isAllowedValue(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return zero.test(lower) || lower === "100%" || allowedKeywords.includes(lower) || lower === serializedTransparent;
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
]);

// The CSS named colours (CSS Color 4), for literals inside shorthands.
const namedColors = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

/**
 * Whether a literal inside a shorthand is a value a token should give: a length, a number, a
 * colour or a timing function. Keywords such as `solid` or a transition's property name aren't.
 */
export function looksLikeTokenValue(text: string): boolean {
  const lower = text.toLowerCase();
  if (dimension.test(lower) || number.test(lower) || /^#[0-9a-f]{3,8}$/.test(lower) || namedColors.has(lower)) {
    return true;
  }
  const fn = parseFunction(lower);
  return fn !== undefined && (colorFunctions.has(fn.name) || fn.name === "cubic-bezier" || fn.name === "steps");
}
