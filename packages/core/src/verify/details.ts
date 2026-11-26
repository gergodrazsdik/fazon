// SPDX-License-Identifier: GPL-3.0-or-later
// `verify.json`, beside a verify run's record: what the run record has no field for, and what
// `fazon baseline update`, the report and the judge read: each story's capture and visual status,
// orphans and renamed pairs, the baselines a pull request changes (`--base`), each component's
// check statuses and the hash of its inputs, and the platform the captures were made on.
import { createHash } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import type { CheckFinding, CheckId } from "../checks/types.js";
import { decodePng } from "../checks/visual.js";
import { hashText, hashTokenSet } from "../tokens/hash.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { VerifyComponent } from "./components.js";
import { findingComponent, type UnusedExemption } from "./exemptions.js";
import type { Orphan, StoryVisual } from "./rendered.js";
import type { CheckResult, CheckStatus } from "./run-record.js";

/** The file's name in a verify run's directory. */
export const verifyDetailsFile = "verify.json";

/** How a baseline differs from the one at the `--base` ref (docs/spec/baseline-lifecycle.md#in-ci). */
export type BaseMark = "added" | "changed" | "removed" | "renamed";

export interface BaseChange {
  /** The baseline's path in the baselines directory. */
  readonly path: string;
  readonly mark: BaseMark;
  /** For a renamed baseline: its path at the ref. */
  readonly from?: string;
}

export interface ComponentDetails {
  /** The kebab-case name. */
  readonly name: string;
  /** The hash of its spec, its directory's files and the token set when the run started. */
  readonly inputs: string;
  /** Each check's status for this component: findings of other components don't count. */
  readonly checks: Readonly<Partial<Record<CheckId, CheckStatus>>>;
}

export interface VerifyDetails {
  readonly fazon: 0;
  /** `<os>/<architecture>` the checks ran on, such as `linux/amd64`. */
  readonly platform: string;
  readonly components: readonly ComponentDetails[];
  readonly stories: readonly StoryVisual[];
  readonly orphans: readonly Orphan[];
  /** axe's undecided results, for a person to look at; they never block. */
  readonly incomplete: readonly CheckFinding[];
  readonly unusedExemptions: readonly UnusedExemption[];
  /** With `--base`: the ref, and the baselines that differ from it. */
  readonly base?: { readonly ref: string; readonly changes: readonly BaseChange[] };
}

export async function writeVerifyDetails(runDir: string, details: VerifyDetails): Promise<void> {
  const file = path.join(runDir, verifyDetailsFile);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(details, null, 2)}\n`);
  await rename(temporary, file);
}

export async function readVerifyDetails(runDir: string): Promise<VerifyDetails | undefined> {
  try {
    return JSON.parse(await readFile(path.join(runDir, verifyDetailsFile), "utf8")) as VerifyDetails;
  } catch {
    return undefined;
  }
}

/** Node.js's platform as an OCI platform: `linux/amd64`. */
export function ociPlatform(platform: string = process.platform, arch: string = process.arch): string {
  const architectures: Readonly<Record<string, string>> = { x64: "amd64", arm64: "arm64", ia32: "386", arm: "arm" };
  return `${platform}/${architectures[arch] ?? arch}`;
}

/**
 * Each check's status for one component: a check that was skipped or ended in error is that for
 * every component; otherwise it fails for a component with a blocking finding of its own, or one
 * that belongs to no component.
 */
export function componentCheckStatuses(
  checks: readonly CheckResult[],
  component: VerifyComponent,
  components: readonly VerifyComponent[],
): Partial<Record<CheckId, CheckStatus>> {
  const statuses: Partial<Record<CheckId, CheckStatus>> = {};
  for (const check of checks) {
    if (check.status === "skipped" || check.status === "error") {
      statuses[check.check] = check.status;
      continue;
    }
    const blocking = check.findings.some((finding) => {
      if (!finding.blocking) return false;
      const owner = findingComponent(finding, components);
      return owner === undefined || owner === component.name;
    });
    statuses[check.check] = blocking ? "fail" : "pass";
  }
  return statuses;
}

async function filesUnder(root: string, directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * The hash of what a component's captures depend on in the repository: its spec, every file in its
 * directory and the token set, one line per file. A run is newer than the last change to them when
 * the hash is the same now as when the run started.
 */
export async function componentInputsHash(root: string, component: VerifyComponent, tokens: string): Promise<string> {
  const files = [component.specFile, ...(await filesUnder(root, component.directory))];
  const lines: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    lines.push(`${file} ${hashText(text)}`);
  }
  let tokenSet = "none";
  try {
    const resolved = await resolveTokenSet(path.join(root, tokens));
    if (resolved.tokenSet !== undefined) tokenSet = hashTokenSet(resolved.tokenSet);
  } catch {
    // An unreadable token set gives "none", which a later readable one won't match.
  }
  lines.push(`tokens ${tokenSet}`);
  return hashText(lines.map((line) => `${line}\n`).join(""));
}

/** Git's blob ID of a file's bytes, as `git hash-object` gives it. */
export function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${String(bytes.byteLength)}\0`)
    .update(bytes)
    .digest("hex");
}

/**
 * The baselines that differ between a ref and now, by blob ID: added, changed, removed, and
 * renamed, a removed and an added baseline of the same theme and component with the same bytes.
 * Paths are relative to the baselines directory; only PNG files count.
 */
export function compareWithBase(base: ReadonlyMap<string, string>, current: ReadonlyMap<string, string>): BaseChange[] {
  const png = (file: string) => file.endsWith(".png");
  const added = [...current.keys()].filter((file) => png(file) && !base.has(file));
  const removed = [...base.keys()].filter((file) => png(file) && !current.has(file));
  const changes: BaseChange[] = [];
  const renamedFrom = new Set<string>();
  const group = (file: string) => file.split("/").slice(0, 2).join("/");
  for (const file of added) {
    const from = removed.find(
      (old) => !renamedFrom.has(old) && group(old) === group(file) && base.get(old) === current.get(file),
    );
    if (from === undefined) {
      changes.push({ path: file, mark: "added" });
    } else {
      renamedFrom.add(from);
      changes.push({ path: file, mark: "renamed", from });
    }
  }
  for (const file of removed) if (!renamedFrom.has(file)) changes.push({ path: file, mark: "removed" });
  for (const [file, blob] of current) {
    if (png(file) && base.has(file) && base.get(file) !== blob) changes.push({ path: file, mark: "changed" });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * A PNG, losslessly optimised: fully opaque images lose their alpha channel, every row gets the
 * filter that compresses it best, and the data is deflated at the highest level. The pixels are
 * the same, which is checked; the smaller of the two files is returned.
 */
export function optimizePng(png: Uint8Array): Uint8Array {
  const pixels = decodePng(png);
  let opaque = true;
  for (let i = 3; i < pixels.data.length; i += 4) {
    if (pixels.data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const image = new PNG({
    width: pixels.width,
    height: pixels.height,
    colorType: opaque ? 2 : 6,
    inputHasAlpha: true,
    deflateLevel: 9,
    deflateStrategy: 3,
    filterType: -1,
  });
  Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength).copy(image.data);
  const optimized = new Uint8Array(
    PNG.sync.write(image, { colorType: opaque ? 2 : 6, inputHasAlpha: true, deflateLevel: 9, filterType: -1 }),
  );
  const check = decodePng(optimized);
  const same =
    check.width === pixels.width &&
    check.height === pixels.height &&
    Buffer.compare(Buffer.from(check.data), Buffer.from(pixels.data)) === 0;
  if (!same) throw new Error("Optimising the PNG changed its pixels.");
  return optimized.byteLength < png.byteLength ? optimized : png;
}
