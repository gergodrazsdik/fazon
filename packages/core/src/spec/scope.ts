// SPDX-License-Identifier: GPL-3.0-or-later
// What the SPEC rules share: findings at a place in the front matter, the component and its parts
// as scopes, value types, conditions (SPEC-014) and the fixtures stories render.
import type { Finding } from "../findings.js";
import { MatrixError } from "../matrix/error.js";
import { resolveFixture } from "../matrix/fixtures.js";
import type { ManifestFixture } from "../matrix/types.js";
import { jsonPath, type PathSegment } from "../validation/validate.js";
import type { SpecFile } from "./load.js";
import type {
  ComponentName,
  ItemType,
  KebabName,
  MemberName,
  Prop,
  PropValue,
  Spec,
  Stateful,
  TypeFields,
} from "./types.js";

/** A spec file whose front matter passes SPEC-001. */
export type ValidSpecFile = SpecFile & { readonly spec: Spec };

/** A record's own value at a key; undefined for a missing key or one from the prototype. */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The 1-based line of a place: a key's own line when the place ends in a key. */
export function lineAt(file: Pick<SpecFile, "lineOf">, segments: readonly PathSegment[]): number | undefined {
  const last = segments.at(-1);
  return typeof last === "string" ? file.lineOf(segments.slice(0, -1), last) : file.lineOf(segments);
}

/** Collects one rule's findings in one spec. */
export class Findings {
  readonly list: Finding[] = [];
  constructor(
    private readonly rule: string,
    private readonly file: Pick<SpecFile, "file" | "lineOf">,
  ) {}

  /** A finding at a place in the front matter. */
  add(segments: readonly PathSegment[], message: string, hint?: string): void {
    const line = lineAt(this.file, segments);
    this.list.push({
      rule: this.rule,
      file: this.file.file,
      path: jsonPath(segments),
      ...(line === undefined ? {} : { line }),
      message,
      ...(hint === undefined ? {} : { hint }),
    });
  }

  /** A finding at a line of the body. */
  addAtLine(line: number, message: string, hint?: string): void {
    this.list.push({ rule: this.rule, file: this.file.file, line, message, ...(hint === undefined ? {} : { hint }) });
  }
}

/** The component (no `part`) or one of its parts, with where it is in the front matter. */
export interface Scope {
  readonly part?: ComponentName;
  readonly definition: Stateful;
  /** `[]` for the component, `["parts", <Part>]` for a part. */
  readonly segments: readonly PathSegment[];
  /** The component's or the part's name, for messages. */
  readonly name: ComponentName;
}

/** The component, then each part in the order the spec declares them. */
export function scopes(spec: Spec): Scope[] {
  return [
    { definition: spec, segments: [], name: spec.name },
    ...Object.entries(spec.parts ?? {}).map(([part, definition]) => ({
      part,
      definition,
      segments: ["parts", part],
      name: part,
    })),
  ];
}

/** The component (no part) or a part's definition; undefined for a part the spec doesn't declare. */
export function scopeOf(spec: Spec, part: ComponentName | undefined): Stateful | undefined {
  return part === undefined ? spec : own(spec.parts, part);
}

export function hasPart(spec: Spec, part: ComponentName): boolean {
  return own(spec.parts, part) !== undefined;
}

/** A prop of the component (no part) or of a part. */
export function propOf(spec: Spec, part: ComponentName | undefined, prop: MemberName): Prop | undefined {
  return own(scopeOf(spec, part)?.props, prop);
}

/** `size` is the component's prop; `Content.size` is the part's. */
export function splitKey(key: string): { readonly part?: ComponentName; readonly prop: MemberName } {
  const dot = key.indexOf(".");
  return dot === -1 ? { prop: key } : { part: key.slice(0, dot), prop: key.slice(dot + 1) };
}

/** A value as a message quotes it. */
export function show(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : JSON.stringify(value);
}

/** What's wrong with a value of a type, as the end of a sentence about it; undefined when it fits. */
export function typeProblem(type: TypeFields | ItemType, value: unknown): string | undefined {
  switch (type.type) {
    case "boolean":
    case "string":
    case "number":
      return typeof value === type.type ? undefined : `isn't a ${type.type}`;
    case "enum":
      return typeof value === "string" && type.values.includes(value)
        ? undefined
        : `isn't one of its values: ${type.values.join(", ")}`;
    case "array": {
      if (!Array.isArray(value)) return "isn't a list";
      for (const [index, item] of (value as unknown[]).entries()) {
        const problem = typeProblem(type.items, item);
        if (problem !== undefined) return `has an item ${String(index)}, ${show(item)}, that ${problem}`;
      }
      return undefined;
    }
  }
}

/** Whether a state is listed in a scope's `states`. `default`, the state with nothing applied, always is. */
export function listsState(scope: Stateful, state: KebabName): boolean {
  return state === "default" || (scope.states ?? []).includes(state);
}

/** One problem with a condition, at a place in the front matter. */
export interface ConditionProblem {
  readonly segments: readonly PathSegment[];
  readonly message: string;
  readonly hint?: string;
}

/**
 * SPEC-014's problems with one condition: its props must be props of its part (or of the
 * component, when it names no part) with values of their type, and its state a state that part
 * (or the component) lists. With `partProps`, as in `matrix.exclude`, a prop may also be
 * `<Part>.<prop>`, a prop of that part. The condition's part must exist; the rule that owns the
 * condition checks that.
 */
export function conditionProblems(
  spec: Spec,
  condition: { readonly props?: Readonly<Record<string, PropValue>>; readonly state?: KebabName },
  part: ComponentName | undefined,
  segments: readonly PathSegment[],
  partProps = false,
): ConditionProblem[] {
  const problems: ConditionProblem[] = [];
  const scope = scopeOf(spec, part);
  if (scope === undefined) return problems;
  const owner = part ?? spec.name;
  for (const [key, value] of Object.entries(condition.props ?? {})) {
    const at = [...segments, "props", key];
    const split = partProps ? splitKey(key) : { prop: key };
    const propPart = split.part ?? part;
    if (split.part !== undefined && !hasPart(spec, split.part)) {
      problems.push({
        segments: at,
        message: `the condition names ${key}, but ${spec.name} has no part ${split.part}`,
      });
      continue;
    }
    const prop = propOf(spec, propPart, split.prop);
    if (prop === undefined) {
      problems.push({
        segments: at,
        message: `the condition names the prop ${split.prop}, which ${propPart ?? spec.name} doesn't have`,
        hint:
          part === undefined
            ? `Name a prop of ${spec.name}, or set part to the part whose prop it is.`
            : `Name a prop of ${part}.`,
      });
      continue;
    }
    const problem = typeProblem(prop, value);
    if (problem !== undefined) {
      problems.push({ segments: at, message: `the condition sets ${key} to ${show(value)}, which ${problem}` });
    }
  }
  if (condition.state !== undefined && !listsState(scope, condition.state)) {
    problems.push({
      segments: [...segments, "state"],
      message: `the condition names the state ${condition.state}, which ${owner} doesn't list in its states`,
      hint: `Add it to the states of ${owner}, or name a listed state${part === undefined ? ", or set part to the part whose state it is" : ""}.`,
    });
  }
  return problems;
}

/** The empty fixture's name, which stories render when a spec has no fixtures (story-matrix.md#fixtures). */
const emptyFixture = "empty";

/** The fixture of the axes and states grids: the first of `matrix.fixtures`, else the spec's first. */
export function firstFixture(spec: Spec): KebabName {
  return spec.matrix?.fixtures?.[0] ?? Object.keys(spec.fixtures ?? {})[0] ?? emptyFixture;
}

/** A fixture with its `extends` merged; the empty fixture when the spec has none; undefined when it can't be merged (SPEC-009). */
export function mergedFixture(spec: Spec, name: KebabName): ManifestFixture | undefined {
  if (spec.fixtures === undefined && name === emptyFixture) return {};
  try {
    return resolveFixture(spec, name);
  } catch (error) {
    if (error instanceof MatrixError) return undefined;
    throw error;
  }
}

/**
 * The fixtures the stories of one state render: the first fixture for its states-grid stories
 * (none when its recipe says `story: false`), and the fixture of each `matrix.include` entry that
 * forces it.
 */
export function stateFixtures(spec: Spec, state: KebabName, part: ComponentName | undefined): KebabName[] {
  const recipe = own(scopeOf(spec, part)?.produce, state);
  const fixtures = new Set<KebabName>();
  if (recipe?.story !== false) fixtures.add(firstFixture(spec));
  for (const point of spec.matrix?.include ?? []) {
    if (point.state === state && point.part === part) fixtures.add(point.fixture ?? firstFixture(spec));
  }
  return [...fixtures];
}

/** How many instances of a part a merged fixture holds. */
export function instanceCount(fixture: ManifestFixture, part: ComponentName): number {
  return own(fixture.parts, part)?.length ?? 0;
}
