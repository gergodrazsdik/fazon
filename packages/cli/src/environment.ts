// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile, spawn } from "node:child_process";
import type { JudgeClient, JudgeCredential } from "@fazon/core";

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  /** The working directory; the CLI's by default. */
  readonly cwd?: string;
  /** Stop the program after this long; 15 seconds by default. */
  readonly timeoutMs?: number;
  /** Receives the program's standard error as it comes, as for a long run in a container. */
  readonly stream?: (text: string) => void;
}

/** What the commands may know about the machine. Tests pass their own. */
export interface Environment {
  /** The directory fazon runs in: the repository root. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Node.js's version, without the `v`. */
  readonly nodeVersion: string;
  /** The user and group IDs the CLI runs as, where the platform has them; a container's files get them. */
  readonly user?: { readonly uid: number; readonly gid: number };
  /** The Claude Code executable the agent commands run; `claude` on the PATH when absent. */
  readonly claudeCode?: string;
  /** Aborted when the developer interrupts a run; the agent commands listen for SIGINT when absent. */
  readonly interrupt?: AbortSignal;
  /** The judge's API client for a credential; the SDK's when absent. Tests pass a fake. */
  readonly judgeClient?: (credential: JudgeCredential) => JudgeClient;
  /** Runs a program; `undefined` when it can't be started, as when it isn't installed. */
  exec(program: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult | undefined>;
}

const execTimeoutMs = 15_000;

export function systemEnvironment(): Environment {
  const user =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? { uid: process.getuid(), gid: process.getgid() }
      : undefined;
  return {
    cwd: process.cwd(),
    env: process.env,
    nodeVersion: process.versions.node,
    ...(user === undefined ? {} : { user }),
    exec: (program, args, options = {}) =>
      options.stream === undefined
        ? new Promise((resolve) => {
            execFile(
              program,
              args,
              {
                timeout: options.timeoutMs ?? execTimeoutMs,
                windowsHide: true,
                maxBuffer: 64 * 1024 * 1024,
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              },
              (error, stdout, stderr) => {
                if (error === null) {
                  resolve({ exitCode: 0, stdout, stderr });
                } else if (error.code === "ENOENT") {
                  resolve(undefined);
                } else {
                  resolve({
                    exitCode: typeof error.code === "number" ? error.code : 1,
                    stdout,
                    stderr: stderr || error.message,
                  });
                }
              },
            );
          })
        : streamed(program, args, options, options.stream),
  };
}

function streamed(
  program: string,
  args: readonly string[],
  options: ExecOptions,
  stream: (text: string) => void,
): Promise<ExecResult | undefined> {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    let stdout = "";
    let stderr = "";
    let started = true;
    const timer =
      options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      stream(text);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        started = false;
        resolve(undefined);
      } else {
        resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (started) resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/** Whether a variable is set: present and not empty, as NO_COLOR and CI are read. */
export function isSet(environment: Environment, name: string): boolean {
  const value = environment.env[name];
  return value !== undefined && value !== "";
}
