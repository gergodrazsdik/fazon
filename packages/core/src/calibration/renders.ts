// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's renders, in the verifier image (docs/spec/measurement.md#judge-calibration):
// every story of each calibration component unmodified, then each mutation case on the stories it
// gives CSS for. The unmodified renders give the facts the cases are made from; a story a case
// changes in any pixel is affected, and its capture is kept for the judge; one a check catches
// though no pixel changes is flagged (ADR 0028). For each case, the
// deterministic checks' verdict: without baselines (a11y, tokens, layout) and with them (visual
// against the committed baseline as well).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkAxe, checkSpecA11y } from "../checks/a11y.js";
import { checkLayout } from "../checks/layout.js";
import { checkTokens, tokenRuleExpectations } from "../checks/tokens.js";
import type { CheckFinding } from "../checks/types.js";
import { baselinePath } from "../checks/visual.js";
import type { Story } from "../matrix/types.js";
import type { TokenIndex } from "../tokens/build.js";
import { storyProps, type VerifyComponent } from "../verify/components.js";
import type { RenderedStory, StoryRenderer } from "../verify/rendered.js";
import { capturesDiffer } from "../mutation/affected.js";
import { storyFacts, type StoryFacts } from "../mutation/facts.js";
import { mutationCases, type MutationCase } from "../mutation/operators.js";

/** The file the renders write in the round's directory. */
export const rendersFile = "renders.json";

/** One case, rendered. */
export interface RenderedCase {
  /** The case's ID: `<operator>` or `<operator>--<what>`. */
  readonly id: string;
  readonly operator: MutationCase["operator"];
  readonly class: MutationCase["class"];
  readonly description: string;
  /** The stories whose capture differs from the unmodified one, with the themes it differs in. */
  readonly affected: readonly { readonly story: string; readonly themes: readonly string[] }[];
  /**
   * The stories a check catches it on though their capture doesn't change, such as raw-color's:
   * the judge sees the unmodified pixels there, so its verdicts are the unmodified component's.
   */
  readonly flagged: readonly { readonly story: string; readonly themes: readonly string[] }[];
  /** Whether a deterministic check fails it. */
  readonly checks: {
    /** a11y, tokens or layout has a blocking finding on an affected story. */
    readonly withoutBaselines: boolean;
    /** That, or an affected capture differs from its committed baseline. */
    readonly withBaselines: boolean;
    /** The rules of the blocking findings, `<check>/<rule>`, sorted. */
    readonly rules: readonly string[];
  };
}

export interface RenderedComponent {
  readonly name: string;
  /** Rules of blocking findings on the unmodified component: it must have none to be calibrated. */
  readonly unmodifiedFindings: readonly string[];
  /** The cases that changed at least one capture, in the operators' order. */
  readonly cases: readonly RenderedCase[];
  /** The cases that changed no capture and that no check caught, by ID: they aren't cases. */
  readonly unchanged: readonly string[];
}

/** `renders.json`: what the host's judge and measures read. */
export interface CalibrationRenders {
  readonly fazon: 0;
  readonly components: readonly RenderedComponent[];
}

export interface CalibrationRendersInput {
  readonly components: readonly VerifyComponent[];
  readonly renderer: StoryRenderer;
  readonly index: TokenIndex;
  /** The committed baselines, absolute. */
  readonly baselinesDir: string;
  /** The round's directory, absolute: `unmodified/`, `cases/<component>/<case>/` and `renders.json` go in it. */
  readonly outDir: string;
  readonly progress?: (text: string) => void;
}

/** Where a capture goes: `unmodified/<baseline path>` or `cases/<component>/<case>/<baseline path>`. */
export function capturePath(component: string, story: string, theme: string, caseId?: string): string {
  const file = baselinePath(theme, component, story);
  return caseId === undefined ? path.join("unmodified", file) : path.join("cases", component, caseId, file);
}

/** The rules of a render's blocking findings in a11y, tokens and layout. */
function blockingRules(
  component: VerifyComponent,
  story: Story,
  theme: string,
  rendered: RenderedStory,
  index: TokenIndex,
): string[] {
  const manifest = component.manifest;
  if (manifest === undefined) return [];
  const props = storyProps(component.spec, manifest, story);
  const context = { story: story.name, theme };
  const { elements } = rendered.inspection;
  const findings: CheckFinding[] = [
    ...checkAxe(rendered.axe, context).findings,
    ...checkSpecA11y({ spec: component.spec, elements, props, context }),
    ...checkTokens({
      elements,
      index,
      theme,
      expected: tokenRuleExpectations(component.spec.tokens ?? [], { component: component.spec.name, props }),
      context,
    }),
    ...checkLayout(rendered.inspection, context),
  ];
  return findings.filter((finding) => finding.blocking).map((finding) => `${finding.check}/${finding.rule}`);
}

async function write(file: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

/** Renders a round's components and cases, writes their captures and `renders.json`, and returns it. */
export async function calibrationRenders(input: CalibrationRendersInput): Promise<CalibrationRenders> {
  const results: RenderedComponent[] = [];
  for (const component of input.components) {
    const manifest = component.manifest;
    if (manifest === undefined) continue;
    const facts = new Map<string, StoryFacts>();
    const captures = new Map<string, Uint8Array>();
    const unmodifiedFindings = new Set<string>();
    /** Each story's own blocking rules unmodified: a case counts only the rules it adds. */
    const unmodifiedRules = new Map<string, ReadonlySet<string>>();
    const added = (story: Story, theme: string, result: RenderedStory): string[] => {
      const before = unmodifiedRules.get(`${story.name} ${theme}`) ?? new Set<string>();
      return blockingRules(component, story, theme, result, input.index).filter((rule) => !before.has(rule));
    };
    input.progress?.(`${component.name}: the unmodified stories\n`);
    for (const story of manifest.stories) {
      for (const theme of manifest.themes) {
        const rendered = await input.renderer.render(component, story, theme);
        const key = `${story.name} ${theme}`;
        facts.set(key, storyFacts(rendered.inspection));
        captures.set(key, rendered.capture.png);
        await write(path.join(input.outDir, capturePath(component.name, story.name, theme)), rendered.capture.png);
        const own = blockingRules(component, story, theme, rendered, input.index);
        unmodifiedRules.set(key, new Set(own));
        for (const rule of own) unmodifiedFindings.add(rule);
      }
    }
    const cases = mutationCases({
      spec: component.spec,
      manifest,
      index: input.index,
      facts: (story, theme) => facts.get(`${story} ${theme}`),
    });
    const rendered: RenderedCase[] = [];
    const unchanged: string[] = [];
    for (const entry of cases) {
      input.progress?.(`${component.name}: ${entry.id}\n`);
      const affected = new Map<string, string[]>();
      const flagged = new Map<string, string[]>();
      const rules = new Set<string>();
      let differsFromBaseline = false;
      for (const story of manifest.stories) {
        for (const theme of manifest.themes) {
          const css = entry.css(story, theme);
          if (css === undefined) continue;
          const result = await input.renderer.render(component, story, theme, css);
          const original = captures.get(`${story.name} ${theme}`);
          if (original !== undefined && !capturesDiffer(original, result.capture.png)) {
            // No pixel changed, but a check may still catch it, as it does raw-color (ADR 0028).
            const caught = added(story, theme, result);
            if (caught.length === 0) continue;
            flagged.set(story.name, [...(flagged.get(story.name) ?? []), theme]);
            for (const rule of caught) rules.add(rule);
            continue;
          }
          affected.set(story.name, [...(affected.get(story.name) ?? []), theme]);
          await write(
            path.join(input.outDir, capturePath(component.name, story.name, theme, entry.id)),
            result.capture.png,
          );
          for (const rule of added(story, theme, result)) rules.add(rule);
          const baseline = await readFile(
            path.join(input.baselinesDir, baselinePath(theme, component.name, story.name)),
          ).catch(() => undefined);
          if (baseline === undefined || capturesDiffer(new Uint8Array(baseline), result.capture.png))
            differsFromBaseline = true;
        }
      }
      if (affected.size === 0 && flagged.size === 0) {
        unchanged.push(entry.id);
        continue;
      }
      rendered.push({
        id: entry.id,
        operator: entry.operator,
        class: entry.class,
        description: entry.description,
        affected: [...affected].map(([story, themes]) => ({ story, themes })),
        flagged: [...flagged].map(([story, themes]) => ({ story, themes })),
        checks: {
          withoutBaselines: rules.size > 0,
          withBaselines: rules.size > 0 || differsFromBaseline,
          rules: [...rules].sort(),
        },
      });
    }
    results.push({
      name: component.name,
      unmodifiedFindings: [...unmodifiedFindings].sort(),
      cases: rendered,
      unchanged,
    });
  }
  const renders: CalibrationRenders = { fazon: 0, components: results };
  await writeFile(path.join(input.outDir, rendersFile), `${JSON.stringify(renders, null, 2)}\n`);
  return renders;
}
