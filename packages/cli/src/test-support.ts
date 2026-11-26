// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the CLI's tests: a fake machine and a captured run. Not exported from the package.
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWithSchema } from "@fazon/core";
import type { Environment, ExecOptions, ExecResult } from "./environment.js";
import { run } from "./run.js";

export const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
export const minimalConfig = `fazon: 0\nadapter: vue\nimage: ${image}\n`;
export const specExamples = fileURLToPath(new URL("../../../docs/spec/examples/specs/", import.meta.url));

export interface FakeMachine {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion?: string;
  /** Installed programs, with what `<program> --version` prints. */
  readonly programs?: Readonly<Record<string, string>>;
  /** Runs a program other than with `--version`; `undefined` leaves it to the default (exit 1). */
  readonly handle?: (
    program: string,
    args: readonly string[],
    options: ExecOptions | undefined,
  ) => Promise<ExecResult | undefined> | undefined;
}

export function fakeEnvironment({
  cwd,
  env = {},
  nodeVersion = "26.13.1",
  programs = {},
  handle,
}: FakeMachine): Environment {
  return {
    cwd,
    env,
    nodeVersion,
    user: { uid: 1000, gid: 1000 },
    exec: (program, args, options) => {
      const handled = handle?.(program, args, options);
      if (handled !== undefined) return handled;
      const output = programs[program];
      if (output === undefined) return Promise.resolve(undefined);
      return Promise.resolve(
        args[0] === "--version"
          ? { exitCode: 0, stdout: `${output}\n`, stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "unexpected" },
      );
    },
  };
}

export interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function capture(args: readonly string[], machine: FakeMachine, colors = false): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await run(
    args,
    {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      colors,
    },
    fakeEnvironment(machine),
  );
  return { code, stdout, stderr };
}

/** Runs with --json and checks CLI-001: stdout holds one document, valid against the schema. */
export async function captureJson(
  args: readonly string[],
  machine: FakeMachine,
): Promise<Captured & { json: Record<string, unknown> }> {
  const captured = await capture([...args, "--json"], machine);
  const json = JSON.parse(captured.stdout) as Record<string, unknown>;
  const findings = validateWithSchema("cli-output", json);
  if (findings.length > 0) {
    throw new Error(`--json output breaks the CLI output schema: ${JSON.stringify(findings)}`);
  }
  if (json.exitCode !== captured.code) {
    throw new Error(`exitCode ${String(json.exitCode)} in the document, ${String(captured.code)} from the process`);
  }
  return { ...captured, json };
}

/** A temporary repository; the files map relative paths to their text. */
export async function repository(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fazon-cli-"));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

export async function copyExample(root: string, example: string, to: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, to)), { recursive: true });
  await copyFile(path.join(specExamples, example), path.join(root, to));
}

export function removeRepository(root: string): Promise<void> {
  return rm(root, { recursive: true, force: true });
}
