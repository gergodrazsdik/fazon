// SPDX-License-Identifier: GPL-3.0-or-later
// A case's affected stories (docs/spec/measurement.md#seeded-defects): the story-theme pairs whose
// capture differs, in any pixel, from the unmodified component's. A case that changes no capture
// isn't a case.
import { decodePng } from "../checks/visual.js";

/** Whether two PNG captures differ in size or in any pixel. */
export function capturesDiffer(a: Uint8Array, b: Uint8Array): boolean {
  const x = decodePng(a);
  const y = decodePng(b);
  return x.width !== y.width || x.height !== y.height || Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) !== 0;
}

/** One story's capture in one theme. */
export interface StoryCapture {
  readonly story: string;
  readonly theme: string;
  readonly png: Uint8Array;
}

/**
 * The stories a case affects, each with the themes in which its capture differs from the
 * unmodified one, in the order of the case's captures. A pair the unmodified run didn't capture
 * counts as affected.
 */
export function affectedStories(
  unmodified: readonly StoryCapture[],
  mutated: readonly StoryCapture[],
): { story: string; themes: string[] }[] {
  const before = new Map(unmodified.map((capture) => [`${capture.story} ${capture.theme}`, capture.png]));
  const affected = new Map<string, string[]>();
  for (const capture of mutated) {
    const original = before.get(`${capture.story} ${capture.theme}`);
    if (original !== undefined && !capturesDiffer(original, capture.png)) continue;
    affected.set(capture.story, [...(affected.get(capture.story) ?? []), capture.theme]);
  }
  return [...affected].map(([story, themes]) => ({ story, themes }));
}
