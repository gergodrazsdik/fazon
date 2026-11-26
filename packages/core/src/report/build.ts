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
import type { VerifyDetails } from "../verify/details.js";
import { runDirectory, runsDirectory, type RunRecord } from "../verify/run-record.js";
import { renderReport } from "./render.js";
import { galleryVerification, type ReportCapture, type ReportRecord } from "./types.js";

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
 * The captures of a run: a verify run's from `verify.json`; otherwise every PNG in the captures
 * directory, at `<theme>/<component>/<story>.png` as baselines are named, with its diff image
 * beside it. A capture without `verify.json` is changed when it has a diff image, unchanged when
 * the baselines directory has its baseline, and new otherwise.
 */
async function collectCaptures(
  input: ReportInput,
  record: ReportRecord,
  runDir: string,
  baselinesDir: string,
): Promise<Collected[]> {
  const gallery = galleryVerification(record);
  const capturesDir = inside(runDir, gallery?.verification.captures ?? "captures");
  if (capturesDir === undefined) return [];
  const collected: Collected[] = [];
  if (input.details !== undefined && record.kind === "verify") {
    for (const story of input.details.stories) {
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
 * Builds the report of a run: copies its captures, diff images and the baselines of changed
 * stories into `report/images/`, and writes `report/index.html`, replacing an earlier report of
 * the run. Every path it copies from stays inside the run's directory or the baselines directory.
 */
export async function buildReport(input: ReportInput): Promise<ReportOutcome> {
  const record = input.record as unknown as ReportRecord;
  const runDir = path.resolve(runDirectory(input.root, record.id));
  const baselinesDir = path.resolve(input.root, input.config.paths.baselines);
  const reportDir = path.join(runDir, reportDirectory);
  const storybookUrl = input.storybookUrl ?? defaultStorybookUrl;

  const collected = await collectCaptures(input, record, runDir, baselinesDir);
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
