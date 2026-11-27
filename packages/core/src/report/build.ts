// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon report`: the static HTML page of one run (docs/spec/cli.md#fazon-report), written to
// `report/index.html` in the run's directory with every image it shows copied next to it, so the
// directory opens without a server and works as a CI artifact (docs/spec/records.md).
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/types.js";
import type { StoryManifest } from "../matrix/types.js";
import { storybookId } from "../matrix/names.js";
import { kebabCase } from "../spec/names.js";
import { generatedDirectory, manifestFileName } from "../sync/sync.js";
import { checksPhaseFiles } from "../loop/checks.js";
import { readVerifyDetails, type VerifyDetails } from "../verify/details.js";
import { runDirectory, runsDirectory, type RunRecord } from "../verify/run-record.js";
import { renderReport } from "./render.js";
import {
  findingOwner,
  galleryVerification,
  type ReportCapture,
  type ReportFocus,
  type ReportOtherComponent,
  type ReportRecord,
} from "./types.js";

/** The report's directory in a run's directory. */
export const reportDirectory = "report";
/** The report's page in its directory. */
export const reportFile = "index.html";
/** Where the copied images go, in the report's directory. */
const imagesDirectory = "images";
/** Storybook's dev server on its default port, as `storybook dev` serves it. */
export const defaultStorybookUrl = "http://localhost:6006";

export interface ReportInput {
  /** The repository root, absolute. */
  readonly root: string;
  readonly config: Config;
  readonly record: RunRecord;
  /** A verify run's `verify.json`. */
  readonly details?: VerifyDetails;
  /** The local Storybook the screenshots link to; {@link defaultStorybookUrl} when absent. */
  readonly storybookUrl?: string;
}

export interface ReportOutcome {
  /** The page, relative to the repository root, `/`-separated. */
  readonly path: string;
  /** The page, absolute. */
  readonly file: string;
  /** The images copied next to it. */
  readonly images: number;
}

/** A capture before its images are copied: their sources, absolute. */
interface Collected {
  readonly capture: Omit<ReportCapture, "image" | "diff" | "baseline" | "storybook">;
  readonly image: string | undefined;
  readonly diff: string | undefined;
  readonly baseline: string | undefined;
}

/**
 * The address of a story in the local Storybook, in a theme; undefined when the base isn't an
 * http or https URL.
 */
export function storybookStoryUrl(base: string, id: string, theme: string): string | undefined {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  let pathname = url.pathname;
  while (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  return `${url.origin}${pathname}/?path=/story/${encodeURIComponent(id)}&globals=theme:${encodeURIComponent(theme)}`;
}

/** `path` under `base`, absolute; undefined when it would leave `base`. */
function inside(base: string, relative: string): string | undefined {
  const resolved = path.resolve(base, relative);
  return resolved.startsWith(base + path.sep) ? resolved : undefined;
}

/** Whether a regular file is there; a symbolic link isn't followed. */
async function isFile(file: string | undefined): Promise<boolean> {
  if (file === undefined) return false;
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

async function pngFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png") && !entry.name.endsWith(".diff.png"))
    .map((entry) => toPosix(path.relative(directory, path.join(entry.parentPath, entry.name))))
    .sort();
}

/**
 * The `verify.json` of the gallery's captures: a verify run's, from the input; an agent run's
 * iteration's, from its `checks/<n>/` directory, when the checks phase wrote one.
 */
async function galleryDetails(input: ReportInput, record: ReportRecord, runDir: string) {
  if (record.kind === "verify") return input.details;
  const iteration = galleryVerification(record)?.iteration;
  if (iteration === undefined) return undefined;
  const directory = inside(runDir, checksPhaseFiles(iteration).directory);
  return directory === undefined ? undefined : await readVerifyDetails(directory);
}

/**
 * The captures of a run: from its `verify.json` (a verify run's, or an agent run's iteration's);
 * otherwise every PNG in the captures directory, at `<theme>/<component>/<story>.png` as baselines
 * are named, with its diff image beside it. A capture without `verify.json` is changed when it has
 * a diff image, unchanged when the baselines directory has its baseline, and new otherwise.
 */
async function collectCaptures(
  details: VerifyDetails | undefined,
  record: ReportRecord,
  runDir: string,
  baselinesDir: string,
): Promise<Collected[]> {
  const gallery = galleryVerification(record);
  const capturesDir = inside(runDir, gallery?.verification.captures ?? "captures");
  if (capturesDir === undefined) return [];
  const collected: Collected[] = [];
  if (details !== undefined) {
    for (const story of details.stories) {
      const image = inside(capturesDir, story.path);
      const diff = story.diff === undefined ? undefined : inside(runDir, story.diff);
      const baseline = story.status === "changed" ? inside(baselinesDir, story.path) : undefined;
      collected.push({
        capture: {
          component: story.component,
          story: story.story,
          theme: story.theme,
          path: story.path,
          ...(story.status === undefined ? {} : { status: story.status }),
          ...(story.renamedFrom === undefined ? {} : { renamedFrom: story.renamedFrom }),
        },
        image: (await isFile(image)) ? image : undefined,
        diff: (await isFile(diff)) ? diff : undefined,
        baseline: (await isFile(baseline)) ? baseline : undefined,
      });
    }
    return collected;
  }
  const own = record.component === undefined ? undefined : kebabCase(record.component);
  for (const file of await pngFiles(capturesDir)) {
    const segments = file.split("/");
    const theme = segments[0] ?? "";
    const component = segments.length >= 3 ? (segments[1] ?? "") : (own ?? "");
    const rest = segments.slice(segments.length >= 3 ? 2 : 1).join("/");
    const baselinePath = `${theme}/${component}/${rest}`;
    const image = path.join(capturesDir, ...segments);
    const diff = image.replace(/\.png$/, ".diff.png");
    const hasDiff = await isFile(diff);
    const baseline = inside(baselinesDir, baselinePath);
    const hasBaseline = await isFile(baseline);
    collected.push({
      capture: {
        component,
        story: `${component}--${rest.replace(/\.png$/, "")}`,
        theme,
        path: baselinePath,
        status: hasDiff ? "changed" : hasBaseline ? "unchanged" : "new",
      },
      image,
      diff: hasDiff ? diff : undefined,
      baseline: hasDiff && hasBaseline ? baseline : undefined,
    });
  }
  return collected;
}

/** A configured directory, repository-relative and `/`-separated, without `./` or a trailing `/`. */
function posixDirectory(directory: string): string {
  // normalize() has collapsed repeated slashes, so at most one trailing slash is left.
  const normalized = path.posix.normalize(toPosix(directory)).replace(/\/$/, "");
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

/**
 * What an agent run's report shows of the components its checks covered: its own component in
 * full; every other one summarised, and in full only when it blocks. Undefined for a verify run,
 * whose report shows every component.
 */
function focusOn(
  record: ReportRecord,
  config: Config,
  collected: readonly Collected[],
  details: VerifyDetails | undefined,
): ReportFocus | undefined {
  if (record.kind === "verify" || record.component === undefined) return undefined;
  const component = kebabCase(record.component);
  const paths = { components: posixDirectory(config.paths.components), specs: posixDirectory(config.paths.specs) };
  const checks = galleryVerification(record)?.verification.checks ?? [];
  const names = new Set<string>([
    ...collected.map((item) => item.capture.component),
    ...(details?.components ?? []).map((c) => c.name),
  ]);
  for (const check of checks) {
    for (const finding of check.findings) {
      const owner = findingOwner(finding, paths);
      if (owner !== undefined) names.add(owner);
    }
  }
  names.delete(component);
  const others = [...names].sort().map((name): ReportOtherComponent => {
    const captures = { unchanged: 0, changed: 0, new: 0, notCompared: 0 };
    for (const item of collected) {
      if (item.capture.component !== name) continue;
      const status = item.capture.status;
      if (status === undefined) captures.notCompared += 1;
      else captures[status] += 1;
    }
    const ownBlocking = (check: (typeof checks)[number]) =>
      check.findings.some((finding) => finding.blocking && findingOwner(finding, paths) === name);
    const statuses = checks.map((check): ReportOtherComponent["checks"][number] => ({
      check: check.check,
      status:
        check.status === "skipped" || check.status === "error" ? check.status : ownBlocking(check) ? "fail" : "pass",
    }));
    return {
      component: name,
      captures,
      checks: statuses,
      blocks: captures.changed > 0 || checks.some(ownBlocking),
    };
  });
  return { component, paths, others };
}

function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** Each story's Storybook ID, from the components' committed story manifests. */
async function storybookIds(
  root: string,
  config: Config,
  components: Iterable<string>,
): Promise<ReadonlyMap<string, string>> {
  const ids = new Map<string, string>();
  const componentsDir = path.resolve(root, config.paths.components);
  for (const component of components) {
    const file = inside(componentsDir, path.join(component, generatedDirectory, manifestFileName));
    if (file === undefined) continue;
    try {
      const manifest = JSON.parse(await readFile(file, "utf8")) as Partial<StoryManifest>;
      for (const story of manifest.stories ?? []) {
        if (typeof story.name === "string" && typeof story.storybookId === "string") {
          ids.set(story.name, story.storybookId);
        }
      }
    } catch {
      // No manifest: the ID is derived from the story's name below.
    }
  }
  return ids;
}

function storyId(ids: ReadonlyMap<string, string>, component: string, story: string): string | undefined {
  const known = ids.get(story);
  if (known !== undefined) return known;
  try {
    return storybookId(pascalCase(component), story);
  } catch {
    return undefined;
  }
}

/**
 * Builds the report of a run: copies the captures, diff images and baselines of changed stories it
 * shows into `report/images/`, and writes `report/index.html`, replacing an earlier report of the
 * run. A verify run's report shows every component; an agent run's shows its component, and
 * another component only when it blocks. Every path it copies from stays inside the run's
 * directory or the baselines directory.
 */
export async function buildReport(input: ReportInput): Promise<ReportOutcome> {
  const record = input.record as unknown as ReportRecord;
  const runDir = path.resolve(runDirectory(input.root, record.id));
  const baselinesDir = path.resolve(input.root, input.config.paths.baselines);
  const reportDir = path.join(runDir, reportDirectory);
  const storybookUrl = input.storybookUrl ?? defaultStorybookUrl;

  const details = await galleryDetails(input, record, runDir);
  const all = await collectCaptures(details, record, runDir, baselinesDir);
  const focus = focusOn(record, input.config, all, details);
  // An agent run's report copies the captures of its component and of the other components that block, only.
  const shown = new Set(focus?.others.filter((other) => other.blocks).map((other) => other.component));
  if (focus !== undefined) shown.add(focus.component);
  const collected = focus === undefined ? all : all.filter((item) => shown.has(item.capture.component));
  const ids = await storybookIds(input.root, input.config, new Set(collected.map((c) => c.capture.component)));

  await rm(reportDir, { recursive: true, force: true });
  await mkdir(reportDir, { recursive: true });
  /** Copied images by their run-relative path, for findings' evidence. */
  const evidence = new Map<string, string>();
  let images = 0;
  const copy = async (source: string, under: string, from: string): Promise<string> => {
    const relative = toPosix(path.relative(from, source));
    const target = `${imagesDirectory}/${under}/${relative}`;
    await mkdir(path.dirname(path.join(reportDir, target)), { recursive: true });
    await copyFile(source, path.join(reportDir, target), constants.COPYFILE_FICLONE);
    images += 1;
    return target;
  };

  const captures: ReportCapture[] = [];
  for (const item of collected) {
    const image = item.image === undefined ? undefined : await copy(item.image, "run", runDir);
    const diff = item.diff === undefined ? undefined : await copy(item.diff, "run", runDir);
    const baseline = item.baseline === undefined ? undefined : await copy(item.baseline, "baselines", baselinesDir);
    if (item.image !== undefined && image !== undefined)
      evidence.set(toPosix(path.relative(runDir, item.image)), image);
    if (item.diff !== undefined && diff !== undefined) evidence.set(toPosix(path.relative(runDir, item.diff)), diff);
    const id = storyId(ids, item.capture.component, item.capture.story);
    const storybook = id === undefined ? undefined : storybookStoryUrl(storybookUrl, id, item.capture.theme);
    captures.push({
      ...item.capture,
      ...(image === undefined ? {} : { image }),
      ...(diff === undefined ? {} : { diff }),
      ...(baseline === undefined ? {} : { baseline }),
      ...(storybook === undefined ? {} : { storybook }),
    });
  }

  const page = renderReport({
    record,
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(focus === undefined ? {} : { focus }),
    captures,
    evidence,
    storybookUrl,
  });
  const file = path.join(reportDir, reportFile);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, page);
  await rename(temporary, file);
  return { path: `${runsDirectory}/${record.id}/${reportDirectory}/${reportFile}`, file, images };
}
