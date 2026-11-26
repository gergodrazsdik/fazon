// SPDX-License-Identifier: GPL-3.0-or-later
// The `visual` check (docs/spec/check-catalogue.md#visual) and the baselines directory it reads
// (docs/spec/baseline-lifecycle.md): the pixel comparison, baseline paths, orphans, and the
// verifier image recorded in `fazon.json`.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { validateWithSchema } from "../validation/validate.js";
import { locate, type CheckContext, type CheckFinding } from "./types.js";

/** The `visual` check's rules. */
export type VisualRule = "changed" | "orphan" | "image";

/**
 * The tolerance: two pixels differ when their colour distance exceeds 0.1 (pixelmatch's threshold),
 * anti-aliased pixels count, and no differing pixel is allowed.
 */
export const visualTolerance = { threshold: 0.1, includeAA: true, maxDifferentPixels: 0 } as const;

/** The file in the baselines directory that records the verifier image. */
export const baselinesRecordFile = "fazon.json";
/** The icon set's notice, which `fazon baseline update` writes next to the baselines. */
export const baselinesNoticeFile = "NOTICE.md";

/** `fazon.json` (docs/spec/schemas/baselines.schema.json). */
export interface BaselinesRecord {
  readonly fazon: 0;
  /** The verifier image, by digest: `<registry>/<repository>@sha256:<hex>`. */
  readonly image: string;
}

/** Decoded RGBA pixels. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Decodes a PNG file to RGBA pixels. */
export function decodePng(png: Uint8Array): Pixels {
  const image = PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}

/** Encodes RGBA pixels as a PNG file. */
export function encodePng(pixels: Pixels): Uint8Array {
  const image = new PNG({ width: pixels.width, height: pixels.height });
  Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength).copy(image.data);
  return new Uint8Array(PNG.sync.write(image));
}

export interface PngComparison {
  /** Same size, and no pixel differs beyond the tolerance. */
  readonly equal: boolean;
  readonly baselineSize: { readonly width: number; readonly height: number };
  readonly captureSize: { readonly width: number; readonly height: number };
  /** Pixels that differ; undefined when the sizes differ. */
  readonly differentPixels?: number;
  /** pixelmatch's diff image, as PNG; for two sizes, on a canvas of the larger one. */
  readonly diff?: Uint8Array;
}

/** Compares a capture with its baseline at the visual check's tolerance, by decoded pixels. */
export function comparePng(baseline: Uint8Array, capture: Uint8Array): PngComparison {
  const a = decodePng(baseline);
  const b = decodePng(capture);
  const baselineSize = { width: a.width, height: a.height };
  const captureSize = { width: b.width, height: b.height };
  if (a.width !== b.width || a.height !== b.height) {
    // The diff image of two sizes: both on a canvas of the larger size, the rest transparent.
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const output = new Uint8Array(width * height * 4);
    pixelmatch(pad(a, width, height), pad(b, width, height), output, width, height, {
      threshold: visualTolerance.threshold,
      includeAA: visualTolerance.includeAA,
    });
    return { equal: false, baselineSize, captureSize, diff: encodePng({ width, height, data: output }) };
  }
  const output = new Uint8Array(a.width * a.height * 4);
  const differentPixels = pixelmatch(a.data, b.data, output, a.width, a.height, {
    threshold: visualTolerance.threshold,
    includeAA: visualTolerance.includeAA,
  });
  return {
    equal: differentPixels <= visualTolerance.maxDifferentPixels,
    baselineSize,
    captureSize,
    differentPixels,
    diff: encodePng({ width: a.width, height: a.height, data: output }),
  };
}

/** Pixels on a larger transparent canvas, at its top-left corner. */
function pad(pixels: Pixels, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < pixels.height; row++) {
    data.set(pixels.data.subarray(row * pixels.width * 4, (row + 1) * pixels.width * 4), row * width * 4);
  }
  return data;
}

/** A story's result against its baseline. */
export type VisualStatus = "new" | "unchanged" | "changed";

export interface VisualStoryInput {
  readonly capture: Uint8Array;
  /** The baseline's bytes; undefined when the story has none. */
  readonly baseline?: Uint8Array;
  /** Where the caller writes the diff image: the finding's evidence. */
  readonly evidence?: string;
  readonly context?: CheckContext;
}

export interface VisualStoryResult {
  readonly status: VisualStatus;
  readonly finding?: CheckFinding;
  readonly comparison?: PngComparison;
}

/** Compares one story's capture with its baseline: new without one, `changed` beyond the tolerance. */
export function checkVisualStory(input: VisualStoryInput): VisualStoryResult {
  if (input.baseline === undefined) return { status: "new" };
  const comparison = comparePng(input.baseline, input.capture);
  if (comparison.equal) return { status: "unchanged", comparison };
  const { baselineSize: base, captureSize: cap } = comparison;
  const message =
    comparison.differentPixels === undefined
      ? `The capture is ${size(cap)} pixels; its baseline is ${size(base)}.`
      : `${String(comparison.differentPixels)} pixels differ from the baseline.`;
  return {
    status: "changed",
    comparison,
    finding: {
      check: "visual",
      rule: "changed",
      message,
      ...locate(input.context ?? {}),
      ...(comparison.differentPixels === undefined
        ? { expected: size(base), actual: size(cap) }
        : { expected: "0 differing pixels", actual: `${String(comparison.differentPixels)} differing pixels` }),
      ...(input.evidence === undefined || comparison.diff === undefined ? {} : { evidence: input.evidence }),
      blocking: true,
    },
  };
}

function size(s: { width: number; height: number }): string {
  return `${String(s.width)}x${String(s.height)}`;
}

/**
 * A baseline's path inside the baselines directory: `<theme>/<component>/<story without
 * "<component>--">.png` (docs/spec/story-matrix.md#names). `component` is the kebab-case name.
 */
export function baselinePath(theme: string, component: string, story: string): string {
  const prefix = `${component}--`;
  if (!story.startsWith(prefix)) throw new Error(`The story ${story} doesn't belong to the component ${component}.`);
  return `${theme}/${component}/${story.slice(prefix.length)}.png`;
}

/**
 * `orphan` (BASELINE-001): every file in the baselines directory is `fazon.json`, `NOTICE.md` or a
 * PNG at an expected story's baseline path. `files` and `expected` are paths relative to the
 * directory with `/` separators.
 */
export function checkOrphans(
  files: readonly string[],
  expected: readonly string[],
  context: Pick<CheckContext, "theme"> = {},
): CheckFinding[] {
  const known = new Set(expected);
  return files
    .filter((file) => file !== baselinesRecordFile && file !== baselinesNoticeFile && !known.has(file))
    .map((file) => ({
      check: "visual" as const,
      rule: "orphan",
      message: file.endsWith(".png")
        ? `${file} belongs to no story; \`fazon baseline update\` removes it.`
        : `${file} isn't a baseline; only fazon.json, NOTICE.md and story baselines belong in the directory.`,
      ...locate(context),
      file,
      blocking: true,
    }));
}

/** The files under a directory, relative to it with `/` separators, sorted; none when it doesn't exist. */
export async function listBaselineFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}

/** `fazon.json` as read: the record when it's valid, otherwise what's wrong with it. */
export type BaselinesRecordRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly problems: readonly string[] }
  | { readonly kind: "valid"; readonly record: BaselinesRecord };

/** Parses and validates `fazon.json`'s text against its schema (BASELINE-002). */
export function parseBaselinesRecord(text: string | undefined): BaselinesRecordRead {
  if (text === undefined) return { kind: "missing" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", problems: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const problems = validateWithSchema("baselines", data);
  if (problems.length > 0) return { kind: "invalid", problems: problems.map((p) => `${p.path}: ${p.message}`) };
  return { kind: "valid", record: data as BaselinesRecord };
}

/** Reads `fazon.json` from a baselines directory. */
export async function readBaselinesRecord(dir: string): Promise<BaselinesRecordRead> {
  let text: string | undefined;
  try {
    text = await readFile(join(dir, baselinesRecordFile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return parseBaselinesRecord(text);
}

/** `fazon.json`'s text for an image: two-space JSON with a final newline. */
export function formatBaselinesRecord(image: string): string {
  const record: BaselinesRecord = { fazon: 0, image };
  const problems = validateWithSchema("baselines", record);
  if (problems.length > 0) {
    throw new Error(`${image} can't be recorded: ${problems.map((p) => p.message).join("; ")}`);
  }
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Writes `fazon.json` into a baselines directory. Only `fazon baseline update` calls it. */
export async function writeBaselinesRecord(dir: string, image: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, baselinesRecordFile), formatBaselinesRecord(image));
}

/** The digest of an image reference: `sha256:<hex>`; undefined when it has none. */
export function imageDigest(reference: string): string | undefined {
  return /@(sha256:[0-9a-f]{64})$/.exec(reference)?.[1];
}

/**
 * `image` (BASELINE-002): the image running the check is the one `fazon.json` records, compared by
 * digest. A directory with no baselines and no record has nothing to compare, which isn't a finding.
 */
export function checkBaselineImage(
  record: BaselinesRecordRead,
  runningImage: string,
  hasBaselines: boolean,
): CheckFinding[] {
  const finding = (message: string, extra: Partial<CheckFinding> = {}): CheckFinding[] => [
    { check: "visual", rule: "image", message, file: baselinesRecordFile, ...extra, blocking: true },
  ];
  if (record.kind === "missing") {
    return hasBaselines ? finding("The baselines directory has baselines but no fazon.json naming their image.") : [];
  }
  if (record.kind === "invalid") return finding(`fazon.json is not valid: ${record.problems.join("; ")}`);
  const running = imageDigest(runningImage);
  if (running !== undefined && running === imageDigest(record.record.image)) return [];
  return finding(
    "The baselines were made with another verifier image; nothing was compared. " +
      "Run `fazon baseline update --all` in the upgrade's pull request.",
    { expected: record.record.image, actual: runningImage },
  );
}

/** One story's capture in one theme. */
export interface StoryCapture {
  /** The component's kebab-case name. */
  readonly component: string;
  readonly story: string;
  readonly theme: string;
  readonly png: Uint8Array;
}

export interface VerifyBaselinesInput {
  /** The baselines directory. */
  readonly dir: string;
  /** The verifier image running the check, by digest. */
  readonly runningImage: string;
  readonly captures: readonly StoryCapture[];
  /**
   * Every story's baseline path in every theme, for orphans: those of all components with a spec.
   * Default: the captures' paths.
   */
  readonly expected?: readonly string[];
  /** Where diff images are written, at `<baseline path without .png>.diff.png`. */
  readonly outDir: string;
}

export interface BaselineResult {
  readonly path: string;
  readonly story: string;
  readonly theme: string;
  readonly status: VisualStatus;
}

export interface VerifyBaselinesResult {
  readonly findings: CheckFinding[];
  /** Each capture's status; empty when the image doesn't match and nothing was compared. */
  readonly results: BaselineResult[];
}

/**
 * The visual check over a baselines directory: the recorded image first (on a mismatch nothing is
 * compared), then each capture against its baseline, with diff images written to `outDir`, then the
 * orphans. Writes nothing into the baselines directory.
 */
export async function verifyBaselines(input: VerifyBaselinesInput): Promise<VerifyBaselinesResult> {
  const files = await listBaselineFiles(input.dir);
  const hasBaselines = files.some((f) => f.endsWith(".png"));
  const imageFindings = checkBaselineImage(await readBaselinesRecord(input.dir), input.runningImage, hasBaselines);
  if (imageFindings.length > 0) return { findings: imageFindings, results: [] };

  const present = new Set(files);
  const findings: CheckFinding[] = [];
  const results: BaselineResult[] = [];
  for (const capture of input.captures) {
    const path = baselinePath(capture.theme, capture.component, capture.story);
    const baseline = present.has(path) ? new Uint8Array(await readFile(join(input.dir, path))) : undefined;
    const evidence = join(input.outDir, path.replace(/\.png$/, ".diff.png"));
    const result = checkVisualStory({
      capture: capture.png,
      ...(baseline === undefined ? {} : { baseline }),
      evidence,
      context: { story: capture.story, theme: capture.theme },
    });
    if (result.comparison?.diff !== undefined && result.status === "changed") {
      await mkdir(dirname(evidence), { recursive: true });
      await writeFile(evidence, result.comparison.diff);
    }
    if (result.finding !== undefined) findings.push(result.finding);
    results.push({ path, story: capture.story, theme: capture.theme, status: result.status });
  }
  const expected = input.expected ?? results.map((r) => r.path);
  findings.push(...checkOrphans(files, expected));
  return { findings, results };
}
