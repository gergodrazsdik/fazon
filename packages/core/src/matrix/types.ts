// SPDX-License-Identifier: GPL-3.0-or-later
// The story manifest as TypeScript types. docs/spec/schemas/story-manifest.schema.json is the
// source of truth and docs/spec/story-matrix.md#the-manifest explains it; a change to the schema
// changes these types in the same pull request.
import type { ComponentName, Fixture, InputStep, KebabName, PropValues } from "../spec/types.js";

/** The grid a story comes from (docs/spec/story-matrix.md#expansion-three-grids). */
export type Grid = "axes" | "states" | "fixtures" | "include";

/** `root`, `<Part>[<n>]`, `<Part>[*]` (every instance) or `<Part>[default]` (chosen at render time). */
export type ManifestTarget = string;

/** A fixture as stories render it: `extends` merged, without `extends` and `description`. */
export type ManifestFixture = Pick<Fixture, "props" | "slots" | "parts" | "frame">;

/** The state a story shows; `part` for a part's state. */
export interface StoryState {
  readonly name: KebabName;
  readonly part?: ComponentName;
}

/** Prop values a story sets over its fixture, on one target. */
export interface StorySet {
  readonly target: ManifestTarget;
  readonly props: PropValues;
}

/** One story: a point of the matrix, and how to render and produce it. */
export interface Story {
  /** `<component>--<fixture>--<axis>-<value>--…--<state>`; baselines are named after it. */
  readonly name: string;
  /** The ID Storybook derives from the component's title and the story's export name. */
  readonly storybookId: string;
  readonly grid: Grid;
  readonly fixture: KebabName;
  /** The value of every axis, keyed and ordered as in `matrix.axes`. */
  readonly axes: Readonly<Record<string, boolean | string | number>>;
  readonly state: StoryState;
  /** Axis values, then the state's props; absent when there are none. */
  readonly set?: readonly StorySet[];
  /** The steps that produce the state; absent when there are none. */
  readonly input?: readonly InputStep[];
  /** The themes in which the judge sees the story. */
  readonly judge: readonly KebabName[];
}

/** The rendering conditions every story shares (docs/spec/story-matrix.md#rendering). */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** The device scale factor. */
  readonly scale: number;
}

/** The story manifest of one component, format version 0. */
export interface StoryManifest {
  readonly fazon: 0;
  readonly component: ComponentName;
  /** The spec's path, relative to the repository root. */
  readonly spec: string;
  /** The token set's themes; the first is the default theme. */
  readonly themes: readonly KebabName[];
  readonly viewport: Viewport;
  /** The fixtures the stories render, in the order they're first rendered. */
  readonly fixtures: Readonly<Record<KebabName, ManifestFixture>>;
  readonly stories: readonly Story[];
}
