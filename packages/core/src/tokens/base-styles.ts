// SPDX-License-Identifier: GPL-3.0-or-later
import { customPropertyName } from "./reference.js";

/** One inherited property the story frame sets from a role token. */
export interface BaseStyle {
  /** The CSS property, such as `background-color`. */
  readonly property: string;
  /** The role token's dotted path. */
  readonly token: string;
  /** The value: the token's custom property, such as `var(--fz-color-surface-base)`. */
  readonly value: string;
}

/** The frame's properties and their role tokens, in the order of docs/spec/tokens.md#base-styles. */
const frameProperties = [
  ["background-color", "color.surface.base"],
  ["color", "color.text.primary"],
  ["font-family", "font-family.body"],
  ["font-size", "font-size.body"],
  ["font-weight", "font-weight.body"],
  ["line-height", "line-height.body"],
] as const;

/** The story frame's base styles, with the token set's prefix (`tokens.prefix`) applied. */
export function baseStyles(prefix = ""): readonly BaseStyle[] {
  return frameProperties.map(([property, token]) => ({
    property,
    token,
    value: `var(${customPropertyName(token, prefix)})`,
  }));
}
