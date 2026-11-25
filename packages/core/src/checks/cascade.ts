// SPDX-License-Identifier: GPL-3.0-or-later
// The declaration that wins the cascade for each property of an element, from the styles the
// DevTools protocol reports for it (snapshot.ts).
import type { StyleOrigin, StyleSource } from "./snapshot.js";
import { longhandInShorthand, physicalProperty, shorthandsOf } from "./token-properties.js";

/** The declaration that sets one property of an element. */
export interface Declaration {
  /** The physical longhand, or the custom property. */
  readonly property: string;
  /** The longhand's value; the whole shorthand when `whole` is true. */
  readonly value: string;
  /** The value is a whole shorthand whose other components set other properties. */
  readonly whole: boolean;
  /** The property as written: the longhand, its logical form, or the shorthand. */
  readonly declaredAs: string;
  readonly origin: StyleOrigin;
  readonly important: boolean;
  /** Left out of a shorthand, so it is the property's initial value. */
  readonly implicit: boolean;
  readonly selector?: string;
}

interface Ranked {
  readonly declaration: Declaration;
  readonly tier: number;
  readonly layer: number;
  readonly position: number;
}

/**
 * Ranks by origin and importance (CSS Cascade 5): normal user-agent, normal author (presentational
 * attributes, rules, the inline style), important author rules, the important inline style,
 * important user-agent declarations.
 */
function tier(origin: StyleOrigin, important: boolean): number {
  if (!important) return origin === "user-agent" ? 0 : 1;
  if (origin === "user-agent") return 4;
  return origin === "inline" ? 3 : 2;
}

/**
 * The winning declaration of each property of an element. `matched` is in the browser's cascade
 * order for normal declarations, which already orders layers; for important declarations the
 * layers' order reverses, and unlayered rules come last.
 */
export function winningDeclarations(matched: readonly StyleSource[]): Map<string, Declaration> {
  const layerIndex = new Map<string, number>();
  for (const source of matched) {
    if (source.origin === "author" && source.layer !== undefined && !layerIndex.has(source.layer)) {
      layerIndex.set(source.layer, layerIndex.size);
    }
  }
  const winners = new Map<string, Ranked>();
  let position = 0;
  for (const source of matched) {
    for (const property of source.properties) {
      position += 1;
      const declaration = declarationOf(source, property.name, property.value, property.important, property.implicit);
      const ranked: Ranked = {
        declaration,
        tier: tier(source.origin, property.important),
        // Lower ranks win among important layered rules: earlier layers beat later ones.
        layer: source.layer === undefined ? -Infinity : -(layerIndex.get(source.layer) ?? 0),
        position,
      };
      const current = winners.get(declaration.property);
      if (current === undefined || beats(ranked, current)) winners.set(declaration.property, ranked);
    }
  }
  return new Map([...winners].map(([property, ranked]) => [property, ranked.declaration]));
}

function beats(a: Ranked, b: Ranked): boolean {
  if (a.tier !== b.tier) return a.tier > b.tier;
  if (a.tier === 2 && a.layer !== b.layer) return a.layer > b.layer;
  return a.position > b.position;
}

function declarationOf(
  source: StyleSource,
  name: string,
  value: string,
  important: boolean,
  implicit: boolean,
): Declaration {
  const base = {
    origin: source.origin,
    important,
    implicit,
    ...(source.selector === undefined ? {} : { selector: source.selector }),
  };
  if (name.startsWith("--")) return { property: name, value, whole: false, declaredAs: name, ...base };
  const property = physicalProperty(name);
  if (value !== "" || implicit) return { property, value, whole: false, declaredAs: name, ...base };
  // The browser leaves a longhand empty when its shorthand references a custom property: read it
  // from the shorthand as written, the last one in the style that sets the longhand.
  const candidates = new Set(shorthandsOf(property));
  const shorthand = source.shorthands.findLast((s) => candidates.has(s.name));
  if (shorthand === undefined) return { property, value, whole: false, declaredAs: name, ...base };
  const part = longhandInShorthand(shorthand.name, shorthand.value, property);
  return {
    property,
    value: part?.value ?? shorthand.value,
    whole: part?.whole ?? true,
    declaredAs: shorthand.name,
    ...base,
  };
}

/** Strips a trailing `!important` from a value as the protocol reports it. */
export function stripImportant(value: string): string {
  return value.replace(/\s*!\s*important\s*$/i, "");
}
