// SPDX-License-Identifier: GPL-3.0-or-later

/** The checks of the check catalogue (docs/spec/check-catalogue.md#the-checks). */
export type CheckId = "build" | "lint" | "test" | "package" | "a11y" | "tokens" | "layout" | "visual";

/** The checks that run on rendered stories, in the verifier image. */
export type RenderedCheckId = "a11y" | "tokens" | "layout" | "visual";

/**
 * A check's finding (docs/spec/check-catalogue.md#findings), in the shape the run record stores
 * (`$defs.finding` in docs/spec/schemas/run-record.schema.json). The rendered checks fill the
 * location with `story`, `theme`, `part` and `selector`.
 */
export interface CheckFinding {
  readonly check: CheckId;
  /** The rule's ID from the check's rule sheet, or an axe rule ID for `a11y`. */
  readonly rule: string;
  /** What is wrong, in plain words. */
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly story?: string;
  readonly theme?: string;
  /** The part the element is in: its nearest ancestor-or-self with `data-part`. */
  readonly part?: string;
  /** A CSS selector for the element. */
  readonly selector?: string;
  readonly expected?: string;
  readonly actual?: string;
  /** A file that shows it, such as a diff image. */
  readonly evidence?: string;
  /** The index of the spec exemption that waives it. */
  readonly exempt?: number;
  /** False when an exemption waives it, or when it is advisory in this run. */
  readonly blocking: boolean;
}

/** Where a rendered check's findings are: stamped on every finding it returns. */
export interface CheckContext {
  /** The story's name (docs/spec/story-matrix.md#names). */
  readonly story?: string;
  /** The theme the story was rendered in. */
  readonly theme?: string;
}

/** A rectangle in CSS pixels, relative to the viewport. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Thrown when a rendered check can't run: the check ends as `error`, not `fail`. */
export class CheckError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CheckError";
  }
}

/** The context's location fields, for spreading into a finding. */
export function locate(context: CheckContext): Pick<CheckFinding, "story" | "theme"> {
  return {
    ...(context.story === undefined ? {} : { story: context.story }),
    ...(context.theme === undefined ? {} : { theme: context.theme }),
  };
}
