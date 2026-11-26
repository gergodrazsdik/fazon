// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon sync` (docs/spec/cli.md#fazon-sync): the files the harness maintains, from the specs and the
// token set (docs/spec/agent-permissions.md#files-the-harness-maintains).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdapterError, type Adapter, type EntryComponent } from "../adapter.js";
import type { Config } from "../config/types.js";
import { buildManifest } from "../matrix/build.js";
import { MatrixError } from "../matrix/error.js";
import { checkManifest } from "../matrix/rules.js";
import type { StoryManifest } from "../matrix/types.js";
import { readSpecFiles, type SpecFile } from "../spec/load.js";
import { checkSpec, type ValidSpecFile } from "../spec/rules.js";
import type { Spec } from "../spec/types.js";
import { baseStyles } from "../tokens/base-styles.js";
import { buildTokens, TokenSetError } from "../tokens/build.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { TokenFinding, TokenSet } from "../tokens/types.js";

/** The name of a component's directory of generated files. */
export const generatedDirectory = "generated";
/** The manifest's file name in `generated/`. */
export const manifestFileName = "stories.json";
/**
 * The provenance file's name in `generated/`. `approve` and `accept` write it (M2); `sync` keeps it,
 * and removes it only with the rest of a component's generated files when its spec is gone.
 */
export const provenanceFileName = "provenance.json";

export interface SyncOptions {
  /** Write nothing; only report the files that differ (`fazon sync --check`). */
  readonly check: boolean;
}

/** Something that stops `sync`: a person has to fix a spec, the token set or a file first. */
export interface SyncProblem {
  /** The rule broken, such as `SPEC-002` or `TOKEN-002`, when there is one. */
  readonly rule?: string;
  /** Relative to the repository root, with `/` separators. */
  readonly file?: string;
  readonly line?: number;
  /** Where in the file's data, as a JSON path, or a token's dotted path. */
  readonly path?: string;
  readonly message: string;
  readonly hint?: string;
}

/**
 * How a file on disk differs from what `sync` generates: `added` when it doesn't exist, `modified`
 * when its content differs, `removed` when it's an orphan, a generated file no spec gives any more.
 */
export type FileChangeKind = "added" | "modified" | "removed";

export interface FileChange {
  /** Relative to the repository root, with `/` separators. */
  readonly path: string;
  readonly change: FileChangeKind;
}

export type SyncResult =
  | {
      readonly ok: true;
      /** The files written or removed; with `check`, the files that differ. Sorted by path. */
      readonly changes: readonly FileChange[];
      /** How many generated files were already up to date. */
      readonly unchanged: number;
      /** The components with a spec, in name order. */
      readonly components: readonly string[];
      /** Component directories whose spec is gone; their `generated/` directory is (or would be) removed. */
      readonly orphanedComponents: readonly string[];
      /**
       * Components not generated yet: their root file, such as `Button.vue`, doesn't exist, so they
       * get only their story manifest and data files, and no export. Each with the root file it waits for.
       */
      readonly pending: readonly PendingComponent[];
    }
  | { readonly ok: false; readonly problems: readonly SyncProblem[] };

/** A component with a spec whose root file doesn't exist yet. */
export interface PendingComponent {
  readonly component: string;
  /** The root file, relative to the repository root, with `/` separators. */
  readonly file: string;
}

/** What `sync` generates: every file's content, by path, and the components it covers. */
interface Plan {
  readonly files: ReadonlyMap<string, string>;
  readonly components: readonly string[];
  readonly pending: readonly PendingComponent[];
}

/**
 * Regenerates the token CSS, the themes module the Storybook preview imports (the adapter's
 * `themesFile`), every component's `generated/` directory and the entry file's exports from the
 * specs and the token set, or, with `check`, only compares them. Files whose content is
 * already right aren't rewritten; each file is replaced atomically. Generated files no spec gives
 * any more are removed: a component directory without a spec loses its `generated/` directory, and
 * a component's `generated/` directory loses files the adapter no longer writes, except its
 * provenance file.
 *
 * Until a component's root file exists (the adapter's `componentFiles`), the component is pending:
 * sync writes only its story manifest and the adapter's data files, with no story files, contract
 * tests or export, so the library and its checks build between `approve` and `generate`.
 *
 * Refuses, without writing anything, when a spec breaks a rule `spec check` checks, the token set
 * breaks a TOKEN rule, or the adapter can't write a component's files.
 * @param root the repository root
 */
export async function syncRepository(
  root: string,
  config: Config,
  adapter: Adapter,
  options: SyncOptions,
): Promise<SyncResult> {
  const planned = await plan(root, config, adapter);
  if ("problems" in planned) return { ok: false, problems: planned.problems };

  const changes: FileChange[] = [];
  let unchanged = 0;
  for (const [file, content] of planned.files) {
    const current = await readOptional(path.join(root, file));
    if (current === content) {
      unchanged++;
    } else {
      changes.push({ path: file, change: current === undefined ? "added" : "modified" });
    }
  }
  const orphans = await findOrphans(root, config, planned.components, new Set(planned.files.keys()));
  for (const file of orphans.files) changes.push({ path: file, change: "removed" });
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (!options.check) {
    for (const change of changes) {
      const target = path.join(root, change.path);
      if (change.change === "removed") {
        await rm(target, { force: true });
      } else {
        await writeAtomically(target, planned.files.get(change.path) ?? "");
      }
    }
    for (const directory of orphans.directories) {
      await rm(path.join(root, directory), { recursive: true, force: true });
    }
    for (const directory of orphans.emptied) {
      await removeEmptyDirectories(path.join(root, directory));
    }
  }

  return {
    ok: true,
    changes,
    unchanged,
    components: planned.components,
    orphanedComponents: orphans.components,
    pending: planned.pending,
  };
}

async function plan(root: string, config: Config, adapter: Adapter): Promise<Plan | { problems: SyncProblem[] }> {
  const problems: SyncProblem[] = [];

  const specs = await readSpecs(root, config.paths.specs, problems);
  const valid: ValidSpecFile[] = [];
  for (const file of specs) {
    const findings = checkSpec(file, specs);
    problems.push(
      ...findings.map((finding) => ({ ...finding, hint: finding.hint ?? `Run 'fazon spec check ${file.component}'.` })),
    );
    if (findings.length === 0 && file.spec !== undefined) valid.push({ ...file, spec: file.spec });
  }

  const tokens = await buildTokenCss(root, config, problems);
  if (tokens === undefined || problems.length > 0) return { problems };

  const files = new Map<string, string>();
  files.set(normalise(config.paths.tokensCss), tokens.css);

  // The themes module, for the Storybook preview: the default theme first, as the token CSS has them.
  const { themes, defaultTheme } = tokens.tokenSet;
  const themesFile = await adapter.themesFile({
    themes: [defaultTheme, ...themes.filter((theme) => theme !== defaultTheme)],
    defaultTheme,
  });
  const themesPath = normalise(themesFile.path);
  if (
    themesFile.path !== themesPath ||
    path.posix.isAbsolute(themesPath) ||
    themesPath.split("/").some((segment) => segment === ".." || segment === ".") ||
    files.has(themesPath) ||
    themesPath === normalise(config.paths.entry) ||
    themesPath.startsWith(`${normalise(config.paths.components)}/`)
  ) {
    throw new Error(`The ${adapter.id} adapter may not write its themes module at '${themesFile.path}'.`);
  }
  files.set(themesPath, themesFile.content);

  const components = config.paths.components;
  const styles = baseStyles(config.tokens.prefix ?? "");
  const entryComponents: EntryComponent[] = [];
  const pending: PendingComponent[] = [];
  for (const file of [...valid].sort((a, b) => (a.component < b.component ? -1 : 1))) {
    const directory = path.posix.join(normalise(components), file.component);
    const generated = path.posix.join(directory, generatedDirectory);
    const manifestFile = path.posix.join(generated, manifestFileName);

    let manifest: StoryManifest;
    try {
      manifest = buildManifest(file.spec, {
        file: file.file,
        themes: tokens.tokenSet.themes,
        defaultTheme: tokens.tokenSet.defaultTheme,
      });
    } catch (error) {
      if (!(error instanceof MatrixError)) throw error;
      problems.push({ ...error.toFinding(file), hint: "Fix the spec; the story matrix can't expand it." });
      continue;
    }
    const manifestFindings = checkManifest(manifest, manifestFile);
    if (manifestFindings.length > 0) {
      problems.push(...manifestFindings.map((finding) => ({ ...finding, hint: `Fix ${file.file}.` })));
      continue;
    }
    files.set(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    try {
      const generatedFiles = await adapter.generate({
        spec: file.spec,
        specFile: file.file,
        uses: Object.fromEntries(
          (file.spec.uses ?? []).flatMap((name) => {
            const used = valid.find((other) => other.spec.name === name);
            return used === undefined ? [] : [[name, used.spec]];
          }),
        ),
        manifest,
        directory,
        icons: config.icons,
        baseStyles: styles,
      });
      const own = rootFile(adapter, file.spec, directory);
      const generatedYet = await exists(path.join(root, own));
      if (generatedYet) {
        entryComponents.push({ spec: file.spec, directory });
      } else {
        pending.push({ component: file.component, file: own });
      }
      for (const { name, content, importsComponent } of generatedFiles) {
        if (
          !/^[^/\\]+$/.test(name) ||
          name === "." ||
          name === ".." ||
          name === manifestFileName ||
          name === provenanceFileName
        ) {
          throw new Error(`The ${adapter.id} adapter may not write '${name}' in ${generated}/ (ADAPTER-002).`);
        }
        // A pending component gets only its data files: what imports it would break the builds.
        if (generatedYet || !importsComponent) files.set(path.posix.join(generated, name), content);
      }
    } catch (error) {
      if (!(error instanceof AdapterError)) throw error;
      problems.push(adapterProblem(error, file.file));
      continue;
    }
  }

  const entry = normalise(config.paths.entry);
  try {
    const text = await readOptional(path.join(root, entry));
    files.set(entry, await adapter.entryFile({ file: entry, text, components: entryComponents }));
  } catch (error) {
    if (!(error instanceof AdapterError)) throw error;
    problems.push(adapterProblem(error, entry));
  }

  if (problems.length > 0) return { problems };
  return { files, components: valid.map((file) => file.component).sort(), pending };
}

/** The component's own file, as the adapter names it, relative to the repository root. */
function rootFile(adapter: Adapter, spec: Spec, directory: string): string {
  const own = adapter.componentFiles(spec).files.find((file) => file.part === undefined);
  if (own === undefined) throw new Error(`The ${adapter.id} adapter names no file for ${spec.name} itself.`);
  return path.posix.join(directory, own.file);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

async function readSpecs(root: string, directory: string, problems: SyncProblem[]): Promise<SpecFile[]> {
  try {
    return await readSpecFiles(root, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    problems.push({
      rule: "CONFIG-002",
      file: "fazon.yaml",
      message: `the specs directory '${directory}' doesn't exist`,
      hint: "Create it, or set paths.specs in fazon.yaml to where the specs are.",
    });
    return [];
  }
}

async function buildTokenCss(
  root: string,
  config: Config,
  problems: SyncProblem[],
): Promise<{ css: string; tokenSet: TokenSet } | undefined> {
  const tokenProblem = (finding: TokenFinding): SyncProblem => ({
    rule: finding.rule,
    file: finding.file === undefined ? normalise(config.paths.tokens) : relative(root, finding.file),
    ...(finding.path === "" ? {} : { path: finding.path }),
    message: finding.message,
    hint: "Fix the token set (docs/spec/tokens.md#rules).",
  });
  const resolved = await resolveTokenSet(path.join(root, config.paths.tokens));
  problems.push(...resolved.findings.map(tokenProblem));
  if (resolved.tokenSet === undefined) return undefined;
  try {
    const { css } = await buildTokens(resolved.tokenSet, { prefix: config.tokens.prefix ?? "" });
    return { css, tokenSet: resolved.tokenSet };
  } catch (error) {
    if (!(error instanceof TokenSetError)) throw error;
    problems.push(...error.findings.map(tokenProblem));
    return undefined;
  }
}

function adapterProblem(error: AdapterError, file: string): SyncProblem {
  return {
    file: error.file ?? file,
    message: error.message,
    ...(error.hint === undefined ? {} : { hint: error.hint }),
  };
}

interface Orphans {
  /** Files to remove, relative to the root. */
  readonly files: readonly string[];
  /** Whole `generated/` directories to remove: their component has no spec. */
  readonly directories: readonly string[];
  /** `generated/` directories that lose files; their empty subdirectories go too. */
  readonly emptied: readonly string[];
  /** The component directories without a spec that have a `generated/` directory. */
  readonly components: readonly string[];
}

/** The generated files no spec gives: every one of a component without a spec, and stale ones. */
async function findOrphans(
  root: string,
  config: Config,
  components: readonly string[],
  planned: ReadonlySet<string>,
): Promise<Orphans> {
  const base = normalise(config.paths.components);
  const result = {
    files: [] as string[],
    directories: [] as string[],
    emptied: [] as string[],
    components: [] as string[],
  };
  let entries;
  try {
    entries = await readdir(path.join(root, base), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const generated = path.posix.join(base, entry.name, generatedDirectory);
    const files = await listFiles(root, generated);
    if (files === undefined) continue;
    if (!components.includes(entry.name)) {
      result.components.push(path.posix.join(base, entry.name));
      result.directories.push(generated);
      result.files.push(...files);
      continue;
    }
    // The provenance file stays; the other files are the adapter's and the manifest, checked above.
    const stale = files.filter((file) => !planned.has(file) && file !== path.posix.join(generated, provenanceFileName));
    if (stale.length > 0) {
      result.files.push(...stale);
      result.emptied.push(generated);
    }
  }
  return result;
}

/** Every file under a directory, relative to the root; undefined when it doesn't exist. */
async function listFiles(root: string, directory: string): Promise<string[] | undefined> {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true, recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** Removes a directory's empty subdirectories, deepest first; the directory itself stays. */
async function removeEmptyDirectories(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((a, b) => b.length - a.length);
  for (const sub of directories) {
    try {
      await rmdir(sub);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
    }
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** Writes a file through a temporary file in the same directory, so a reader never sees it half written. */
async function writeAtomically(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(4).toString("hex")}.fazon-tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** A config path with `/` separators and no `./` or trailing slash. */
function normalise(file: string): string {
  return path.posix.normalize(file.split(path.sep).join("/")).replace(/\/$/, "");
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}
