// SPDX-License-Identifier: GPL-3.0-or-later
// JSON files the harness replaces atomically: the run record (RECORD-002) and the provenance file.
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes `value` as JSON (two-space indent, a final newline) to `<directory>/<name>`: first to a
 * temporary file in the same directory, then renamed over the target, so a reader never sees a
 * partly written file.
 */
export async function writeJsonAtomically(directory: string, name: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path.join(directory, name));
}

/** A UTC timestamp as the records write it: ISO 8601 without milliseconds, such as `2026-11-25T16:40:12Z`. */
export function recordTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A UTC date as the provenance file writes it, such as `2026-11-25`. */
export function recordDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
