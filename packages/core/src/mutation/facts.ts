// SPDX-License-Identifier: GPL-3.0-or-later
// What a mutation operator needs to know about an unmodified story in one theme
// (docs/spec/measurement.md#seeded-defects): for each part root, the declarations that win the
// cascade for the properties the operators change, whether the part holds text, and its icons.
// The facts come from the same inspection the rendered checks make (RenderedPage.inspect).
import { winningDeclarations, type Declaration } from "../checks/cascade.js";
import type { InspectedElement, PageInspection } from "../checks/snapshot.js";

/** The properties the operators read and write. */
export const factProperties: ReadonlySet<string> = new Set([
  "background-color",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "outline-style",
  "outline-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "font-weight",
]);

/** One winning declaration of a part root, as the author wrote it. */
export interface FactDeclaration {
  /** The physical longhand. */
  readonly property: string;
  /** The property as written: the longhand, its logical form, or the shorthand. */
  readonly declaredAs: string;
  /** The declared value: the longhand's, or the whole shorthand's when it was declared as one. */
  readonly value: string;
}

/** A part root and what's under it, up to the next part root. */
export interface PartFacts {
  /** The `data-part` name. */
  readonly part: string;
  /** Its position among the part roots with the same name, from 0. */
  readonly instance: number;
  /** A selector for it in the page. */
  readonly selector: string;
  readonly declarations: readonly FactDeclaration[];
  /** It, or an element it owns, has text of its own. */
  readonly text: boolean;
  /** Selectors of the `svg` elements it owns. */
  readonly icons: readonly string[];
  /** The states it reflects, such as `disabled`. */
  readonly states: readonly string[];
}

/** One story's facts in one theme: its part roots in document order, the component's root first. */
export interface StoryFacts {
  readonly parts: readonly PartFacts[];
}

/** The facts of a story from its inspection, styles included. */
export function storyFacts(inspection: PageInspection): StoryFacts {
  const { elements } = inspection;
  /** The index of the part root that owns an element: itself, or its nearest part-root ancestor. */
  const owner = (index: number): number | undefined => {
    let current: number | undefined = index;
    while (current !== undefined) {
      const element: InspectedElement | undefined = elements[current];
      if (element === undefined) return undefined;
      if (element.partRoot) return current;
      current = element.parent;
    }
    return undefined;
  };
  const text = new Set<number>();
  const icons = new Map<number, string[]>();
  elements.forEach((element, index) => {
    const root = owner(index);
    if (root === undefined) return;
    if (element.fonts !== undefined) text.add(root);
    if (element.tag === "svg") icons.set(root, [...(icons.get(root) ?? []), element.selector]);
  });
  const parts: PartFacts[] = [];
  elements.forEach((element, index) => {
    if (!element.partRoot || element.part === undefined) return;
    const winners: Map<string, Declaration> =
      element.styles === undefined ? new Map<string, Declaration>() : winningDeclarations(element.styles.matched);
    const declarations: FactDeclaration[] = [];
    for (const [property, declaration] of winners) {
      if (!factProperties.has(property) || declaration.implicit) continue;
      if (declaration.origin === "user-agent") continue;
      declarations.push({ property, declaredAs: declaration.declaredAs, value: declaration.value });
    }
    parts.push({
      part: element.part,
      instance: element.instance ?? 0,
      selector: element.selector,
      declarations,
      text: text.has(index),
      icons: icons.get(index) ?? [],
      states: element.states,
    });
  });
  return { parts };
}
