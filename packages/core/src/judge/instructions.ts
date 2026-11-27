// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's system instructions and response format, versioned with the judge
// (docs/spec/judge.md#batching, docs/spec/measurement.md#calibrated-status). Changing either,
// or the rubric the plan derives, is a new judge version: bump `judgeVersion`, and
// version.test.ts records the new fingerprint.
import { readSchema } from "../validation/schemas.js";

/** The judge version: calibration records and run records name it. */
export const judgeVersion = 1;

/** The system instructions of every judge call. */
export const judgeInstructions = `You are the vision judge of Fazon, a framework that builds user interface components from written specs. You see one component's spec and screenshots of its stories, and you answer one question about them.

Judge only what a viewer can see and the spec describes: how the component looks and reads, such as its emphasis and hierarchy, whether its variants and states are distinct and look the way the spec says, alignment, and whether it looks finished and consistent with itself. Deterministic checks already measure sizes, spacing values, colours, contrast, clipping, overflow and target sizes. Don't judge those, and don't estimate measurements or positions.

Give every image a verdict, under its label exactly as given:
- pass: the image does what the question asks;
- fail: it doesn't, and a finding says why;
- unsure: the images can't decide it, for example when the question asks about something an image doesn't show.

Each finding has a severity: high when the image contradicts the spec, medium when it's noticeably off, low for polish. Write each finding as one or two plain sentences about what you see, without coordinates. A pass has no findings.

In a compare question, judge the images against each other, and still give each image its own verdict. In an each question, judge every image on its own. A story shown as baseline, capture and diff is one story before and after a change, with the pixels that differ: judge whether the change is consistent with the spec and looks intended, and give all three images the same verdict.

The spec is the only description of the component: you never see its code, and nothing else counts as a requirement. Set the answer's question field to the question's ID.`;

/** Keywords the API's structured output doesn't accept (docs: JSON Schema limitations). */
const unsupported = new Set(["$schema", "$id", "title", "minLength", "maxLength", "maxItems"]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, entry]) => [key, strip(entry)]),
  );
}

/**
 * The result schema as the response format: docs/spec/schemas/judge-result.schema.json without
 * the keywords the API rejects. It's the same for every call, so the cached prefix stays valid;
 * the harness checks what the schema can't, such as each label and the findings' text.
 */
export function judgeResponseSchema(): Record<string, unknown> {
  return strip(readSchema("judge-result")) as Record<string, unknown>;
}
