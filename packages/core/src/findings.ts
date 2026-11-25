// SPDX-License-Identifier: GPL-3.0-or-later

/** A broken rule in one file: what `fazon spec check` and config validation report. */
export interface Finding {
  /** The rule's ID, such as `SPEC-001` or `CONFIG-004`. */
  readonly rule: string;
  /** The file, relative to the repository root, with `/` separators. */
  readonly file: string;
  /** Where in the file's data, as a JSON path such as `$.props.tone`. */
  readonly path?: string;
  /** The 1-based line in the file, when it can be told. */
  readonly line?: number;
  /** What is wrong. */
  readonly message: string;
  /** How to meet the rule, when the message alone doesn't say. */
  readonly hint?: string;
}
