// SPDX-License-Identifier: GPL-3.0-or-later
// What every agent prompt is built from (docs/spec/agent-permissions.md#what-the-agent-receives):
// Markdown sections, fenced files, the role tokens and the caps left.
import { tokenKind } from "../tokens/reference.js";
import type { TokenSet } from "../tokens/types.js";

/** A role token, as a prompt lists it. */
export interface RoleToken {
  /** The dotted path a spec and the component's CSS refer to, such as `color.action.primary`. */
  readonly path: string;
  /** Its `$type`. */
  readonly type: string;
}

/** The token set's role tokens, by path, each once: the tokens a component may use (docs/spec/tokens.md#raw-and-role-tokens). */
export function roleTokens(tokenSet: TokenSet): RoleToken[] {
  const found = new Map<string, string>();
  for (const file of tokenSet.files) {
    for (const token of file.tokens) {
      if (tokenKind(token) === "role" && !found.has(token.path)) found.set(token.path, token.type);
    }
  }
  return [...found].map(([path, type]) => ({ path, type })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The role tokens as a Markdown list, one `path (type)` per line. */
export function roleTokenList(tokens: readonly RoleToken[]): string {
  if (tokens.length === 0) return "The token set has no role tokens.";
  return tokens.map((token) => `- \`${token.path}\` (${token.type})`).join("\n");
}

/** A level-2 section: its heading, a blank line and its body. */
export function promptSection(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

/** A file's text in a fenced block, with a fence longer than any run of backticks in it. */
export function promptFence(text: string, info = ""): string {
  let longest = 0;
  let run = 0;
  for (const character of text) {
    run = character === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text.endsWith("\n") ? text : `${text}\n`}${fence}`;
}

/** What remains of a run's caps when a call starts. */
export interface CapsLeft {
  /** Calls left, this one included. */
  readonly iterations: number;
  readonly budgetUsd: number;
  readonly runMinutes: number;
}

/** The caps left, in a sentence for the agent. */
export function capsText(left: CapsLeft, callMinutes: number): string {
  const calls =
    left.iterations === 1
      ? "This is the run's last call"
      : `The run has ${String(left.iterations)} calls left, this one included`;
  return `${calls}. It has $${left.budgetUsd.toFixed(2)} of its budget and ${String(Math.floor(left.runMinutes))} minutes left; this call stops after ${String(callMinutes)} minutes.`;
}

/** The prompt from its sections, in order, each separated by a blank line. */
export function joinPrompt(parts: readonly string[]): string {
  return `${parts.map((part) => part.trim()).join("\n\n")}\n`;
}
