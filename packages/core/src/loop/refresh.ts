// SPDX-License-Identifier: GPL-3.0-or-later
// The generated-files refresh of a generate or feedback run
// (docs/spec/agent-permissions.md#files-the-harness-maintains): the component's `generated/`
// directory and the entry file's exports, from the spec, through `fazon sync`'s code.
import path from "node:path";
import type { Adapter } from "../adapter.js";
import type { Config } from "../config/types.js";
import { generatedDirectory, syncRepository, type SyncProblem, type SyncResult } from "../sync/sync.js";

export interface RefreshOptions {
  /** The repository root, absolute. */
  readonly root: string;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The component, by its kebab-case name: `button`. */
  readonly name: string;
}

/** A path from the config with `/` separators and no leading `./` or trailing `/`. */
function posixPath(file: string): string {
  const normalised = path.posix.normalize(file.split(path.sep).join("/"));
  return normalised.endsWith("/") ? normalised.slice(0, -1) : normalised;
}

/**
 * The files a run's refresh may write: the component's `generated/` directory and the entry file.
 * Everything else `fazon sync` maintains (other components' generated files, the token CSS, the
 * Storybook themes module) is left to `fazon sync`; the `build` check's rule `generated` reports it
 * when it's stale.
 */
export function refreshScope(config: Config, name: string): (file: string) => boolean {
  const generated = `${path.posix.join(posixPath(config.paths.components), name, generatedDirectory)}/`;
  const entry = posixPath(config.paths.entry);
  return (file) => file === entry || file.startsWith(generated);
}

/**
 * Regenerates the component's `generated/` directory and the entry file from the spec, as
 * `fazon sync` does, writing only files whose content changes. Until the component's root file
 * exists, that is only its story manifest and data files (such as the approved API); once the agent
 * has written it, its story files and contract tests too, and its export. The result's `changes`
 * are the files written or removed; `ok: false` carries what stops sync, and nothing is written.
 */
export function refreshGenerated(options: RefreshOptions): Promise<SyncResult> {
  return syncRepository(options.root, options.config, options.adapter, {
    check: false,
    only: refreshScope(options.config, options.name),
  });
}

/** Thrown when the refresh at a run's start can't write the generated files. */
export class RefreshError extends Error {
  readonly problems: readonly SyncProblem[];
  constructor(problems: readonly SyncProblem[]) {
    super(
      `The generated files can't be refreshed:\n${problems.map((p) => `  ${p.rule === undefined ? "" : `${p.rule} `}${p.file === undefined ? "" : `${p.file}: `}${p.message}`).join("\n")}`,
    );
    this.name = "RefreshError";
    this.problems = problems;
  }
}

/**
 * The loop's `refreshGenerated` dependency: the refresh at the start of a generate or feedback
 * run. A refusal throws `RefreshError`, which ends the run at its first record; the command checks
 * the specs and token set before it starts the run, so this is a race.
 */
export function generatedRefresh(options: RefreshOptions): () => Promise<void> {
  return async () => {
    const result = await refreshGenerated(options);
    if (!result.ok) throw new RefreshError(result.problems);
  };
}
