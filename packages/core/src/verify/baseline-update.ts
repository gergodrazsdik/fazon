// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon baseline update` (docs/spec/baseline-lifecycle.md#writing-baselines): baselines from the
// captures of a component's latest run, a verify run or the passing iteration of a generate or
// feedback run, when that run qualifies; orphans removed; `fazon.json` with the image; `NOTICE.md`
// for Lucide. It renders nothing itself.
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checksPhaseFiles } from "../loop/checks.js";
import { kebabCase } from "../spec/names.js";
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
import type { JudgeResults } from "../judge/pass.js";
import { listRunIds, readRunRecord, runDirectory, type RunKind, type RunRecord } from "./run-record.js";

/** The platform captures are made on (docs/spec/check-catalogue.md#visual). */
export const capturePlatform = "linux/amd64";

/**
 * The stories of a component the judge gave a verdict, of any kind, in a run: from the results
 * file its summary names. A story counts once the judge saw it in any theme, as it sees some
 * stories only in the default theme. Undefined when the run has no judge results.
 */
async function judgedStories(
  dir: string,
  results: string | undefined,
  component: string,
): Promise<Set<string> | undefined> {
  if (results === undefined) return undefined;
  try {
    const file = JSON.parse(await readFile(path.join(dir, results), "utf8")) as JudgeResults;
    const entry = file.components.find((c) => c.component === component);
    return new Set(
      (entry?.outcome.stories ?? []).filter((story) => story.verdict !== "not-judged").map((story) => story.story),
    );
  } catch {
    return undefined;
  }
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
  /** For a generate or feedback run: the iteration whose checks and captures it gives. */
  readonly iteration?: number;
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
  readonly record: RunRecord;
  /** For a generate or feedback run that passed: its passing iteration, the last. */
  readonly iteration?: number;
  /**
   * Its `verify.json` and its captures' directory, absolute. Absent for an agent run that didn't
   * pass, or whose passing iteration left no checks of the component.
   */
  readonly checked?: { readonly details: VerifyDetails; readonly captures: string };
}

const agentRunKinds: ReadonlySet<RunKind> = new Set(["generate", "feedback"]);

/**
 * The component's newest finished run: a verify run that covered it, or a generate or feedback run
 * of it, whose checks and captures are its passing iteration's, `checks/<n>/verify.json` and
 * `captures/<n>/` (docs/spec/records.md#the-fazon-directory). Propose runs, agent runs of other
 * components and runs still recorded as running are passed over.
 */
async function latestRun(root: string, component: string): Promise<LatestRun | undefined> {
  for (const id of await listRunIds(root)) {
    const dir = runDirectory(root, id);
    const record = await readRunRecord(dir);
    if (record === undefined || record.status === "running") continue;
    if (agentRunKinds.has(record.kind)) {
      if (record.component === undefined || kebabCase(record.component) !== component) continue;
      const passing = record.status === "passed" ? record.iterations.findLast((i) => i.outcome === "pass") : undefined;
      if (passing === undefined) return { id, record };
      const files = checksPhaseFiles(passing.n);
      const details = await readVerifyDetails(path.join(dir, files.directory));
      if (details?.components.some((c) => c.name === component) !== true) return { id, record, iteration: passing.n };
      const captures = path.join(dir, passing.verification?.captures ?? files.captures);
      return { id, record, iteration: passing.n, checked: { details, captures } };
    }
    if (record.kind !== "verify") continue;
    const details = await readVerifyDetails(dir);
    if (details?.components.some((c) => c.name === component) !== true) continue;
    return { id, record, checked: { details, captures: path.join(dir, capturesDirectory) } };
  }
  return undefined;
}

/** Why an agent run has no checks to qualify with: it didn't pass, or its passing iteration's are missing. */
function agentRunProblem(run: LatestRun, component: VerifyComponent): string {
  const { record } = run;
  const verify = `fazon verify ${component.name}`;
  if (record.status === "passed") {
    const where = run.iteration === undefined ? "no iteration passed" : checksPhaseFiles(run.iteration).details;
    return `it passed, but has no checks of ${component.name} to take baselines from (${where}); run \`${verify}\`.`;
  }
  const why =
    record.status === "needs-a-person"
      ? `it needs a person${record.reason === undefined ? "" : ` (${record.reason})`}`
      : record.status === "stopped"
        ? "it was interrupted"
        : "it failed";
  return `it didn't pass: ${why}. A ${record.kind} run gives baselines only when it passed. Read its report, then run \`fazon feedback ${component.name}\` or \`fazon generate ${component.name}\`, or \`${verify}\` once the component is as it should be.`;
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
  const iteration = run.iteration === undefined ? "" : ` (iteration ${String(run.iteration)})`;
  const label = `${component.spec.name}'s latest run ${run.id}${iteration}`;
  const at = {
    component: component.name,
    run: run.id,
    ...(run.iteration === undefined ? {} : { iteration: run.iteration }),
  };
  if (run.checked === undefined) {
    return { qualification: { ...at, failed: [`${label}: ${agentRunProblem(run, component)}`] }, run };
  }
  const { details } = run.checked;
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
  if (details.platform !== capturePlatform) {
    failed.push(`it ran on ${details.platform}; baselines are made on ${capturePlatform} only.`);
  }
  const statuses = details.components.find((c) => c.name === component.name)?.checks ?? {};
  const failing = (Object.entries(statuses) as [CheckId, string][]).filter(
    ([check, status]) => check !== "visual" && status !== "pass",
  );
  if (failing.length > 0) {
    failed.push(
      `it didn't pass every check other than visual: ${failing.map(([check, status]) => `${check} ${status === "fail" ? "failed" : status === "error" ? "ended in error" : status}`).join(", ")}; fix them and run \`fazon verify ${component.name}\` again.`,
    );
  }
  if (input.config.judge.policy !== "off") {
    const judge =
      run.iteration === undefined
        ? run.record.verification?.judge
        : run.record.iterations.find((i) => i.n === run.iteration)?.verification?.judge;
    const judged = await judgedStories(runDirectory(input.root, run.id), judge?.results, component.name);
    const writes = new Set(
      details.stories
        .filter((s) => s.component === component.name && s.status !== "unchanged")
        .filter((s) => input.stories === undefined || input.stories.includes(s.story))
        .map((s) => s.story),
    );
    const unseen = [...writes].filter((story) => judged?.has(story) !== true);
    if (judged === undefined && writes.size > 0) {
      failed.push(
        run.iteration === undefined
          ? `the judge didn't look at its stories; run \`fazon judge ${run.id}\`, or \`fazon verify ${component.name}\` with a credential.`
          : "the judge didn't look at its stories in it; run `fazon verify " + component.name + "` with a credential.",
      );
    } else if (unseen.length > 0) {
      const shown = unseen.slice(0, 3).join(", ");
      failed.push(
        `the judge gave no verdict for ${String(unseen.length)} of the stories it would write (${shown}${unseen.length > 3 ? ", …" : ""}), as its budget ran out or a call didn't run; run \`fazon judge ${run.id}\` again.`,
      );
    }
  }
  const now = await componentInputsHash(input.root, component, input.config.paths.tokens);
  const then = details.components.find((c) => c.name === component.name)?.inputs;
  if (now !== then) {
    failed.push(
      `its spec, its files or the token set changed since the run; run \`fazon verify ${component.name}\` again.`,
    );
  }
  return { qualification: { ...at, failed: failed.map((reason) => `${label}: ${reason}`) }, run };
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

  const qualified: { component: VerifyComponent; details: VerifyDetails; captures: string }[] = [];
  const qualifications: Qualification[] = [];
  for (const component of targets) {
    const { qualification, run } = await qualify(input, component, recorded);
    qualifications.push(qualification);
    if (run?.checked !== undefined && qualification.failed.length === 0) qualified.push({ component, ...run.checked });
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
  for (const { component, details, captures } of qualified) {
    const stories = details.stories.filter(
      (s) => s.component === component.name && (input.stories === undefined || input.stories.includes(s.story)),
    );
    for (const story of stories) {
      const capture = new Uint8Array(await readFile(path.join(captures, story.path)));
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
