// SPDX-License-Identifier: GPL-3.0-or-later
// The component's files as a run's last agent call left them (ADR 0026): written to the run's
// directory after every call, and read by a feedback run that answers the run, whose first call's
// hand edits are the changes to the component's files since (docs/spec/agent-permissions.md#hand-edits).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { trimSlashes, type Snapshot } from "../agent/snapshot.js";
import { writeJsonAtomically } from "../records/json-file.js";
import { generatedDirectory } from "../sync/sync.js";

/** The file in a run's directory that holds the component's files after the run's last call. */
export const componentFilesFile = "component-files.json";

/** `component-files.json`: each file's fingerprint as the snapshot takes it, by path from the repository root. */
interface ComponentFilesDocument {
  readonly fazon: 0;
  /** The component's directory, from the repository root. */
  readonly directory: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * The part of a snapshot that a feedback run's hand edits compare: the files in the component's
 * directory, outside its `generated/` directory, which only the harness writes. The spec, the
 * other inputs and every other file are left out.
 */
export function componentFiles(snapshot: Snapshot, directory: string): Snapshot {
  const prefix = `${trimSlashes(directory)}/`;
  const generated = `${prefix}${generatedDirectory}/`;
  const files = new Map<string, string>();
  for (const [file, print] of snapshot.files) {
    if (file.startsWith(prefix) && !file.startsWith(generated)) files.set(file, print);
  }
  return { files };
}

/** Writes the component's files of a snapshot (`componentFiles`) to the run's directory, replacing the file atomically. */
export async function writeComponentFiles(runDir: string, directory: string, snapshot: Snapshot): Promise<void> {
  const document: ComponentFilesDocument = {
    fazon: 0,
    directory: trimSlashes(directory),
    files: Object.fromEntries(componentFiles(snapshot, directory).files),
  };
  await writeJsonAtomically(runDir, componentFilesFile, document);
}

/**
 * The component's files as a run's last call left them; undefined when the run wrote none (it
 * made no call, or a framework version before ADR 0026 ran it), or the file can't be read.
 */
export async function readComponentFiles(runDir: string): Promise<Snapshot | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(runDir, componentFilesFile), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { fazon, files } = parsed as Partial<Record<keyof ComponentFilesDocument, unknown>>;
  if (fazon !== 0 || typeof files !== "object" || files === null || Array.isArray(files)) return undefined;
  const entries = Object.entries(files as Record<string, unknown>);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return undefined;
  return { files: new Map(entries) };
}
