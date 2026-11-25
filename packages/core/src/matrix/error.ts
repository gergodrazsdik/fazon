// SPDX-License-Identifier: GPL-3.0-or-later
import type { Finding } from "../findings.js";
import type { SpecFile } from "../spec/load.js";
import { jsonPath, type PathSegment } from "../validation/validate.js";

/**
 * A spec the story matrix rules can't expand: it breaks a SPEC rule that `buildManifest` needs to
 * hold, such as a state that can't be produced (SPEC-015) or a forced story a grid already makes
 * (SPEC-017). `fazon spec check` reports these rules on their own; the error stops a manifest
 * from being written for a spec that skipped the check.
 */
export class MatrixError extends Error {
  /** The rule the spec breaks, such as `SPEC-015`. */
  readonly rule: string;
  /** Where in the front matter, as keys and indices. */
  readonly segments: readonly PathSegment[];

  constructor(rule: string, segments: readonly PathSegment[], message: string) {
    super(message);
    this.name = "MatrixError";
    this.rule = rule;
    this.segments = segments;
  }

  /** The JSON path in the front matter, such as `$.matrix.include[0]`. */
  get path(): string {
    return jsonPath(this.segments);
  }

  /** The error as a finding in the spec file, with its line when the file can tell it. */
  toFinding(file: Pick<SpecFile, "file" | "lineOf">): Finding {
    const line = file.lineOf(this.segments);
    return {
      rule: this.rule,
      file: file.file,
      path: this.path,
      ...(line === undefined ? {} : { line }),
      message: this.message,
    };
  }
}
