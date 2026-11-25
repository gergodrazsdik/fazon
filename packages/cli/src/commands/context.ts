// SPDX-License-Identifier: GPL-3.0-or-later
import { loadConfig, type Config, type ConfigLoad, type Finding } from "@fazon/core";
import { isSet, type Environment } from "../environment.js";
import type { Message, Outcome } from "../outcome.js";

export interface GlobalOptions {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
}

/** What a command runs with. */
export interface Context {
  readonly environment: Environment;
  readonly global: GlobalOptions;
}

/** A command's parsed arguments. */
export interface Invocation {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;
}

export function loadRepositoryConfig(context: Context): Promise<ConfigLoad> {
  return loadConfig(context.environment.cwd, { ci: isSet(context.environment, "CI") });
}

/** `file:line: path: message`, the way findings are written in text and in messages. */
export function describeFinding(finding: Finding, withRule = false): string {
  const location = finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
  const path = finding.path === undefined || finding.path === "$" ? "" : `${finding.path}: `;
  return `${location}: ${withRule ? `${finding.rule} ` : ""}${path}${finding.message}`;
}

/** The config's findings as error messages, each saying how to meet its rule. */
export function configMessages(load: Extract<ConfigLoad, { ok: false }>): Message[] {
  return load.findings.map((finding) => ({
    level: "error",
    text: `${describeFinding(finding, true)}.${finding.hint === undefined ? " See docs/spec/config.md for every key." : ` ${finding.hint}`}`,
    ...(load.missing ? { hint: "fazon init" } : {}),
  }));
}

/**
 * Every command except `init` and `doctor` reads and validates the config first, and refuses
 * (exit 2) when it can't be used.
 */
export async function requireConfig(context: Context): Promise<{ config: Config } | { refusal: Outcome }> {
  const load = await loadRepositoryConfig(context);
  if (load.ok) {
    return { config: load.config };
  }
  return { refusal: { status: "refused", messages: configMessages(load) } };
}
