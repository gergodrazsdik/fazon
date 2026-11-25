// SPDX-License-Identifier: GPL-3.0-or-later
// What a command ends with, and the `--json` envelope it becomes (docs/spec/cli.md#common-behaviour,
// docs/spec/schemas/cli-output.schema.json).

export type Status = "ok" | "failed" | "needs-a-person" | "refused" | "error" | "interrupted";

export type ExitCode = 0 | 1 | 2 | 3 | 130;

/** The exit code of each status (docs/spec/cli.md#exit-codes, CLI-002). */
export const exitCodes: Readonly<Record<Status, ExitCode>> = {
  ok: 0,
  failed: 1,
  "needs-a-person": 1,
  refused: 2,
  error: 3,
  interrupted: 130,
};

export interface Message {
  readonly level: "info" | "warning" | "error";
  /** What happened; for a refusal, which condition failed and how to meet it (CLI-005). */
  readonly text: string;
  /** A command to run next. */
  readonly hint?: string;
}

/** A line of text-mode output beyond the messages, such as one finding. */
export interface TextLine {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface Outcome {
  readonly status: Status;
  readonly messages: readonly Message[];
  /** The command's own result, for `--json`. */
  readonly result?: Readonly<Record<string, unknown>>;
  /** What text mode prints before the messages. */
  readonly text?: readonly TextLine[];
}

/** The document `--json` prints. */
export interface CliOutput {
  readonly fazon: 0;
  readonly command: string;
  readonly status: Status;
  readonly exitCode: ExitCode;
  readonly messages: readonly Message[];
  readonly result?: Readonly<Record<string, unknown>>;
}

export function envelope(command: string, outcome: Outcome): CliOutput {
  const { status, messages, result } = outcome;
  return {
    fazon: 0,
    command,
    status,
    exitCode: exitCodes[status],
    messages,
    ...(result === undefined ? {} : { result }),
  };
}

/** A precondition isn't met: exit 2. */
export function refused(text: string, hint?: string): Outcome {
  return { status: "refused", messages: [{ level: "error", text, ...(hint === undefined ? {} : { hint }) }] };
}
