// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile } from "node:child_process";

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the commands may know about the machine. Tests pass their own. */
export interface Environment {
  /** The directory fazon runs in: the repository root. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Node.js's version, without the `v`. */
  readonly nodeVersion: string;
  /** Runs a program; `undefined` when it can't be started, as when it isn't installed. */
  exec(program: string, args: readonly string[]): Promise<ExecResult | undefined>;
}

const execTimeoutMs = 15_000;

export function systemEnvironment(): Environment {
  return {
    cwd: process.cwd(),
    env: process.env,
    nodeVersion: process.versions.node,
    exec: (program, args) =>
      new Promise((resolve) => {
        execFile(program, args, { timeout: execTimeoutMs, windowsHide: true }, (error, stdout, stderr) => {
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
        });
      }),
  };
}

/** Whether a variable is set: present and not empty, as NO_COLOR and CI are read. */
export function isSet(environment: Environment, name: string): boolean {
  const value = environment.env[name];
  return value !== undefined && value !== "";
}
