// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's rubric and plan (docs/spec/judge.md#the-rubric, #batching): the questions the
// harness derives from a spec and its story manifest, and one call per question, theme and
// batch of at most 20 images. The plan names images; it holds no code and no check findings
// (JUDGE-001), as nothing here reads either.
import { levelTwoHeading, proseLines } from "../spec/body.js";
import { axisSegmentKey, stateSegment } from "../matrix/names.js";
import type { Story, StoryManifest } from "../matrix/types.js";
import { propOf, splitKey } from "../spec/scope.js";
import { picks } from "../spec/select.js";
import type { ComponentName, KebabName, Spec } from "../spec/types.js";

/** The most images one call carries (JUDGE-002). */
export const maxImagesPerCall = 20;

/** The most other components the `family` question shows. */
export const maxFamilyComponents = 5;

export type JudgeImageKind = "capture" | "baseline" | "diff" | "reference" | "component";

/** One image of a call, as the plan names it; the harness finds its file when it makes the call. */
export interface JudgePlanImage {
  readonly kind: JudgeImageKind;
  /** What the prompt calls the image; the judge's result names it. */
  readonly label: string;
  /** The story it shows: this component's, or another component's for `component`. */
  readonly story?: string;
}

export interface JudgeCall {
  readonly question: string;
  readonly source: "derived" | "spec";
  readonly kind: "each" | "compare";
  readonly text: string;
  readonly theme: KebabName;
  readonly images: readonly JudgePlanImage[];
}

/** A component's judge plan, format version 0 (docs/spec/schemas/judge-plan.schema.json). */
export interface JudgePlan {
  readonly fazon: 0;
  readonly component: ComponentName;
  readonly calls: readonly JudgeCall[];
}

export interface JudgePlanInput {
  readonly spec: Spec;
  /** The spec's Markdown body, for its `## Appearance` statements. */
  readonly body: string;
  readonly manifest: StoryManifest;
  /**
   * The stories the judge sees: in CI, the ones whose baselines the pull request adds or changes.
   * Every story when absent. An `each` question asks only about these; a `compare` call is kept
   * whole when one of its images shows one of them, and left out otherwise.
   */
  readonly stories?: ReadonlySet<string>;
  /** The stories whose committed baseline differs from the capture, each in the theme it differs in. */
  readonly changed?: readonly { readonly story: string; readonly theme: KebabName }[];
  /** Other components' default stories that have baselines, for `family`; the first five are shown. */
  readonly family?: readonly { readonly component: ComponentName; readonly story: string }[];
}

/** One question of the rubric, before it's split by theme and batch. */
interface Question {
  readonly question: string;
  readonly source: "derived" | "spec";
  readonly kind: "each" | "compare";
  readonly text: string;
  /** The question's images in each theme it's asked in, in the manifest's theme order. */
  readonly themes: readonly { readonly theme: KebabName; readonly images: readonly JudgePlanImage[] }[];
}

/** The `## Appearance` section's list items, in order; each becomes an `appearance-<n>` question. */
export function appearanceStatements(body: string): string[] {
  const statements: string[] = [];
  let inSection = false;
  let current: string[] | undefined;
  const close = () => {
    if (current !== undefined && current.length > 0) statements.push(current.join(" "));
    current = undefined;
  };
  for (const { text } of proseLines(body, 1)) {
    const heading = levelTwoHeading(text);
    if (heading !== undefined) {
      close();
      inSection = heading === "Appearance";
      continue;
    }
    if (!inSection) continue;
    const item = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(text);
    if (item !== null) {
      close();
      current = [(item[1] ?? "").trim()];
    } else if (text.trim() === "") {
      close();
    } else if (current !== undefined && /^[ \t]/.test(text)) {
      current.push(text.trim());
    } else {
      close();
    }
  }
  close();
  return statements;
}

/** The judge's plan for one component (docs/spec/judge.md#batching). */
export function judgePlan(input: JudgePlanInput): JudgePlan {
  const calls = rubric(input).flatMap((question) =>
    question.themes.flatMap(({ theme, images }) => {
      const kept = keep(question.kind, images, input.stories);
      return chunks(kept, maxImagesPerCall).map((batch) => ({
        question: question.question,
        source: question.source,
        kind: question.kind,
        text: question.text,
        theme,
        images: batch,
      }));
    }),
  );
  return { fazon: 0, component: input.spec.name, calls };
}

/** The images a call keeps of a question's images in one theme, given the stories the judge sees. */
function keep(
  kind: "each" | "compare",
  images: readonly JudgePlanImage[],
  seen: ReadonlySet<string> | undefined,
): readonly JudgePlanImage[] {
  if (seen === undefined) return images;
  const shows = (image: JudgePlanImage) =>
    image.kind !== "component" && image.story !== undefined && seen.has(image.story);
  if (kind === "each") return images.filter(shows);
  return images.some(shows) ? images : [];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/** The rubric's questions in its order: story, axes, states, appearance, reference, family, changes, the spec's own. */
function rubric(input: JudgePlanInput): Question[] {
  const { spec, manifest } = input;
  const themes = manifest.themes;
  const [defaultTheme] = themes;
  if (defaultTheme === undefined) return [];
  const capture = (story: Story): JudgePlanImage => ({ kind: "capture", label: story.name, story: story.name });
  /** The stories judged in each theme, as capture images; themes without one are left out. */
  const inThemes = (stories: readonly Story[], only?: readonly KebabName[]) =>
    (only ?? themes)
      .map((theme) => ({ theme, images: stories.filter((story) => story.judge.includes(theme)).map(capture) }))
      .filter(({ images }) => images.length > 0);

  const axes = axisDefaults(spec, manifest);
  const atDefaults = (story: Story, except?: string) =>
    Object.entries(axes).every(([key, value]) => key === except || story.axes[key] === value);
  const defaultStory = defaultStoryOf(spec, manifest);
  const questions: Question[] = [];

  questions.push({
    question: "story",
    source: "derived",
    kind: "each",
    text: "Does each story look the way the spec describes for its props, state and content?",
    themes: inThemes(manifest.stories),
  });

  for (const key of Object.keys(axes)) {
    const stories = manifest.stories.filter((story) => story.grid === "axes" && atDefaults(story, key));
    const values = stories.map((story) => String(story.axes[key]));
    questions.push({
      question: `axis-${axisSegmentKey(key)}`,
      source: "derived",
      kind: "compare",
      text: `Do the values of \`${key}\` (${values.join(", ")}) read as distinct, and as the spec describes them?`,
      themes: inThemes(stories),
    });
  }

  if (defaultStory !== undefined) {
    const states = new Map<string, Story>();
    for (const story of manifest.stories) {
      if (story.grid !== "states" || !atDefaults(story)) continue;
      const segment = stateSegment(story.state);
      if (!states.has(segment)) states.set(segment, story);
    }
    for (const [segment, story] of states) {
      const { name, part } = story.state;
      const whose = part === undefined ? "the component's" : `the \`${part}\` part's`;
      questions.push({
        question: `state-${segment}`,
        source: "derived",
        kind: "compare",
        text: `Is ${whose} \`${name}\` state visibly different from default, in the way the spec describes?`,
        themes: inThemes([defaultStory, story], [defaultTheme]),
      });
    }
  }

  const appearanceStories = manifest.stories.filter((story) => story.grid === "axes" || story.grid === "include");
  appearanceStatements(input.body).forEach((statement, index) => {
    questions.push({
      question: `appearance-${String(index + 1)}`,
      source: "derived",
      kind: "compare",
      text: `Do these stories meet this statement from the spec: “${statement}”`,
      themes: inThemes(appearanceStories),
    });
  });

  if (defaultStory !== undefined && spec.reference !== undefined) {
    questions.push({
      question: "reference",
      source: "derived",
      kind: "compare",
      text: "Does the component match the reference image's look?",
      themes: [{ theme: defaultTheme, images: [capture(defaultStory), { kind: "reference", label: "reference" }] }],
    });
  }

  const family = (input.family ?? []).slice(0, maxFamilyComponents);
  if (defaultStory !== undefined && family.length > 0) {
    questions.push({
      question: "family",
      source: "derived",
      kind: "compare",
      text: "Does the component look like it belongs with these other components?",
      themes: [
        {
          theme: defaultTheme,
          images: [
            capture(defaultStory),
            ...family.map(({ story }): JudgePlanImage => ({ kind: "component", label: story, story })),
          ],
        },
      ],
    });
  }

  const order = new Map(manifest.stories.map((story, index) => [story.name, index]));
  const changed = [...(input.changed ?? [])]
    .filter(({ story, theme }) => order.has(story) && themes.includes(theme))
    .sort(
      (a, b) =>
        (order.get(a.story) ?? 0) - (order.get(b.story) ?? 0) || themes.indexOf(a.theme) - themes.indexOf(b.theme),
    );
  for (const { story, theme } of changed) {
    questions.push({
      question: `change-${story}`,
      source: "derived",
      kind: "compare",
      text: "Is this change consistent with the spec, and does it look intended?",
      themes: [
        {
          theme,
          images: [
            { kind: "baseline", label: "baseline", story },
            { kind: "capture", label: "capture", story },
            { kind: "diff", label: "diff", story },
          ],
        },
      ],
    });
  }

  for (const question of spec.judge ?? []) {
    const select = question.select;
    const stories =
      select === undefined
        ? manifest.stories.filter((story) => story.grid === "axes")
        : manifest.stories.filter((story) => picks(spec, manifest, story, select));
    questions.push({
      question: question.id,
      source: "spec",
      kind: select !== undefined && stories.length === 1 ? "each" : "compare",
      text: question.question,
      themes: inThemes(stories),
    });
  }

  return questions;
}

/** The component's default story: the axes grid's story with every axis at its default; the `state`, `reference` and `family` questions show it. */
export function defaultStoryOf(spec: Spec, manifest: StoryManifest): Story | undefined {
  const axes = axisDefaults(spec, manifest);
  return manifest.stories.find(
    (story) => story.grid === "axes" && Object.entries(axes).every(([key, value]) => story.axes[key] === value),
  );
}

/** Each axis's default value (docs/spec/story-matrix.md#axes): the prop's `default`, or its first value. */
function axisDefaults(spec: Spec, manifest: StoryManifest): Record<string, boolean | string | number> {
  const defaults: Record<string, boolean | string | number> = {};
  for (const key of spec.matrix?.axes ?? []) {
    const { part, prop } = splitKey(key);
    const definition = propOf(spec, part, prop);
    const fallback = definition?.default;
    if (typeof fallback === "string" || typeof fallback === "boolean") {
      defaults[key] = fallback;
      continue;
    }
    const first =
      definition?.type === "enum" ? definition.values[0] : definition?.type === "boolean" ? false : undefined;
    const seen = manifest.stories.find((story) => Object.hasOwn(story.axes, key))?.axes[key];
    const value = first ?? seen;
    if (value !== undefined) defaults[key] = value;
  }
  return defaults;
}
