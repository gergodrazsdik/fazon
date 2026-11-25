// SPDX-License-Identifier: GPL-3.0-or-later
// The MATRIX rules (docs/spec/story-matrix.md#validation). The harness checks MATRIX-001 and
// MATRIX-002 when it writes a manifest. MATRIX-003 to MATRIX-005 need the Storybook build's story
// index or a rendered story, so the verifier checks them, with rules of the same shape over its
// own input.
import type { Finding } from "../findings.js";
import { validateWithSchema } from "../validation/validate.js";
import type { StoryManifest } from "./types.js";

/** Who checks a MATRIX rule: the harness from the manifest, or the verifier from a build and a render. */
export type MatrixRuleStage = "harness" | "verifier";

/** Every MATRIX rule and the stage that checks it. */
export const matrixRuleStages = Object.freeze({
  "MATRIX-001": "harness",
  "MATRIX-002": "harness",
  "MATRIX-003": "verifier",
  "MATRIX-004": "verifier",
  "MATRIX-005": "verifier",
} as const satisfies Record<string, MatrixRuleStage>);

export type MatrixRuleId = keyof typeof matrixRuleStages;

/** One MATRIX rule over the input its stage has. */
export interface MatrixRule<Input> {
  readonly id: MatrixRuleId;
  readonly check: (input: Input) => readonly Finding[];
}

/** What the harness has when it writes a manifest. */
export interface ManifestCheckInput {
  readonly manifest: StoryManifest;
  /** The manifest's path, relative to the repository root, with `/` separators; findings name it. */
  readonly file: string;
}

const matrix001: MatrixRule<ManifestCheckInput> = {
  id: "MATRIX-001",
  check: ({ manifest, file }) =>
    validateWithSchema("story-manifest", manifest).map((finding) => ({
      rule: "MATRIX-001",
      file,
      path: finding.path,
      message: finding.message,
    })),
};

const matrix002: MatrixRule<ManifestCheckInput> = {
  id: "MATRIX-002",
  check: ({ manifest, file }) => {
    const findings: Finding[] = [];
    for (const field of ["name", "storybookId"] as const) {
      const first = new Map<string, number>();
      manifest.stories.forEach((story, index) => {
        const value = story[field];
        const earlier = first.get(value);
        if (earlier === undefined) {
          first.set(value, index);
          return;
        }
        findings.push({
          rule: "MATRIX-002",
          file,
          path: `$.stories[${String(index)}].${field}`,
          message: `stories ${String(earlier)} and ${String(index)} share the ${field} '${value}'`,
          hint:
            field === "name"
              ? "Remove the matrix.include entry that repeats a story."
              : "Rename a fixture, value or state in the spec so that the names differ by more than hyphens and capitals.",
        });
      });
    }
    return findings;
  },
};

/** The MATRIX rules the harness checks on a manifest it writes, in order. */
export const manifestRules: readonly MatrixRule<ManifestCheckInput>[] = [matrix001, matrix002];

/** The harness's findings for one manifest; any finding fails the run. */
export function checkManifest(manifest: StoryManifest, file: string): readonly Finding[] {
  return manifestRules.flatMap((rule) => rule.check({ manifest, file }));
}
