// SPDX-License-Identifier: GPL-3.0-or-later
// The mutation operators of the judge's calibration (docs/spec/measurement.md#seeded-defects).
// Each makes cases: deterministic CSS added to a story's page after it loads and before it's
// captured, scoped to part roots (ADR 0027). A case's CSS for a story comes from that story's
// facts in the theme, and for the swaps from a counterpart story's; a story it gives no CSS keeps
// its capture. The component's code and the story build stay unchanged.
import { isDeepStrictEqual } from "node:util";
import type { Story, StoryManifest } from "../matrix/types.js";
import { stateSegment } from "../matrix/names.js";
import type { Spec } from "../spec/types.js";
import type { IndexedToken, TokenIndex } from "../tokens/build.js";
import { customPropertyName } from "../tokens/reference.js";
import type { FactDeclaration, PartFacts, StoryFacts } from "./facts.js";

export type OperatorId =
  | "raw-color"
  | "low-contrast"
  | "clipped-text"
  | "target-shrunk"
  | "padding-step"
  | "focus-ring-removed"
  | "emphasis-swapped"
  | "variants-collapsed"
  | "state-indistinct"
  | "state-misleading"
  | "icon-misaligned"
  | "out-of-family";

export interface Operator {
  readonly id: OperatorId;
  readonly class: "measurable" | "viewer-only";
  /** What it changes. */
  readonly change: string;
  /** What is expected to catch it: a check and rule, or the judge's question. */
  readonly expected: string;
}

/** The operators, in the protocol's order. */
export const operators: readonly Operator[] = [
  {
    id: "raw-color",
    class: "measurable",
    change: "a role token replaced by its literal value",
    expected: "tokens/raw-value",
  },
  {
    id: "low-contrast",
    class: "measurable",
    change: "text colour replaced by a lighter role token",
    expected: "a11y/color-contrast",
  },
  {
    id: "clipped-text",
    class: "measurable",
    change: "no wrapping, hidden overflow, a fixed width",
    expected: "layout/clipped-text",
  },
  {
    id: "target-shrunk",
    class: "measurable",
    change: "the smallest size's padding set to 0",
    expected: "layout/target-size",
  },
  {
    id: "padding-step",
    class: "measurable",
    change: "the root's padding one token step larger",
    expected: "visual/changed",
  },
  { id: "focus-ring-removed", class: "measurable", change: "no outline on :focus-visible", expected: "visual/changed" },
  {
    id: "emphasis-swapped",
    class: "viewer-only",
    change: "two variants exchange their colour tokens",
    expected: "judge axis-variant",
  },
  {
    id: "variants-collapsed",
    class: "viewer-only",
    change: "one variant takes another's colour tokens",
    expected: "judge axis-<prop>",
  },
  {
    id: "state-indistinct",
    class: "viewer-only",
    change: "a state's colour tokens set to the default state's",
    expected: "judge state-<state>",
  },
  {
    id: "state-misleading",
    class: "viewer-only",
    change: "disabled styled with the danger colour",
    expected: "judge state-disabled",
  },
  {
    id: "icon-misaligned",
    class: "viewer-only",
    change: "an icon shifted by one spacing step",
    expected: "judge story or appearance-<n>",
  },
  {
    id: "out-of-family",
    class: "viewer-only",
    change: "a radius and font weight from outside the library's conventions, still as role tokens",
    expected: "judge family",
  },
];

/** What the operators read. */
export interface MutationContext {
  readonly spec: Spec;
  readonly manifest: StoryManifest;
  readonly index: TokenIndex;
  /** A story's facts in a theme, from its unmodified render; undefined when it has none. */
  readonly facts: (story: string, theme: string) => StoryFacts | undefined;
}

/** One application of an operator: a calibration case. */
export interface MutationCase {
  /** `<operator>`, or `<operator>--<what>` when the operator applies more than once. */
  readonly id: string;
  readonly operator: OperatorId;
  readonly class: Operator["class"];
  readonly description: string;
  /** The CSS to add to a story's page in a theme, or undefined when the case leaves the story as it is. */
  readonly css: (story: Story, theme: string) => string | undefined;
}

const colourProperties = new Set([
  "background-color",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
]);
const paddingProperties = new Set(["padding-top", "padding-right", "padding-bottom", "padding-left"]);
const radiusProperties = new Set([
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
]);
const outlineProperties = new Set(["outline-color", "outline-style", "outline-width"]);
const varPattern = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g;

/** A rule that wins over the component's own: every declaration `!important`. */
function rule(selector: string, declarations: readonly (readonly [string, string])[]): string | undefined {
  if (declarations.length === 0) return undefined;
  const unique = new Map(declarations);
  return `${selector} { ${[...unique].map(([property, value]) => `${property}: ${value} !important;`).join(" ")} }`;
}

function rules(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined);
  return present.length === 0 ? undefined : present.join("\n");
}

/** The custom properties a value references. */
function varsIn(value: string): string[] {
  return [...value.matchAll(varPattern)].map((match) => match[1] ?? "");
}

/** The value with each referenced custom property replaced by what `replace` gives for it, or kept. */
function replaceVars(value: string, replace: (name: string) => string | undefined): string {
  return value.replace(varPattern, (whole: string, name: string) => replace(name) ?? whole);
}

/** The same part root in another story: same name and instance. */
function samePart(facts: StoryFacts | undefined, part: PartFacts): PartFacts | undefined {
  return facts?.parts.find((other) => other.part === part.part && other.instance === part.instance);
}

function declarationsOf(part: PartFacts, properties: ReadonlySet<string>): FactDeclaration[] {
  return part.declarations.filter((declaration) => properties.has(declaration.property));
}

/** A story's counterpart: the same fixture and axes, with these axis values and this state. */
function counterpart(
  manifest: StoryManifest,
  story: Story,
  axes: Readonly<Record<string, boolean | string | number>>,
  state: Story["state"],
): Story | undefined {
  const wanted = { ...story.axes, ...axes };
  return manifest.stories.find(
    (other) =>
      other.fixture === story.fixture &&
      isDeepStrictEqual(other.axes, wanted) &&
      other.state.name === state.name &&
      other.state.part === state.part,
  );
}

/** Color hex to relative luminance (WCAG); undefined for a value this can't read. */
function luminance(value: string): number | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
  if (hex === undefined) return undefined;
  const full = hex.length === 3 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex.slice(0, 6);
  const channel = (offset: number) => {
    const c = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The cases every applicable operator makes for one component (docs/spec/measurement.md#seeded-defects). */
export function mutationCases(context: MutationContext): MutationCase[] {
  const { spec, manifest, index } = context;
  const token = (theme: string, name: string): IndexedToken | undefined => index.byTheme.get(theme)?.get(name);
  const nameOf = (path: string) => customPropertyName(path, index.prefix);
  const pathOf = (name: string): string | undefined => token(index.defaultTheme, name)?.path;
  /** The role tokens in the same group as a path, in the token set's order: its scale. */
  const scaleOf = (path: string): string[] => {
    const group = path.slice(0, path.lastIndexOf("."));
    return index.roleTokens.filter((role) => role.slice(0, role.lastIndexOf(".")) === group);
  };
  const root = (facts: StoryFacts | undefined): PartFacts | undefined => facts?.parts[0];
  const cases: MutationCase[] = [];
  const add = (operator: OperatorId, suffix: string | undefined, description: string, css: MutationCase["css"]) => {
    const definition = operators.find((entry) => entry.id === operator);
    cases.push({
      id: suffix === undefined ? operator : `${operator}--${suffix}`,
      operator,
      class: definition?.class ?? "measurable",
      description,
      css,
    });
  };

  // raw-color: the root's colours from role tokens, written as the tokens' literal values.
  add("raw-color", undefined, "The root's colour role tokens replaced by their literal values.", (story, theme) => {
    const part = root(context.facts(story.name, theme));
    if (part === undefined) return undefined;
    const declarations = declarationsOf(part, colourProperties)
      .filter((declaration) => varsIn(declaration.value).length > 0)
      .map(
        (declaration) =>
          [declaration.property, replaceVars(declaration.value, (name) => token(theme, name)?.resolvedValue)] as const,
      );
    return rule(part.selector, declarations);
  });

  // low-contrast: the text colour that contrasts least with the background, from the same group.
  add(
    "low-contrast",
    undefined,
    "The root's text colour replaced by the role token of its group closest to its background.",
    (story, theme) => {
      const facts = context.facts(story.name, theme);
      const part = facts?.parts.find((entry) => entry.text);
      if (part === undefined) return undefined;
      const colour = part.declarations.find((declaration) => declaration.property === "color");
      const current = colour === undefined ? undefined : varsIn(colour.value)[0];
      const currentPath = current === undefined ? undefined : pathOf(current);
      if (currentPath === undefined) return undefined;
      const background = part.declarations.find((declaration) => declaration.property === "background-color");
      const backgroundName = background === undefined ? undefined : varsIn(background.value)[0];
      const surface = index.roleTokens.find((role) => role.startsWith("color.surface."));
      const backgroundValue =
        (backgroundName === undefined ? undefined : token(theme, backgroundName)?.resolvedValue) ??
        (surface === undefined ? undefined : token(theme, nameOf(surface))?.resolvedValue);
      const backgroundLuminance = backgroundValue === undefined ? undefined : luminance(backgroundValue);
      if (backgroundLuminance === undefined) return undefined;
      let best: { path: string; ratio: number } | undefined;
      for (const path of scaleOf(currentPath)) {
        if (path === currentPath) continue;
        const value = token(theme, nameOf(path))?.resolvedValue;
        const lum = value === undefined ? undefined : luminance(value);
        if (lum === undefined) continue;
        const ratio = contrast(lum, backgroundLuminance);
        if (best === undefined || ratio < best.ratio) best = { path, ratio };
      }
      return best === undefined ? undefined : rule(part.selector, [["color", `var(${nameOf(best.path)})`]]);
    },
  );

  // clipped-text: the part with text can't wrap, hides its overflow, and is too narrow for it.
  add(
    "clipped-text",
    undefined,
    "The first part with text: no wrapping, hidden overflow and a fixed width of 2.5em.",
    (story, theme) => {
      const part = context.facts(story.name, theme)?.parts.find((entry) => entry.text);
      if (part === undefined) return undefined;
      return rule(part.selector, [
        ["white-space", "nowrap"],
        ["overflow", "hidden"],
        ["text-overflow", "clip"],
        ["width", "2.5em"],
        ["min-width", "0"],
        ["max-width", "2.5em"],
        ["flex-shrink", "0"],
      ]);
    },
  );

  // target-shrunk: the smallest size loses its padding and its minimum height.
  const sizeAxis = (spec.matrix?.axes ?? []).find((axis) => axis === "size");
  const sizeProp = sizeAxis === undefined ? undefined : spec.props?.[sizeAxis];
  const smallest = sizeProp?.type === "enum" ? sizeProp.values[0] : undefined;
  add(
    "target-shrunk",
    undefined,
    `The root's padding set to 0, and its minimum height removed, ${smallest === undefined ? "in every story" : `at size ${smallest}`}.`,
    (story, theme) => {
      if (sizeAxis !== undefined && story.axes[sizeAxis] !== smallest) return undefined;
      const part = root(context.facts(story.name, theme));
      if (part === undefined) return undefined;
      return rule(part.selector, [
        ["padding", "0"],
        ["min-height", "0"],
        ["height", "auto"],
      ]);
    },
  );

  // padding-step: each padding token one step larger in its scale.
  add("padding-step", undefined, "The root's padding tokens each one step larger in their scale.", (story, theme) => {
    const part = root(context.facts(story.name, theme));
    if (part === undefined) return undefined;
    const declarations: (readonly [string, string])[] = [];
    for (const declaration of declarationsOf(part, paddingProperties)) {
      const stepped = replaceVars(declaration.value, (name) => {
        const path = pathOf(name);
        if (path === undefined) return undefined;
        const scale = scaleOf(path);
        const next = scale[scale.indexOf(path) + 1];
        return next === undefined ? undefined : `var(${nameOf(next)})`;
      });
      if (stepped !== declaration.value) declarations.push([declaration.declaredAs, stepped]);
    }
    return rule(part.selector, declarations);
  });

  // focus-ring-removed: no outline in the stories that show focus-visible.
  add("focus-ring-removed", undefined, "No outline on any element of the focus-visible stories.", (story) => {
    if (story.state.name !== "focus-visible") return undefined;
    return rule("[data-part], [data-part] *", [["outline-style", "none"]]);
  });

  // The colours of every part root of a story, taken from the same part roots of another story.
  const takeColours = (story: Story, from: Story | undefined, theme: string, properties: ReadonlySet<string>) => {
    if (from === undefined) return undefined;
    const own = context.facts(story.name, theme);
    const other = context.facts(from.name, theme);
    if (own === undefined || other === undefined) return undefined;
    const parts = own.parts.map((part) => {
      const source = samePart(other, part);
      if (source === undefined) return undefined;
      const wanted = declarationsOf(source, properties);
      const declarations: (readonly [string, string])[] = wanted.map((d) => [d.property, d.value]);
      for (const mine of declarationsOf(part, properties)) {
        if (wanted.some((d) => d.property === mine.property)) continue;
        // What the other story leaves at its initial value.
        if (mine.property === "outline-style") declarations.push([mine.property, "none"]);
        else if (mine.property !== "outline-width") declarations.push([mine.property, "transparent"]);
      }
      return rule(part.selector, declarations);
    });
    return rules(parts);
  };

  const variantAxis = (spec.matrix?.axes ?? []).find((axis) => axis === "variant");
  const variantProp = variantAxis === undefined ? undefined : spec.props?.[variantAxis];
  const variants = variantProp?.type === "enum" ? variantProp.values.map(String) : [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i] ?? "";
      const b = variants[j] ?? "";
      // emphasis-swapped: a and b exchange their colours.
      add(
        "emphasis-swapped",
        `${a}-${b}`,
        `The ${a} and ${b} variants exchange their colour tokens.`,
        (story, theme) => {
          const value = String(story.axes.variant);
          if (value !== a && value !== b) return undefined;
          const other = counterpart(manifest, story, { variant: value === a ? b : a }, story.state);
          return takeColours(story, other, theme, colourProperties);
        },
      );
      // variants-collapsed: b takes a's colours.
      add(
        "variants-collapsed",
        `${b}-as-${a}`,
        `The ${b} variant takes the ${a} variant's colour tokens.`,
        (story, theme) => {
          if (String(story.axes.variant) !== b) return undefined;
          const other = counterpart(manifest, story, { variant: a }, story.state);
          return takeColours(story, other, theme, colourProperties);
        },
      );
    }
  }

  // state-indistinct: each state's stories take their default story's colours and outline.
  const states = new Map<string, Story["state"]>();
  for (const story of manifest.stories) {
    if (story.state.name !== "default" && !states.has(stateSegment(story.state)))
      states.set(stateSegment(story.state), story.state);
  }
  const colourAndOutline = new Set([...colourProperties, ...outlineProperties]);
  for (const [segment, state] of states) {
    add(
      "state-indistinct",
      segment,
      `The ${segment} state takes the default state's colour tokens and outline.`,
      (story, theme) => {
        if (story.state.name !== state.name || story.state.part !== state.part) return undefined;
        const other = counterpart(manifest, story, {}, { name: "default" });
        return takeColours(story, other, theme, colourAndOutline);
      },
    );
  }

  // state-misleading: disabled in the danger colours.
  const danger = (kind: string) =>
    index.roleTokens.find((role) => role.split(".").includes("danger") && role.endsWith(`.${kind}`));
  const dangerSurface = danger("surface") ?? danger("background");
  const dangerText = danger("text");
  const dangerBorder = danger("border");
  if (
    [...states.values()].some((state) => state.name === "disabled") &&
    dangerSurface !== undefined &&
    dangerText !== undefined
  ) {
    add("state-misleading", undefined, "The disabled state styled with the danger colour tokens.", (story, theme) => {
      if (story.state.name !== "disabled") return undefined;
      const facts = context.facts(story.name, theme);
      if (facts === undefined) return undefined;
      const target = facts.parts.find((part) => part.states.includes("disabled")) ?? facts.parts[0];
      if (target === undefined) return undefined;
      const declarations: (readonly [string, string])[] = [
        ["background-color", `var(${nameOf(dangerSurface)})`],
        ["color", `var(${nameOf(dangerText)})`],
      ];
      if (dangerBorder !== undefined) declarations.push(["border-color", `var(${nameOf(dangerBorder)})`]);
      return rule(target.selector, declarations);
    });
  }

  // icon-misaligned: every icon moved down by the smallest gap.
  const gap =
    index.roleTokens.find((role) => role.startsWith("space.gap.")) ??
    index.roleTokens.find((role) => role.startsWith("space."));
  if (gap !== undefined) {
    add("icon-misaligned", undefined, `Every icon shifted down by ${gap}.`, (story, theme) => {
      const icons = context.facts(story.name, theme)?.parts.flatMap((part) => part.icons) ?? [];
      return rules(icons.map((selector) => rule(selector, [["translate", `0 var(${nameOf(gap)})`]])));
    });
  }

  // out-of-family: per part, its radius and font weight tokens as far along their scales as they go.
  const farthest = (path: string): string | undefined => {
    const scale = scaleOf(path);
    const at = scale.indexOf(path);
    let best: string | undefined;
    let distance = 0;
    scale.forEach((candidate, position) => {
      if (Math.abs(position - at) >= distance && position !== at) {
        best = candidate;
        distance = Math.abs(position - at);
      }
    });
    return best;
  };
  const partNames = [spec.name, ...Object.keys(spec.parts ?? {})];
  for (const name of partNames) {
    add(
      "out-of-family",
      name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
      `The ${name} part's radius and font weight tokens replaced by the farthest ones in their scales.`,
      (story, theme) => {
        const facts = context.facts(story.name, theme);
        const parts = (facts?.parts ?? []).filter((part) => part.part === name);
        return rules(
          parts.map((part) => {
            const declarations: (readonly [string, string])[] = [];
            for (const declaration of declarationsOf(part, new Set([...radiusProperties, "font-weight"]))) {
              const replaced = replaceVars(declaration.value, (variable) => {
                const path = pathOf(variable);
                const other = path === undefined ? undefined : farthest(path);
                return other === undefined ? undefined : `var(${nameOf(other)})`;
              });
              if (replaced !== declaration.value) declarations.push([declaration.declaredAs, replaced]);
            }
            return rule(part.selector, declarations);
          }),
        );
      },
    );
  }

  return cases;
}
