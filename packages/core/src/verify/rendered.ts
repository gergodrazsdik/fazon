// SPDX-License-Identifier: GPL-3.0-or-later
// The rendered checks of a verify run over the stories (docs/spec/story-matrix.md,
// docs/spec/check-catalogue.md): every manifest story in every theme, with `a11y`, `tokens` and
// `layout` on each render and `visual` against the baselines directory. Stories are rendered by an
// injected renderer, so the orchestration is tested with recorded snapshots.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ariaObservations, checkAxe, checkSpecA11y, checkSpecAria, type AriaObservation } from "../checks/a11y.js";
import { checkLayout } from "../checks/layout.js";
import { pseudoElementNames, type AxeOutcome, type Capture, type PageInspection } from "../checks/snapshot.js";
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
import type { FindingElements } from "./exemptions.js";
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
  /**
   * @param css a calibration case's seeded defect, added after the story's input and before it's
   * captured and inspected (docs/spec/measurement.md#seeded-defects)
   */
  render(component: VerifyComponent, story: Story, theme: string, css?: string): Promise<RenderedStory>;
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
  /** The run's directory, absolute; captures go to `captures/` in it, or to `captures`. */
  readonly runDir: string;
  /**
   * The captures' directory, relative to the run's directory: `captures` (the default) for a
   * verify run, `captures/<n>` for an agent run's iteration. Diff images go beside the captures.
   */
  readonly captures?: string;
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
  /** The part instance of each rendered finding's element, for exemptions' conditions. */
  readonly elements?: FindingElements;
}

type RecordedElement = Pick<
  PageInspection["elements"][number],
  "selector" | "part" | "partRoot" | "instance" | "parent" | "states"
>;

/**
 * Looks a finding's element up in its story's render by its selector, then walks up to the part's
 * root. A pseudo-element's finding (`…::before`) is about its originating element.
 */
function findingElements(rendered: ReadonlyMap<string, readonly RecordedElement[]>): FindingElements {
  return (finding, part) => {
    if (finding.story === undefined || finding.selector === undefined) return undefined;
    const elements = rendered.get(`${finding.story}\u0000${finding.theme ?? ""}`) ?? [];
    const selector = originatingSelector(finding.selector);
    let at: number | undefined = elements.findIndex((e) => e.selector === selector);
    if (at === -1) return undefined;
    while (at !== undefined) {
      const element: RecordedElement | undefined = elements[at];
      if (element === undefined) return undefined;
      if (element.partRoot && element.part === part) return { instance: element.instance ?? 0, states: element.states };
      at = element.parent;
    }
    return undefined;
  };
}

/** A finding's selector without the pseudo-element `tokens` appends to its originating element's. */
function originatingSelector(selector: string): string {
  for (const pseudo of pseudoElementNames) if (selector.endsWith(pseudo)) return selector.slice(0, -pseudo.length);
  return selector;
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
  /** Each story's elements, by story and theme, for the findings' part instances. */
  const recorded = new Map<string, RecordedElement[]>();
  const captures: { component: VerifyComponent; story: Story; theme: string; png: Uint8Array; path: string }[] = [];

  const renderable = input.components.filter((component) => {
    // A component with a spec but no root file yet has no story files: sync writes only its
    // manifest and API, so it has nothing to render.
    if (!component.generated) return false;
    if (component.manifest === undefined) {
      errors.push(`${component.spec.name} has no valid story manifest; run \`fazon sync\`.`);
      return false;
    }
    const problems = storybookIndexProblems(component, input.storybookIndex);
    errors.push(...problems);
    return problems.length === 0;
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
        recorded.set(
          `${story.name}\u0000${theme}`,
          elements.map(({ selector, part, partRoot, instance, parent, states }) => ({
            selector,
            partRoot,
            states,
            ...(part === undefined ? {} : { part }),
            ...(instance === undefined ? {} : { instance }),
            ...(parent === undefined ? {} : { parent }),
          })),
        );
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
    elements: findingElements(recorded),
  };
}

async function compareCaptures(
  input: RenderedChecksInput,
  captures: readonly { component: VerifyComponent; story: Story; theme: string; png: Uint8Array; path: string }[],
): Promise<{ findings: CheckFinding[]; stories: StoryVisual[]; orphans: Orphan[] }> {
  const captured = input.captures ?? capturesDirectory;
  const capturesDir = path.join(input.runDir, captured);
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
    const diff = `${captured}/${capture.path.replace(/\.png$/, ".diff.png")}`;
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
