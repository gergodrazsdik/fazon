// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the CLI's tests: a fake machine and a captured run. Not exported from the package.
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWithSchema } from "@fazon/core";
import type { Environment, ExecOptions, ExecResult } from "./environment.js";
import { run } from "./run.js";

export const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
export const minimalConfig = `fazon: 0\nadapter: vue\nimage: ${image}\n`;
/** The minimal config with the example library's token prefix, which its one-word components need to sync (ADR 0022). */
export const libraryConfig = `${minimalConfig}tokens:\n  prefix: fz\n`;
export const specExamples = fileURLToPath(new URL("../../../docs/spec/examples/specs/", import.meta.url));

export interface FakeMachine {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeVersion?: string;
  /** The Claude Code executable, as the agent commands run it. */
  readonly claudeCode?: string;
  readonly interrupt?: AbortSignal;
  /** The judge's API client; tests that make judge calls pass a fake. */
  readonly judgeClient?: Environment["judgeClient"];
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
  claudeCode,
  interrupt,
  judgeClient,
}: FakeMachine): Environment {
  return {
    cwd,
    env,
    nodeVersion,
    user: { uid: 1000, gid: 1000 },
    ...(claudeCode === undefined ? {} : { claudeCode }),
    ...(interrupt === undefined ? {} : { interrupt }),
    ...(judgeClient === undefined ? {} : { judgeClient }),
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

/** The core's fake Claude Code (packages/core/src/agent/test-support.ts), which @fazon/core doesn't export. */
interface AgentTestSupport {
  fakeClaude(): Promise<string>;
}

/** Writes the core's fake Claude Code into a temporary directory and returns its path; vitest loads it from the core's source. */
export async function fakeClaudeCode(): Promise<string> {
  const source = new URL("../../core/src/agent/test-support.ts", import.meta.url);
  const support = (await import(source.href)) as AgentTestSupport;
  return support.fakeClaude();
}

/** Makes a directory a git repository, as the agent call's snapshots need. */
export function gitInit(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", ["init", "--quiet", "."], { cwd: root }, (error) => {
      if (error === null) resolve();
      else reject(new Error(`git init failed: ${error.message}`));
    });
  });
}

/**
 * A judge API client that answers every image `pass`, except the labels in `failing`, and counts
 * its requests; it never reaches the network.
 */
export function fakeJudge(failing: ReadonlySet<string> = new Set()): {
  readonly client: NonNullable<Environment["judgeClient"]>;
  readonly requests: string[][];
} {
  const requests: string[][] = [];
  const client: NonNullable<Environment["judgeClient"]> = () => ({
    create: (params) => {
      const content = params.messages[0]?.content;
      const blocks = Array.isArray(content) ? content : [];
      const labels = blocks.flatMap((block) =>
        block.type === "text" ? [...block.text.matchAll(/^Image \d+, label `([^`]+)`/g)].map((m) => m[1] ?? "") : [],
      );
      requests.push(labels);
      const intro = blocks[1];
      const question = intro?.type === "text" ? (/Question `([^`]+)`/.exec(intro.text)?.[1] ?? "") : "";
      const results = labels.map((story) =>
        failing.has(story)
          ? { story, verdict: "fail", findings: [{ severity: "high", message: `${story} looks wrong` }] }
          : { story, verdict: "pass", findings: [] },
      );
      const message = {
        content: [{ type: "text", text: JSON.stringify({ question, results }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      return Promise.resolve(message as never);
    },
  });
  return { client, requests };
}
