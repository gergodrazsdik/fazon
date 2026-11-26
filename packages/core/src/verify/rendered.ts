// SPDX-License-Identifier: GPL-3.0-or-later
// The rendered checks of a verify run over the stories (docs/spec/story-matrix.md,
// docs/spec/check-catalogue.md): every manifest story in every theme, with `a11y`, `tokens` and
// `layout` on each render and `visual` against the baselines directory. Stories are rendered by an
// injected renderer, so the orchestration is tested with recorded snapshots.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ariaObservations, checkAxe, checkSpecA11y, checkSpecAria, type AriaObservation } from "../checks/a11y.js";
import { checkLayout } from "../checks/layout.js";
import type { AxeOutcome, Capture, PageInspection } from "../checks/snapshot.js";
import { checkTokens, tokenRuleExpectations } from "../checks/tokens.js";
import type { CheckFinding, CheckId } from "../checks/types.js";
import {
  baselinePath,
  checkBaselineImage,
  checkOrphans,
  checkVisualStory,
  decodePng,
  listBaselineFiles,
  readBaselinesRecord,
  type VisualStatus,
} from "../checks/visual.js";
import type { Story } from "../matrix/types.js";
import type { TokenIndex } from "../tokens/build.js";
import { storyProps, type VerifyComponent } from "./components.js";
import type { CheckResult } from "./run-record.js";

/** What the renderer reads from one story in one theme, after its input steps. */
export interface RenderedStory {
  /** The component's elements, with styles and accessibility. */
  readonly inspection: PageInspection;
  readonly axe: AxeOutcome;
  readonly capture: Capture;
}

/** Renders stories under the rendering conditions; a story that can't be rendered rejects. */
export interface StoryRenderer {
  render(component: VerifyComponent, story: Story, theme: string): Promise<RenderedStory>;
}

/** A story-theme pair's visual result. */
export interface StoryVisual {
  readonly component: string;
  readonly story: string;
  readonly theme: string;
  /** Its baseline's path in the baselines directory, which is also its capture's path under `captures/`. */
  readonly path: string;
  /** Undefined when nothing was compared: the image differs from the one the baselines record. */
  readonly status?: VisualStatus;
  /** The diff image, relative to the run's directory. */
  readonly diff?: string;
  /** For a new story: the orphan with identical pixels it renames. */
  readonly renamedFrom?: string;
}

/** A file in the baselines directory that belongs to no story. */
export interface Orphan {
  readonly path: string;
  /** The new story's baseline path it was renamed to, when the pixels are identical. */
  readonly renamedTo?: string;
}

export interface RenderedChecksInput {
  /** The components the run covers; those without a manifest are reported and skipped. */
  readonly components: readonly VerifyComponent[];
  /** Every component with a spec, for orphans: a baseline of any of them isn't an orphan. */
  readonly allComponents: readonly VerifyComponent[];
  /** Whether the run names its components: orphans are then reported for those components only. */
  readonly named: boolean;
  readonly renderer: StoryRenderer;
  readonly index: TokenIndex;
  /** The baselines directory, absolute. */
  readonly baselinesDir: string;
  /** The verifier image running the checks, by digest. */
  readonly image: string;
  /** The run's directory, absolute; captures go to `captures/` in it. */
  readonly runDir: string;
  /** The story IDs in the Storybook build's index, by component title, for MATRIX-003. */
  readonly storybookIndex?: ReadonlyMap<string, readonly string[]>;
  readonly now?: () => number;
  /** Called after each story-theme pair, for progress. */
  readonly progress?: (done: number, total: number) => void;
}

export interface RenderedChecksResult {
  /** `a11y`, `tokens`, `layout` and `visual`. */
  readonly checks: CheckResult[];
  readonly stories: StoryVisual[];
  readonly orphans: Orphan[];
  /** axe's undecided results, which never block. */
  readonly incomplete: CheckFinding[];
}

/** The directory of captures and diffs in a run's directory. */
export const capturesDirectory = "captures";

/** The rendered checks, ended as skipped: the Storybook build they render from failed. */
export function skippedRenderedChecks(message: string): CheckResult[] {
  return (["a11y", "tokens", "layout", "visual"] as const).map((check) => ({
    check,
    status: "skipped",
    durationSeconds: 0,
    message,
    findings: [],
  }));
}

/** MATRIX-003: every story ID is in the Storybook index, and the index has no other story of the component. */
export function storybookIndexProblems(
  component: VerifyComponent,
  index: ReadonlyMap<string, readonly string[]> | undefined,
): string[] {
  if (index === undefined || component.manifest === undefined) return [];
  const built = new Set(index.get(component.spec.name) ?? []);
  const expected = new Set(component.manifest.stories.map((s) => s.storybookId));
  const problems: string[] = [];
  for (const id of expected) if (!built.has(id)) problems.push(`the Storybook build has no story ${id}`);
  for (const id of built)
    if (!expected.has(id)) problems.push(`the Storybook build has a story ${id} the manifest doesn't list`);
  return problems.map((p) => `MATRIX-003 ${component.spec.name}: ${p}`);
}

function samePixels(a: Uint8Array, b: Uint8Array): boolean {
  const x = decodePng(a);
  const y = decodePng(b);
  if (x.width !== y.width || x.height !== y.height) return false;
  return Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) === 0;
}

/** Renders every story of the components in every theme and runs the rendered checks on them. */
export async function runRenderedChecks(input: RenderedChecksInput): Promise<RenderedChecksResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const findings: Record<"a11y" | "tokens" | "layout", CheckFinding[]> = { a11y: [], tokens: [], layout: [] };
  const incomplete: CheckFinding[] = [];
  const errors: string[] = [];
  const captures: { component: VerifyComponent; story: Story; theme: string; png: Uint8Array; path: string }[] = [];

  const renderable = input.components.filter((component) => {
    if (component.manifest === undefined) {
      if (component.generated) errors.push(`${component.spec.name} has no valid story manifest; run \`fazon sync\`.`);
      return false;
    }
    const problems = storybookIndexProblems(component, input.storybookIndex);
    errors.push(...problems);
    return problems.length === 0 && component.generated;
  });
  const total = renderable.reduce(
    (n, c) => n + (c.manifest?.stories.length ?? 0) * (c.manifest?.themes.length ?? 0),
    0,
  );
  let done = 0;

  for (const component of renderable) {
    const manifest = component.manifest;
    if (manifest === undefined) continue;
    const observations: AriaObservation[] = [];
    for (const story of manifest.stories) {
      const props = storyProps(component.spec, manifest, story);
      for (const theme of manifest.themes) {
        const context = { story: story.name, theme };
        let rendered: RenderedStory;
        try {
          rendered = await input.renderer.render(component, story, theme);
        } catch (error) {
          errors.push(`${story.name} (${theme}): ${error instanceof Error ? error.message : String(error)}`);
          continue;
        } finally {
          input.progress?.(++done, total);
        }
        const { elements } = rendered.inspection;
        const axe = checkAxe(rendered.axe, context);
        findings.a11y.push(...axe.findings, ...checkSpecA11y({ spec: component.spec, elements, props, context }));
        incomplete.push(...axe.incomplete);
        observations.push(...ariaObservations(elements));
        findings.tokens.push(
          ...checkTokens({
            elements,
            index: input.index,
            theme,
            expected: tokenRuleExpectations(component.spec.tokens ?? [], { component: component.spec.name, props }),
            context,
          }),
        );
        findings.layout.push(...checkLayout(rendered.inspection, context));
        captures.push({
          component,
          story,
          theme,
          png: rendered.capture.png,
          path: baselinePath(theme, component.name, story.name),
        });
      }
    }
    findings.a11y.push(...checkSpecAria(component.spec, observations).map((f) => ({ ...f, file: component.specFile })));
  }

  // visual
  const visual = await compareCaptures(input, captures);
  const duration = Math.round((now() - started) / 100) / 10;
  const errorMessage =
    errors.length === 0
      ? undefined
      : `${String(errors.length)} ${errors.length === 1 ? "problem" : "problems"} stopped stories from rendering: ${errors.slice(0, 10).join("; ")}${errors.length > 10 ? "; …" : ""}`;
  const check = (id: CheckId, list: CheckFinding[]): CheckResult => ({
    check: id,
    status: errorMessage !== undefined ? "error" : list.some((f) => f.blocking) ? "fail" : "pass",
    durationSeconds: duration,
    ...(errorMessage === undefined ? {} : { message: errorMessage }),
    findings: list,
  });
  return {
    checks: [
      check("a11y", findings.a11y),
      check("tokens", findings.tokens),
      check("layout", findings.layout),
      check("visual", visual.findings),
    ],
    stories: visual.stories,
    orphans: visual.orphans,
    incomplete,
  };
}

async function compareCaptures(
  input: RenderedChecksInput,
  captures: readonly { component: VerifyComponent; story: Story; theme: string; png: Uint8Array; path: string }[],
): Promise<{ findings: CheckFinding[]; stories: StoryVisual[]; orphans: Orphan[] }> {
  const capturesDir = path.join(input.runDir, capturesDirectory);
  for (const capture of captures) {
    const file = path.join(capturesDir, capture.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, capture.png);
  }

  const files = await listBaselineFiles(input.baselinesDir);
  const hasBaselines = files.some((f) => f.endsWith(".png"));
  const imageFindings = checkBaselineImage(await readBaselinesRecord(input.baselinesDir), input.image, hasBaselines);
  if (imageFindings.length > 0) {
    return {
      findings: imageFindings,
      stories: captures.map((c) => ({
        component: c.component.name,
        story: c.story.name,
        theme: c.theme,
        path: c.path,
      })),
      orphans: [],
    };
  }

  const present = new Set(files);
  const findings: CheckFinding[] = [];
  const stories: StoryVisual[] = [];
  for (const capture of captures) {
    const baseline = present.has(capture.path)
      ? new Uint8Array(await readFile(path.join(input.baselinesDir, capture.path)))
      : undefined;
    const diff = `${capturesDirectory}/${capture.path.replace(/\.png$/, ".diff.png")}`;
    const result = checkVisualStory({
      capture: capture.png,
      ...(baseline === undefined ? {} : { baseline }),
      evidence: diff,
      context: { story: capture.story.name, theme: capture.theme },
    });
    const image = result.status === "changed" ? result.comparison?.diff : undefined;
    const written = image !== undefined;
    if (image !== undefined) await writeFile(path.join(input.runDir, diff), image);
    if (result.finding !== undefined) findings.push(result.finding);
    stories.push({
      component: capture.component.name,
      story: capture.story.name,
      theme: capture.theme,
      path: capture.path,
      status: result.status,
      ...(written ? { diff } : {}),
    });
  }

  // Orphans: against every component's stories; with named components, only theirs are reported.
  const expected = input.allComponents.flatMap((component) =>
    (component.manifest?.stories ?? []).flatMap((story) =>
      (component.manifest?.themes ?? []).map((theme) => baselinePath(theme, component.name, story.name)),
    ),
  );
  const covered = new Set(input.components.map((c) => c.name));
  let orphanFindings = checkOrphans(files, expected);
  if (input.named) orphanFindings = orphanFindings.filter((f) => covered.has(f.file?.split("/")[1] ?? ""));

  // Renamed: an orphan and a new story of the same component and theme with identical pixels.
  const orphans: Orphan[] = [];
  const paired = new Set<number>();
  for (const finding of orphanFindings) {
    const file = finding.file ?? "";
    const [theme, component] = file.split("/");
    let renamedTo: string | undefined;
    if (file.endsWith(".png")) {
      const bytes = new Uint8Array(await readFile(path.join(input.baselinesDir, file)));
      const index = stories.findIndex(
        (s, i) =>
          !paired.has(i) &&
          s.status === "new" &&
          s.theme === theme &&
          s.component === component &&
          samePixels(bytes, captures[i]?.png ?? new Uint8Array()),
      );
      if (index !== -1) {
        paired.add(index);
        const story = stories[index];
        if (story !== undefined) {
          renamedTo = story.path;
          stories[index] = { ...story, renamedFrom: file };
        }
      }
    }
    orphans.push({ path: file, ...(renamedTo === undefined ? {} : { renamedTo }) });
    findings.push(
      renamedTo === undefined
        ? finding
        : { ...finding, message: `${finding.message} Renamed: its pixels equal the new ${renamedTo}.` },
    );
  }
  return { findings, stories, orphans };
}
