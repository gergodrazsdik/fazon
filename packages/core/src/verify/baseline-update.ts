// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon baseline update` (docs/spec/baseline-lifecycle.md#writing-baselines): baselines from the
// captures of a component's latest run, when that run qualifies; orphans removed; `fazon.json`
// with the image; `NOTICE.md` for Lucide. It renders nothing itself.
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  baselinePath,
  baselinesNoticeFile,
  baselinesRecordFile,
  checkOrphans,
  decodePng,
  formatBaselinesRecord,
  imageDigest,
  listBaselineFiles,
  readBaselinesRecord,
} from "../checks/visual.js";
import type { CheckId } from "../checks/types.js";
import type { Config } from "../config/types.js";
import type { VerifyComponent } from "./components.js";
import { capturesDirectory } from "./rendered.js";
import { componentInputsHash, optimizePng, readVerifyDetails, type VerifyDetails } from "./details.js";
import { findPackage } from "./in-image.js";
import { listRunIds, readRunRecord, runDirectory, type RunRecord } from "./run-record.js";

/** The platform captures are made on (docs/spec/check-catalogue.md#visual). */
export const capturePlatform = "linux/amd64";

/**
 * Whether this framework version has a judge. Until it does (M3), the third condition, that the
 * judge looked at every story written, doesn't apply, as with the judge's policy `off`.
 */
export function judgeAvailable(): boolean {
  return false;
}

export interface BaselineUpdateInput {
  readonly root: string;
  readonly config: Config;
  /** Every component with a spec. */
  readonly components: readonly VerifyComponent[];
  /** The components to update, by kebab-case name; `all` for `--all`. */
  readonly targets: readonly string[] | "all";
  /** `--story`: only these stories, by name; orphans are then kept. */
  readonly stories?: readonly string[];
}

/** One component's latest run, and whether it qualifies. */
export interface Qualification {
  readonly component: string;
  readonly run?: string;
  /** Each condition that failed, in plain words with how to meet it. */
  readonly failed: readonly string[];
}

export type BaselineUpdateOutcome =
  | { readonly kind: "refused"; readonly qualifications: readonly Qualification[] }
  | {
      readonly kind: "done";
      readonly qualifications: readonly Qualification[];
      readonly image: string;
      /** Paths in the baselines directory. */
      readonly written: readonly string[];
      readonly unchanged: readonly string[];
      readonly removed: readonly string[];
    };

interface LatestRun {
  readonly id: string;
  readonly dir: string;
  readonly record: RunRecord;
  readonly details: VerifyDetails;
}

/** The newest finished run that covered the component, with its record and details. */
async function latestRun(root: string, component: string): Promise<LatestRun | undefined> {
  for (const id of await listRunIds(root)) {
    const dir = runDirectory(root, id);
    const record = await readRunRecord(dir);
    if (record === undefined || record.status === "running") continue;
    const details = await readVerifyDetails(dir);
    if (details?.components.some((c) => c.name === component) !== true) continue;
    return { id, dir, record, details };
  }
  return undefined;
}

/** The four conditions of docs/spec/baseline-lifecycle.md#writing-baselines, for one component. */
async function qualify(
  input: BaselineUpdateInput,
  component: VerifyComponent,
  recorded: string | undefined,
): Promise<{ qualification: Qualification; run?: LatestRun }> {
  const run = await latestRun(input.root, component.name);
  if (run === undefined) {
    return {
      qualification: {
        component: component.name,
        failed: [`${component.spec.name} has no finished run; run \`fazon verify ${component.name}\` first.`],
      },
    };
  }
  const failed: string[] = [];
  const all = input.targets === "all";
  const image = run.record.versions.image;
  if (imageDigest(image) !== imageDigest(input.config.image)) {
    failed.push(
      `it ran in ${image}, not in the image fazon.yaml pins (${input.config.image}); run \`fazon verify\` again.`,
    );
  } else if (!all && recorded !== undefined && imageDigest(recorded) !== imageDigest(image)) {
    failed.push(
      `it ran in ${image}, but the baselines were made with ${recorded}; only \`fazon baseline update --all\` records another image.`,
    );
  }
  if (run.details.platform !== capturePlatform) {
    failed.push(`it ran on ${run.details.platform}; baselines are made on ${capturePlatform} only.`);
  }
  const statuses = run.details.components.find((c) => c.name === component.name)?.checks ?? {};
  const failing = (Object.entries(statuses) as [CheckId, string][]).filter(
    ([check, status]) => check !== "visual" && status !== "pass",
  );
  if (failing.length > 0) {
    failed.push(
      `it didn't pass every check other than visual: ${failing.map(([check, status]) => `${check} ${status === "fail" ? "failed" : status === "error" ? "ended in error" : status}`).join(", ")}; fix them and run \`fazon verify ${component.name}\` again.`,
    );
  }
  if (judgeAvailable() && input.config.judge.policy !== "off") {
    failed.push("the judge didn't look at its stories.");
  }
  const now = await componentInputsHash(input.root, component, input.config.paths.tokens);
  const then = run.details.components.find((c) => c.name === component.name)?.inputs;
  if (now !== then) {
    failed.push(
      `its spec, its files or the token set changed since the run; run \`fazon verify ${component.name}\` again.`,
    );
  }
  return {
    qualification: {
      component: component.name,
      run: run.id,
      failed: failed.map((reason) => `${component.spec.name}'s latest run ${run.id}: ${reason}`),
    },
    run,
  };
}

function samePixels(a: Uint8Array, b: Uint8Array): boolean {
  const x = decodePng(a);
  const y = decodePng(b);
  return x.width === y.width && x.height === y.height && Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) === 0;
}

/** The text of `NOTICE.md` for the Lucide icons the baselines show. */
export function lucideNotice(version: string, license: string): string {
  return `# Notices

The baselines in this directory show icons from [Lucide](https://lucide.dev), from the \`lucide-static\` package (version ${version}). Lucide is licensed under the ISC License, and the icons it derived from Feather under the MIT License. \`fazon baseline update\` writes this file.

\`\`\`text
${license.trimEnd()}
\`\`\`
`;
}

/** Writes baselines for the targets, or refuses with the conditions that failed. */
export async function updateBaselines(input: BaselineUpdateInput): Promise<BaselineUpdateOutcome> {
  const dir = path.join(input.root, input.config.paths.baselines);
  const record = await readBaselinesRecord(dir);
  const recorded = record.kind === "valid" ? record.record.image : undefined;
  const targets =
    input.targets === "all" ? input.components : input.components.filter((c) => input.targets.includes(c.name));

  const qualified: { component: VerifyComponent; run: LatestRun }[] = [];
  const qualifications: Qualification[] = [];
  for (const component of targets) {
    const { qualification, run } = await qualify(input, component, recorded);
    qualifications.push(qualification);
    if (run !== undefined && qualification.failed.length === 0) qualified.push({ component, run });
  }
  if (qualifications.some((q) => q.failed.length > 0)) return { kind: "refused", qualifications };

  let notice: string | undefined;
  if (input.config.icons === "lucide") {
    const lucide = await findPackage(input.root, "lucide-static");
    if (lucide === undefined) {
      return {
        kind: "refused",
        qualifications: [
          {
            component: "",
            failed: [
              "The icon set is Lucide, but the repository doesn't install lucide-static, whose license NOTICE.md carries.",
            ],
          },
        ],
      };
    }
    const { version } = JSON.parse(await readFile(path.join(lucide, "package.json"), "utf8")) as { version: string };
    notice = lucideNotice(version, await readFile(path.join(lucide, "LICENSE"), "utf8"));
  }

  const written: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  const files = new Set(await listBaselineFiles(dir));
  for (const { component, run } of qualified) {
    const stories = run.details.stories.filter(
      (s) => s.component === component.name && (input.stories === undefined || input.stories.includes(s.story)),
    );
    for (const story of stories) {
      const capture = new Uint8Array(await readFile(path.join(run.dir, capturesDirectory, story.path)));
      const target = path.join(dir, story.path);
      if (files.has(story.path) && samePixels(new Uint8Array(await readFile(target)), capture)) {
        unchanged.push(story.path);
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, optimizePng(capture));
      written.push(story.path);
    }
  }

  // Orphans: of the updated components, or with --all every file that isn't a baseline.
  if (input.stories === undefined) {
    const expected = input.components.flatMap((component) =>
      (component.manifest?.stories ?? []).flatMap((story) =>
        (component.manifest?.themes ?? []).map((theme) => baselinePath(theme, component.name, story.name)),
      ),
    );
    const names = new Set(targets.map((c) => c.name));
    for (const finding of checkOrphans([...files], expected)) {
      const file = finding.file ?? "";
      if (input.targets !== "all" && !names.has(file.split("/")[1] ?? "")) continue;
      await rm(path.join(dir, file), { force: true });
      removed.push(file);
    }
  }

  const image = input.config.image;
  if (input.targets === "all" || recorded === undefined) {
    await mkdir(dir, { recursive: true });
    const text = formatBaselinesRecord(image);
    const current = await readFile(path.join(dir, baselinesRecordFile), "utf8").catch(() => undefined);
    if (current !== text) await writeFile(path.join(dir, baselinesRecordFile), text);
  }
  const noticeFile = path.join(dir, baselinesNoticeFile);
  if (notice === undefined) {
    await rm(noticeFile, { force: true });
  } else {
    const current = await readFile(noticeFile, "utf8").catch(() => undefined);
    if (current !== notice) {
      await mkdir(dir, { recursive: true });
      await writeFile(noticeFile, notice);
    }
  }
  await removeEmptyDirectories(dir);
  return {
    kind: "done",
    qualifications,
    image,
    written: written.sort(),
    unchanged: unchanged.sort(),
    removed: removed.sort(),
  };
}

async function removeEmptyDirectories(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    await removeEmptyDirectories(child);
    if ((await readdir(child)).length === 0) await rmdir(child);
  }
}
