// SPDX-License-Identifier: GPL-3.0-or-later
// Which stories a judge question's `select` picks (docs/spec/spec-format.md#judge-questions):
// SPEC-018 checks that it picks one, and the judge's plan asks the question about them.
import { isDeepStrictEqual } from "node:util";
import type { Story, StoryManifest } from "../matrix/types.js";
import { own, propOf } from "./scope.js";
import type { ComponentName, Spec } from "./types.js";

/** A prop's value in a story (docs/spec/story-matrix.md#exclusions): the story sets it, else its fixture, else its default. */
export function valueIn(
  spec: Spec,
  manifest: StoryManifest,
  story: Story,
  part: ComponentName | undefined,
  prop: string,
): unknown {
  let value: unknown;
  for (const { target, props } of story.set ?? []) {
    const onTarget = part === undefined ? target === "root" : target.startsWith(`${part}[`);
    if (onTarget && Object.hasOwn(props, prop)) value = props[prop];
  }
  if (value !== undefined) return value;
  const fixture = own(manifest.fixtures, story.fixture);
  const props = part === undefined ? fixture?.props : own(fixture?.parts, part)?.[0]?.props;
  const set = own(props, prop);
  return set ?? propOf(spec, part, prop)?.default;
}

/** Whether a judge question's `select` picks a story: its fixture, and its condition on the part's (or the component's) props and state. */
export function picks(
  spec: Spec,
  manifest: StoryManifest,
  story: Story,
  select: NonNullable<NonNullable<Spec["judge"]>[number]["select"]>,
): boolean {
  if (select.fixture !== undefined && story.fixture !== select.fixture) return false;
  const when = select.when;
  if (when?.state !== undefined) {
    if (
      when.state === "default"
        ? story.state.name !== "default"
        : story.state.name !== when.state || story.state.part !== select.part
    ) {
      return false;
    }
  }
  return Object.entries(when?.props ?? {}).every(([prop, expected]) =>
    isDeepStrictEqual(valueIn(spec, manifest, story, select.part, prop), expected),
  );
}
