// SPDX-License-Identifier: GPL-3.0-or-later
// What the page runner reads from a rendered page, as plain data. The checks are pure functions of
// it, so unit tests feed recorded or hand-written snapshots without a browser.
import type { Box } from "./types.js";

/** One declaration of a style, as the DevTools protocol reports its longhands. */
export interface StyleProperty {
  /** The longhand, or a custom property such as `--_bg`. */
  readonly name: string;
  /**
   * The value with any `!important` removed. Empty when the longhand comes from a shorthand that
   * references a custom property (the browser substitutes it later); the shorthand is then in
   * `shorthands`.
   */
  readonly value: string;
  readonly important: boolean;
  /** Set implicitly by a shorthand that left it out: the property's initial value. */
  readonly implicit: boolean;
}

/** A shorthand as written, for longhands whose value the protocol leaves empty. */
export interface StyleShorthand {
  readonly name: string;
  readonly value: string;
  readonly important: boolean;
}

/**
 * Where a style comes from: the browser's own stylesheet, an author stylesheet, the element's
 * `style` attribute, or presentational attributes such as SVG's `fill`.
 */
export type StyleOrigin = "user-agent" | "author" | "inline" | "attribute";

/** One style that applies to an element: a matched rule, the inline style or the attributes. */
export interface StyleSource {
  readonly origin: StyleOrigin;
  /** The rule's selector; absent for inline and attribute styles. */
  readonly selector?: string;
  /** The cascade layer the rule is in, innermost to outermost joined with `.`; absent when unlayered. */
  readonly layer?: string;
  readonly properties: readonly StyleProperty[];
  readonly shorthands: readonly StyleShorthand[];
}

/** The styles that match an element, and those of its ancestors, in cascade order. */
export interface ElementStyles {
  /**
   * The element's styles, lowest priority first: presentational attributes, then matched rules in
   * the order the browser cascades them, then the inline style.
   */
  readonly matched: readonly StyleSource[];
  /** Each ancestor's styles, nearest first, in the same order; for custom properties. */
  readonly inherited: readonly (readonly StyleSource[])[];
}

/** Which of an element's names the browser used, from the accessibility tree. */
export type NameSourceKind = "contents" | "aria-label" | "aria-labelledby" | "title" | "other" | "none";

/** One element of the component, as rendered. */
export interface InspectedElement {
  /** A CSS selector for the element, anchored on its part where that is unique. */
  readonly selector: string;
  /** Lowercase tag name. */
  readonly tag: string;
  /** The nearest ancestor-or-self's `data-part`. */
  readonly part?: string;
  /** Whether the element carries `data-part` itself. */
  readonly partRoot: boolean;
  /** Its position among the elements with the same `data-part`, from 0; for part roots only. */
  readonly instance?: number;
  /** The index of its parent in the inspection's elements; absent for the component's roots. */
  readonly parent?: number;
  /** In the frame, or in a portal part rendered outside it. */
  readonly inFrame: boolean;
  /** The border box. */
  readonly box: Box;
  readonly display: string;
  readonly visibility: string;
  readonly position: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly textOverflow: string;
  /** `-webkit-line-clamp` or `line-clamp`: `none` or a number. */
  readonly lineClamp: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  /** The boxes of its own non-blank text nodes. */
  readonly textBoxes: readonly Box[];
  /** An inline element with text beside it in its parent: WCAG 2.5.8's inline exception. */
  readonly inlineInText: boolean;
  /** Whether it is in the tab order. */
  readonly tabbable: boolean;
  /** The computed role, from the accessibility tree; empty when the element is ignored. */
  readonly role: string;
  /** The accessible name. */
  readonly name: string;
  readonly nameSource: NameSourceKind;
  readonly description: string;
  /** The parts that `aria-labelledby` and `aria-describedby` point at. */
  readonly labelledBy: readonly string[];
  readonly describedBy: readonly string[];
  /** Its `aria-*` attributes and their values. */
  readonly aria: Readonly<Record<string, string>>;
  /** Reflected states (`data-<state>` attributes, other than `data-part`) and the pseudo-states that match. */
  readonly states: readonly string[];
  /** Absent when the inspection skipped styles. */
  readonly styles?: ElementStyles;
  /** The fonts of its own text; absent when it has none, or the inspection skipped styles. */
  readonly fonts?: TextFonts;
}

/** A font the browser rendered text with, as the DevTools protocol reports it. */
export interface RenderedFont {
  /** The family name in the font file, such as `Inter` for the faces `Inter Variable` registers. */
  readonly family: string;
  readonly postScriptName: string;
  /** A web font, loaded through `@font-face`; not a font installed on the system. */
  readonly custom: boolean;
  /** How many glyphs of the text it rendered. */
  readonly glyphs: number;
}

/** The fonts of an element's own text (its text nodes, not its descendants'). */
export interface TextFonts {
  /** The computed `font-family`. */
  readonly family: string;
  /** Its first family, unquoted, as written. */
  readonly first: string;
  /**
   * The status (`unloaded`, `loading`, `loaded`, `error`) of each of the document's font faces
   * (`@font-face` rules and `FontFace` objects) for the first family; empty when the document
   * declares none, as for a font installed on the system, or one that is missing.
   */
  readonly faces: readonly string[];
  /** The fonts the browser rendered the text with. */
  readonly rendered: readonly RenderedFont[];
}

/** The frame and the component's elements, in document order (roots before their descendants). */
export interface PageInspection {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly frame: {
    readonly selector: string;
    readonly box: Box;
    /** The box inside the frame's padding. */
    readonly contentBox: Box;
  };
  readonly elements: readonly InspectedElement[];
}

/** One element an axe result is about. */
export interface AxeNode {
  readonly selector: string;
  readonly part?: string;
  readonly summary: string;
}

/** One axe rule's result. */
export interface AxeRuleResult {
  readonly id: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly impact?: string;
  readonly nodes: readonly AxeNode[];
}

/** What axe-core reported for the component. */
export interface AxeOutcome {
  readonly version: string;
  readonly violations: readonly AxeRuleResult[];
  /** axe's undecided results, such as contrast over a gradient. */
  readonly incomplete: readonly AxeRuleResult[];
}

/** A capture of the frame and the rendered portal parts, at the device scale factor. */
export interface Capture {
  readonly png: Uint8Array;
  /** The captured area in CSS pixels. */
  readonly clip: Box;
  readonly deviceScaleFactor: number;
}
