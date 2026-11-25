// SPDX-License-Identifier: GPL-3.0-or-later
// The story matrix rules (docs/spec/story-matrix.md): from a spec to its story manifest.
import { isDeepStrictEqual } from "node:util";
import type {
  ComponentName,
  InputStep,
  KebabName,
  MatrixCondition,
  MatrixPoint,
  MemberName,
  Prop,
  PropValue,
  Spec,
  Stateful,
} from "../spec/types.js";
import type { PathSegment } from "../validation/validate.js";
import { MatrixError } from "./error.js";
import { resolveFixture } from "./fixtures.js";
import { storybookId, storyName } from "./names.js";
import type { Grid, ManifestFixture, Story, StoryManifest, StorySet, StoryState, Viewport } from "./types.js";

export interface BuildManifestOptions {
  /** The spec's path, relative to the repository root, with `/` separators: `specs/button.md`. */
  readonly file: string;
  /** The token set's themes, in its order. */
  readonly themes: readonly KebabName[];
  /** The `theme` modifier's default; the first of `themes` when left out. It comes first in the manifest. */
  readonly defaultTheme?: KebabName;
}

/** The viewport every story renders in (docs/spec/story-matrix.md#rendering). */
export const storyViewport: Viewport = Object.freeze({ width: 1024, height: 768, scale: 2 });

/**
 * The fixture a spec without fixtures renders: no props, slots or parts. The story matrix rules
 * don't name it; stories and baselines take this name.
 */
export const emptyFixtureName = "empty";

/** The input action each pseudo-state comes from (docs/spec/story-matrix.md#producing-states). */
export const pseudoStates: Readonly<Record<KebabName, "hover" | "focus" | "pointer-down">> = Object.freeze({
  hover: "hover",
  "focus-visible": "focus",
  active: "pointer-down",
});

type AxisValue = boolean | string | number;

interface Axis {
  /** As written in `matrix.axes`: `<prop>` or `<Part>.<prop>`. */
  readonly key: string;
  readonly part?: ComponentName;
  readonly prop: MemberName;
  readonly values: readonly AxisValue[];
  readonly default: AxisValue;
}

/** A state the matrix can show, other than `default`. */
interface MatrixState {
  readonly state: StoryState;
  /** The component, or the part, that lists it. */
  readonly scope: Stateful;
  /** Where the state is listed in the spec. */
  readonly segments: readonly PathSegment[];
}

/** What a story does to show its state: props set and input performed. */
interface Production {
  readonly set: readonly StorySet[];
  readonly input: readonly InputStep[];
}

const nothing: Production = { set: [], input: [] };

/**
 * The story manifest of a spec, by the story matrix rules: every story, in order, with its name,
 * Storybook ID, point in the matrix, how its state is produced and the themes the judge sees it in.
 * The result depends only on the spec and the options; it shares no objects with the spec.
 * @throws MatrixError when the spec breaks a SPEC rule the expansion relies on (SPEC-009, SPEC-010,
 *   SPEC-015, SPEC-016, SPEC-017)
 */
export function buildManifest(spec: Spec, options: BuildManifestOptions): StoryManifest {
  const themes = orderThemes(options.themes, options.defaultTheme);
  const matrix = new Matrix(spec, themes);
  // The stories first: forced stories add the fixtures they render.
  const stories = matrix.stories();
  return {
    fazon: 0,
    component: spec.name,
    spec: options.file,
    themes,
    viewport: { ...storyViewport },
    fixtures: matrix.fixtureEntries(),
    stories,
  };
}

function orderThemes(themes: readonly KebabName[], defaultTheme: KebabName | undefined): readonly KebabName[] {
  const first = defaultTheme ?? themes[0];
  if (first === undefined) {
    throw new Error("the token set has no themes; the story manifest needs at least one");
  }
  if (!themes.includes(first)) {
    throw new Error(`the default theme '${first}' isn't one of the themes: ${themes.join(", ")}`);
  }
  if (new Set(themes).size !== themes.length) {
    throw new Error(`the themes repeat a name: ${themes.join(", ")}`);
  }
  return [first, ...themes.filter((theme) => theme !== first)];
}

class Matrix {
  private readonly spec: Spec;
  private readonly themes: readonly KebabName[];
  private readonly axes: readonly Axis[];
  /** The fixtures of `matrix.fixtures`, or the spec's first fixture, or the empty fixture. */
  private readonly matrixFixtures: readonly KebabName[];
  /** Every fixture a story renders, in the order they're first rendered. */
  private readonly rendered = new Map<KebabName, ManifestFixture>();

  constructor(spec: Spec, themes: readonly KebabName[]) {
    this.spec = spec;
    this.themes = themes;
    this.axes = (spec.matrix?.axes ?? []).map((key, index) => this.axis(key, index));
    this.matrixFixtures = this.listFixtures();
    for (const name of this.matrixFixtures) {
      this.renderFixture(name);
    }
  }

  fixtureEntries(): Record<KebabName, ManifestFixture> {
    return Object.fromEntries(this.rendered);
  }

  stories(): Story[] {
    const [first, ...others] = this.matrixFixtures as [KebabName, ...KebabName[]];
    const defaults = this.defaultAxes();
    const grids: Story[] = [];
    const add = (story: Story | undefined) => {
      if (story !== undefined) {
        grids.push(story);
      }
    };

    // The axes grid: every combination, the first axis changing slowest, in the default state.
    for (const axes of this.combinations()) {
      add(this.story("axes", first, axes, { name: "default" }, nothing));
    }
    // The states grid: each state against the first axis's values, the other axes at their defaults.
    const [firstAxis] = this.axes;
    for (const entry of this.states()) {
      if (this.recipe(entry)?.story === false) {
        continue;
      }
      const production = this.produce(entry);
      const variations =
        firstAxis === undefined
          ? [defaults]
          : firstAxis.values.map((value) => ({ ...defaults, [firstAxis.key]: value }));
      for (const axes of variations) {
        add(this.story("states", first, axes, entry.state, production));
      }
    }
    // The fixtures grid: each other fixture at the defaults.
    for (const fixture of others) {
      add(this.story("fixtures", fixture, defaults, { name: "default" }, nothing));
    }

    // The include grid: forced stories, in the order of matrix.include.
    const made = new Map<string, Grid>(grids.map((story) => [story.name, story.grid]));
    const included: Story[] = [];
    (this.spec.matrix?.include ?? []).forEach((point, index) => {
      const story = this.forced(point, index, first, defaults);
      const grid = made.get(story.name);
      if (grid !== undefined) {
        throw new MatrixError(
          "SPEC-017",
          ["matrix", "include", index],
          `matrix.include[${String(index)}] forces ${story.name}, which the ${grid} grid already makes`,
        );
      }
      made.set(story.name, story.grid);
      included.push(story);
    });
    return [...grids, ...included];
  }

  // Axes --------------------------------------------------------------------------------------

  private axis(key: string, index: number): Axis {
    const at = ["matrix", "axes", index];
    const { part, prop } = splitKey(key);
    const definition = this.propOf(part, prop);
    if (definition === undefined) {
      throw new MatrixError("SPEC-010", at, `the axis ${key} names no prop of ${part ?? this.spec.name}`);
    }
    let values: readonly AxisValue[];
    if (definition.type === "enum") {
      values = definition.values;
    } else if (definition.type === "boolean") {
      values = [false, true];
    } else {
      throw new MatrixError(
        "SPEC-010",
        at,
        `the axis ${key} is a ${definition.type} prop; an axis is an enum or a boolean`,
      );
    }
    const [firstValue] = values;
    if (firstValue === undefined) {
      throw new MatrixError("SPEC-010", at, `the axis ${key} has no values`);
    }
    const fallback = definition.default;
    const axisDefault = typeof fallback === "string" || typeof fallback === "boolean" ? fallback : firstValue;
    return { key, ...(part === undefined ? {} : { part }), prop, values, default: axisDefault };
  }

  private defaultAxes(): Record<string, AxisValue> {
    return Object.fromEntries(this.axes.map((axis) => [axis.key, axis.default]));
  }

  /** Every combination of axis values, the first axis changing slowest; one empty one without axes. */
  private combinations(): Record<string, AxisValue>[] {
    let combinations: Record<string, AxisValue>[] = [{}];
    for (const axis of this.axes) {
      combinations = combinations.flatMap((combination) =>
        axis.values.map((value) => ({ ...combination, [axis.key]: value })),
      );
    }
    return combinations;
  }

  /** The axis values as `set` entries: the root's together, then each part's on every instance. */
  private axisSets(axes: Readonly<Record<string, AxisValue>>): StorySet[] {
    const byTarget = new Map<string, Record<MemberName, AxisValue>>();
    const root: Record<MemberName, AxisValue> = {};
    byTarget.set("root", root);
    for (const axis of this.axes) {
      const value = axes[axis.key];
      if (value === undefined) {
        continue;
      }
      const target = axis.part === undefined ? "root" : `${axis.part}[*]`;
      const props = byTarget.get(target) ?? {};
      props[axis.prop] = value;
      byTarget.set(target, props);
    }
    return [...byTarget]
      .filter(([, props]) => Object.keys(props).length > 0)
      .map(([target, props]) => ({ target, props }));
  }

  // Fixtures ----------------------------------------------------------------------------------

  private listFixtures(): readonly KebabName[] {
    const declared = Object.keys(this.spec.fixtures ?? {});
    const listed = this.spec.matrix?.fixtures;
    if (listed === undefined) {
      return [declared[0] ?? emptyFixtureName];
    }
    listed.forEach((name, index) => {
      if (!declared.includes(name)) {
        throw new MatrixError(
          "SPEC-010",
          ["matrix", "fixtures", index],
          `matrix.fixtures names ${name}, which isn't a fixture`,
        );
      }
    });
    if (listed.length === 0) {
      throw new MatrixError("SPEC-010", ["matrix", "fixtures"], "matrix.fixtures lists no fixture");
    }
    return listed;
  }

  private renderFixture(name: KebabName): ManifestFixture {
    let fixture = this.rendered.get(name);
    if (fixture === undefined) {
      fixture = this.spec.fixtures === undefined && name === emptyFixtureName ? {} : resolveFixture(this.spec, name);
      this.rendered.set(name, fixture);
    }
    return fixture;
  }

  // States ------------------------------------------------------------------------------------

  /** The component's states, then each part's in the order the parts are declared; not `default`. */
  private states(): MatrixState[] {
    const list: MatrixState[] = [];
    (this.spec.states ?? []).forEach((name, index) => {
      if (name !== "default") {
        list.push({ state: { name }, scope: this.spec, segments: ["states", index] });
      }
    });
    for (const [part, definition] of Object.entries(this.spec.parts ?? {})) {
      (definition.states ?? []).forEach((name, index) => {
        if (name !== "default") {
          list.push({ state: { name, part }, scope: definition, segments: ["parts", part, "states", index] });
        }
      });
    }
    return list;
  }

  private recipe({ scope, state }: MatrixState) {
    return scope.produce !== undefined && Object.hasOwn(scope.produce, state.name)
      ? scope.produce[state.name]
      : undefined;
  }

  /**
   * How a state is produced: a recipe with props or input; else a boolean prop of the state's name;
   * else a pseudo-state's input. A recipe with neither props nor input (only `story` or `instance`)
   * doesn't produce the state itself: the later rules do, on the instance it names. When none
   * applies, a `story: false` state renders its fixture as it is (in a forced story); any other
   * state can't be produced.
   */
  private produce(entry: MatrixState): Production {
    const { state, scope } = entry;
    const recipe = this.recipe(entry);
    const instance = state.part === undefined ? undefined : recipe?.instance;
    const target = (fallback: "0" | "default") =>
      state.part === undefined ? "root" : `${state.part}[${instance === undefined ? fallback : String(instance)}]`;

    if (recipe?.props !== undefined || recipe?.input !== undefined) {
      const set = recipe.props === undefined ? [] : [{ target: target("0"), props: structuredClone(recipe.props) }];
      const input = (recipe.input ?? []).map((step, index) =>
        this.normaliseStep(step, [...this.scopePath(state), "produce", state.name, "input", index]),
      );
      return { set, input };
    }
    const prop =
      scope.props !== undefined && Object.hasOwn(scope.props, state.name) ? scope.props[state.name] : undefined;
    if (prop?.type === "boolean") {
      return { set: [{ target: target("0"), props: { [state.name]: true } }], input: [] };
    }
    const action = Object.hasOwn(pseudoStates, state.name) ? pseudoStates[state.name] : undefined;
    if (action !== undefined) {
      return { set: [], input: [{ action, target: target("default") }] };
    }
    if (recipe?.story === false) {
      // The fixtures show the state; a forced story of it renders its fixture as it is.
      return nothing;
    }
    const owner = state.part ?? this.spec.name;
    throw new MatrixError(
      "SPEC-015",
      entry.segments,
      `the state ${state.name} of ${owner} can't be produced: it has no recipe with props or input, no boolean prop of its name, and isn't hover, focus-visible or active`,
    );
  }

  private scopePath(state: StoryState): PathSegment[] {
    return state.part === undefined ? [] : ["parts", state.part];
  }

  /** A recipe's step with its target in the manifest's form: `<Part>` is `<Part>[0]`. */
  private normaliseStep(step: InputStep, at: readonly PathSegment[]): InputStep {
    if (step.action === "press") {
      return { action: step.action, key: step.key };
    }
    const match = /^([A-Z][A-Za-z0-9]*)(?:\[([0-9]+)\])?$/.exec(step.target);
    let target = step.target;
    if (match !== null) {
      const [, part, index] = match as unknown as [string, string, string | undefined];
      if (this.spec.parts === undefined || !Object.hasOwn(this.spec.parts, part)) {
        throw new MatrixError("SPEC-016", [...at, "target"], `the input target ${step.target} names no part`);
      }
      target = `${part}[${index ?? "0"}]`;
    }
    return step.action === "scroll" ? { action: step.action, target, to: step.to } : { action: step.action, target };
  }

  // Stories -----------------------------------------------------------------------------------

  /** A story, or nothing when an exclude condition drops it. */
  private story(
    grid: Grid,
    fixture: KebabName,
    axes: Readonly<Record<string, AxisValue>>,
    state: StoryState,
    production: Production,
  ): Story | undefined {
    if (this.excludedBy(fixture, axes, state, production) !== undefined) {
      return undefined;
    }
    return this.make(grid, fixture, axes, state, production);
  }

  private make(
    grid: Grid,
    fixture: KebabName,
    axes: Readonly<Record<string, AxisValue>>,
    state: StoryState,
    production: Production,
  ): Story {
    const name = storyName(this.spec.name, fixture, axes, state);
    const set = [...this.axisSets(axes), ...structuredClone(production.set)];
    const input = structuredClone(production.input);
    return {
      name,
      storybookId: storybookId(this.spec.name, name),
      grid,
      fixture,
      axes: { ...axes },
      state: { ...state },
      ...(set.length > 0 ? { set } : {}),
      ...(input.length > 0 ? { input } : {}),
      judge: grid === "axes" || grid === "include" ? [...this.themes] : this.themes.slice(0, 1),
    };
  }

  /** A forced story from `matrix.include`, produced as any other, even when its recipe says `story: false`. */
  private forced(
    point: MatrixPoint,
    index: number,
    first: KebabName,
    defaults: Readonly<Record<string, AxisValue>>,
  ): Story {
    const at = ["matrix", "include", index];
    const fixture = point.fixture ?? first;
    if (
      point.fixture !== undefined &&
      (this.spec.fixtures === undefined || !Object.hasOwn(this.spec.fixtures, fixture))
    ) {
      throw new MatrixError(
        "SPEC-017",
        [...at, "fixture"],
        `matrix.include[${String(index)}] names ${fixture}, which isn't a fixture`,
      );
    }

    const axes: Record<string, AxisValue> = { ...defaults };
    for (const [key, value] of Object.entries(point.props ?? {})) {
      const axis = this.axes.find((candidate) => candidate.key === key);
      if (axis === undefined) {
        throw new MatrixError(
          "SPEC-017",
          [...at, "props", key],
          `matrix.include[${String(index)}] sets ${key}, which isn't an axis`,
        );
      }
      if (!axis.values.includes(value)) {
        throw new MatrixError(
          "SPEC-017",
          [...at, "props", key],
          `matrix.include[${String(index)}] sets ${key} to ${String(value)}, which isn't one of its values: ${axis.values.map(String).join(", ")}`,
        );
      }
      axes[key] = value;
    }

    const stateName = point.state ?? "default";
    let entry: MatrixState | undefined;
    if (stateName !== "default") {
      entry = this.states().find(
        (candidate) => candidate.state.name === stateName && candidate.state.part === point.part,
      );
      if (entry === undefined) {
        throw new MatrixError(
          "SPEC-017",
          [...at, "state"],
          `matrix.include[${String(index)}] names the state ${stateName}, which ${point.part ?? this.spec.name} doesn't list`,
        );
      }
    }
    const state = entry?.state ?? { name: "default" };
    const production = entry === undefined ? nothing : this.produce(entry);

    this.renderFixture(fixture);
    const condition = this.excludedBy(fixture, axes, state, production);
    if (condition !== undefined) {
      throw new MatrixError(
        "SPEC-017",
        at,
        `matrix.include[${String(index)}] forces a story that matrix.exclude[${String(condition)}] drops`,
      );
    }
    return this.make("include", fixture, axes, state, production);
  }

  // Exclusions --------------------------------------------------------------------------------

  /** The index of the first exclude condition the story matches, if any. */
  private excludedBy(
    fixture: KebabName,
    axes: Readonly<Record<string, AxisValue>>,
    state: StoryState,
    production: Production,
  ): number | undefined {
    const conditions = this.spec.matrix?.exclude ?? [];
    const index = conditions.findIndex((condition) => this.matches(condition, fixture, axes, state, production));
    return index === -1 ? undefined : index;
  }

  private matches(
    condition: MatrixCondition,
    fixture: KebabName,
    axes: Readonly<Record<string, AxisValue>>,
    state: StoryState,
    production: Production,
  ): boolean {
    if (condition.state !== undefined && (condition.state !== state.name || condition.part !== state.part)) {
      return false;
    }
    return Object.entries(condition.props ?? {}).every(([key, expected]) => {
      const split = splitKey(key);
      // A prop without a part is the condition's part's, or the component's when it names no part.
      const part = split.part ?? condition.part;
      const actual = this.valueIn(part, split.prop, fixture, axes, production);
      return actual !== undefined && isDeepStrictEqual(actual, expected);
    });
  }

  /**
   * A prop's value in a story: its axis value; otherwise the value the state sets; otherwise the
   * fixture's (a part's first instance's); otherwise its default.
   */
  private valueIn(
    part: ComponentName | undefined,
    prop: MemberName,
    fixture: KebabName,
    axes: Readonly<Record<string, AxisValue>>,
    production: Production,
  ): PropValue | undefined {
    const axis = this.axes.find((candidate) => candidate.part === part && candidate.prop === prop);
    if (axis !== undefined) {
      return axes[axis.key];
    }
    let fromState: PropValue | undefined;
    for (const { target, props } of production.set) {
      const onTarget = part === undefined ? target === "root" : target.startsWith(`${part}[`);
      if (onTarget && Object.hasOwn(props, prop)) {
        fromState = props[prop];
      }
    }
    if (fromState !== undefined) {
      return fromState;
    }
    const content = this.renderFixture(fixture);
    const props = part === undefined ? content.props : content.parts?.[part]?.[0]?.props;
    if (props !== undefined && Object.hasOwn(props, prop)) {
      return props[prop];
    }
    return this.propOf(part, prop)?.default;
  }

  private propOf(part: ComponentName | undefined, prop: MemberName): Prop | undefined {
    const scope: Stateful | undefined =
      part === undefined
        ? this.spec
        : this.spec.parts !== undefined && Object.hasOwn(this.spec.parts, part)
          ? this.spec.parts[part]
          : undefined;
    const props = scope?.props;
    return props !== undefined && Object.hasOwn(props, prop) ? props[prop] : undefined;
  }
}

/** `size` is the component's prop; `Content.size` is the part's. */
function splitKey(key: string): { readonly part?: ComponentName; readonly prop: MemberName } {
  const dot = key.indexOf(".");
  return dot === -1 ? { prop: key } : { part: key.slice(0, dot), prop: key.slice(dot + 1) };
}
