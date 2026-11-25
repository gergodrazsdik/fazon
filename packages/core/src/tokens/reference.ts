// SPDX-License-Identifier: GPL-3.0-or-later
import type { TokenDefinition } from "./types.js";

const wholeReference = /^\{([^{}]+)\}$/;
const anyReference = /\{([^{}]*)\}/;

/** The path a value references when the value is a single reference, such as `{color.blue.600}`. */
export function referencedPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return wholeReference.exec(value)?.[1];
}

/** A role token's value is a single reference; a raw token's is a literal (docs/spec/tokens.md#raw-and-role-tokens). */
export function tokenKind(token: Pick<TokenDefinition, "value">): "raw" | "role" {
  return referencedPath(token.value) === undefined ? "raw" : "role";
}

/** A reference inside a token's value, and the `$type` its target must have. */
export interface ReferenceSite {
  readonly target: string;
  /** The `$type` the target must have; undefined where the format allows no reference. */
  readonly expectedType: string | undefined;
}

const shadowFields: Readonly<Record<string, string>> = {
  color: "color",
  offsetX: "dimension",
  offsetY: "dimension",
  blur: "dimension",
  spread: "dimension",
};

/**
 * Every reference in a token's value: the whole value, or a shadow layer's colour or dimensions.
 * A reference anywhere else is reported with no expected type (the schema rejects it).
 */
export function referencesOf(token: Pick<TokenDefinition, "type" | "value">): ReferenceSite[] {
  const whole = referencedPath(token.value);
  if (whole !== undefined) return [{ target: whole, expectedType: token.type }];
  const sites: ReferenceSite[] = [];
  const visit = (value: unknown, expectedType: string | undefined): void => {
    if (typeof value === "string") {
      const target = referencedPath(value);
      if (target !== undefined) sites.push({ target, expectedType });
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, undefined);
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item, undefined);
    }
  };
  if (token.type === "shadow") {
    for (const layer of Array.isArray(token.value) ? token.value : [token.value]) {
      if (isRecord(layer)) for (const [key, item] of Object.entries(layer)) visit(item, shadowFields[key]);
    }
  } else {
    visit(token.value, undefined);
  }
  return sites;
}

/** Whether a string value contains a reference without being a single reference. */
export function mixesReference(value: unknown): boolean {
  return typeof value === "string" && referencedPath(value) === undefined && anyReference.test(value);
}

/**
 * A token's custom property name: `--`, the prefix and a hyphen when there's one, then the path
 * joined with hyphens (docs/spec/tokens.md#custom-properties).
 */
export function customPropertyName(path: string, prefix = ""): string {
  const name = path.split(".").join("-");
  return prefix === "" ? `--${name}` : `--${prefix}-${name}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
