// SPDX-License-Identifier: GPL-3.0-or-later
// MATRIX-005 (docs/spec/story-matrix.md#reflected-states): a state set by props is reflected on
// its target, and a state with `story: false` is reflected in at least one of the component's
// stories, both as `data-<state>` on the root element of the state's part.
import type { InspectedElement } from "../checks/snapshot.js";
import { pseudoStates } from "../matrix/build.js";
import type { StoryManifest, StoryState } from "../matrix/types.js";
import type { Spec, Stateful } from "../spec/types.js";

/** What MATRIX-005 reads of a rendered element. */
export type ReflectingElement = Pick<InspectedElement, "part" | "partRoot" | "instance" | "states">;

/** A story's elements in one theme, or undefined when it didn't render there. */
export type RenderedElements = (story: string, theme: string) => readonly ReflectingElement[] | undefined;

function scopeOf(spec: Spec, state: StoryState): Stateful | undefined {
  if (state.part === undefined) return spec;
  return spec.parts !== undefined && Object.hasOwn(spec.parts, state.part) ? spec.parts[state.part] : undefined;
}

function recipeOf(scope: Stateful | undefined, name: string) {
  return scope?.produce !== undefined && Object.hasOwn(scope.produce, name) ? scope.produce[name] : undefined;
}

/**
 * Whether the story matrix sets a state by props (docs/spec/story-matrix.md#producing-states): a
 * recipe with `props`, or, with no recipe that has props or input, a boolean prop of its name.
 */
export function setByProps(spec: Spec, state: StoryState): boolean {
  if (state.name === "default" || Object.hasOwn(pseudoStates, state.name)) return false;
  const scope = scopeOf(spec, state);
  const recipe = recipeOf(scope, state.name);
  if (recipe?.props !== undefined) return true;
  if (recipe?.input !== undefined) return false;
  const prop =
    scope?.props !== undefined && Object.hasOwn(scope.props, state.name) ? scope.props[state.name] : undefined;
  return prop?.type === "boolean";
}

/** The states of the component and its parts whose recipe says `story: false`, other than pseudo-states. */
function storyFalseStates(spec: Spec): StoryState[] {
  const states: StoryState[] = [];
  const add = (scope: Stateful, part?: string) => {
    for (const name of scope.states ?? []) {
      if (name === "default" || Object.hasOwn(pseudoStates, name)) continue;
      if (recipeOf(scope, name)?.story !== false) continue;
      states.push(part === undefined ? { name } : { name, part });
    }
  };
  add(spec);
  for (const [part, scope] of Object.entries(spec.parts ?? {})) add(scope, part);
  return states;
}

const describeTarget = (part: string, instance: number, root: boolean) =>
  root ? `the root (data-part="${part}")` : `${part}[${String(instance)}]`;

/**
 * MATRIX-005's problems for one component, from its stories' rendered elements in every theme:
 * - each story whose state is set by props has its target, the component's root or the part's
 *   instance the recipe names (the first by default), carrying `data-<state>`;
 * - each `story: false` state is carried by a root element of its part (the component's root for
 *   a component's state) in at least one render of the component's stories.
 * Stories that didn't render are left out; a component none of whose stories rendered has none.
 */
export function reflectedStateProblems(spec: Spec, manifest: StoryManifest, rendered: RenderedElements): string[] {
  const problems: string[] = [];
  let renders = 0;
  for (const story of manifest.stories) {
    const { state } = story;
    const check = setByProps(spec, state);
    const owner = state.part ?? spec.name;
    const instance = state.part === undefined ? 0 : (recipeOf(scopeOf(spec, state), state.name)?.instance ?? 0);
    const missing: string[] = [];
    for (const theme of manifest.themes) {
      const elements = rendered(story.name, theme);
      if (elements === undefined) continue;
      renders += 1;
      if (!check) continue;
      const target = elements.find((e) => e.partRoot && e.part === owner && (e.instance ?? 0) === instance);
      if (target?.states.includes(state.name) !== true) missing.push(theme);
    }
    if (missing.length > 0) {
      problems.push(
        `MATRIX-005 ${story.name} (${missing.join(", ")}): the story sets the state ${state.name} by props, ` +
          `but its target ${describeTarget(owner, instance, state.part === undefined)} doesn't carry data-${state.name}`,
      );
    }
  }
  if (renders === 0) return problems;
  for (const state of storyFalseStates(spec)) {
    const owner = state.part ?? spec.name;
    const shown = manifest.stories.some((story) =>
      manifest.themes.some((theme) =>
        (rendered(story.name, theme) ?? []).some(
          (e) =>
            e.partRoot &&
            e.part === owner &&
            (state.part !== undefined || (e.instance ?? 0) === 0) &&
            e.states.includes(state.name),
        ),
      ),
    );
    if (!shown) {
      problems.push(
        `MATRIX-005 ${spec.name}: the state ${state.name} of ${owner} has story: false, ` +
          `but no ${owner} element carries data-${state.name} in any of the component's stories`,
      );
    }
  }
  return problems;
}
