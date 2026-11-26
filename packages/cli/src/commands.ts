// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParseArgsOptionsConfig } from "node:util";
import type { Context, Invocation } from "./commands/context.js";
import { doctor } from "./commands/doctor.js";
import { baselineUpdate } from "./commands/baseline-update.js";
import { report } from "./commands/report.js";
import { specCheck } from "./commands/spec-check.js";
import { specNew } from "./commands/spec-new.js";
import { sync } from "./commands/sync.js";
import { verify } from "./commands/verify.js";
import type { Outcome } from "./outcome.js";

/** One command of docs/spec/cli.md. */
export interface Command {
  /** With its subcommand: `spec check`. */
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly group: "Setup" | "Specs" | "The loop" | "Repository" | "Measurement";
  /** Its own options, besides the global ones. */
  readonly options?: ParseArgsOptionsConfig;
  /** How many positional arguments it takes at most. */
  readonly maxPositionals?: number;
  /** Implemented commands run; the others say when they arrive. */
  readonly run?: (invocation: Invocation, context: Context) => Promise<Outcome>;
  readonly arrives?: string;
}

export const commands: readonly Command[] = [
  {
    name: "init",
    group: "Setup",
    usage: "fazon init [--adapter vue] [--dry-run]",
    summary: "Set a repository up to use Fazon.",
    arrives: "M5",
  },
  {
    name: "doctor",
    group: "Setup",
    usage: "fazon doctor",
    summary: "Check the environment and the config.",
    maxPositionals: 0,
    run: (_invocation, context) => doctor(context),
  },
  {
    name: "upgrade",
    group: "Setup",
    usage: "fazon upgrade",
    summary: "Point fazon.yaml at this version's verifier image.",
    arrives: "M5",
  },
  {
    name: "spec new",
    group: "Specs",
    usage: "fazon spec new <component> [--tier primitive|form-control|composite]",
    summary: "Write a spec from the template.",
    options: { tier: { type: "string" } },
    maxPositionals: 1,
    run: specNew,
  },
  {
    name: "spec check",
    group: "Specs",
    usage: "fazon spec check [<component>...]",
    summary: "Validate specs (SPEC-001 and SPEC-002 so far; the rest in M2).",
    run: specCheck,
  },
  {
    name: "propose",
    group: "The loop",
    usage: "fazon propose <component>",
    summary: "The agent drafts the API into the spec.",
    arrives: "M2",
  },
  {
    name: "approve",
    group: "The loop",
    usage: "fazon approve <component>",
    summary: "Approve the spec's API (decision 1).",
    arrives: "M2",
  },
  {
    name: "generate",
    group: "The loop",
    usage: "fazon generate <component> [--clean]",
    summary: "Run the loop until the checks pass or a cap is reached.",
    arrives: "M2",
  },
  {
    name: "feedback",
    group: "The loop",
    usage: "fazon feedback <component> (-m <text> | --file <path>)",
    summary: "Another round, with the developer's feedback.",
    arrives: "M2",
  },
  {
    name: "report",
    group: "The loop",
    usage: "fazon report [<component> | <run-id>] [--no-open] [--summary]",
    summary: "Build and open a run's report (M2); --summary prints a verify run's Markdown summary.",
    options: { summary: { type: "boolean" }, "no-open": { type: "boolean" } },
    maxPositionals: 1,
    run: report,
  },
  {
    name: "accept",
    group: "The loop",
    usage: "fazon accept <component>",
    summary: "Accept the latest run (decision 2).",
    arrives: "M2",
  },
  {
    name: "verify",
    group: "The loop",
    usage: "fazon verify [<component>...] [--base <ref>] [--no-judge]",
    summary: "Render and check components in the verifier image; --base marks the baselines that changed since a ref.",
    // `--in-image <run>` is internal: the host starts the image with it.
    options: { base: { type: "string" }, "no-judge": { type: "boolean" }, "in-image": { type: "string" } },
    run: verify,
  },
  {
    name: "judge",
    group: "The loop",
    usage: "fazon judge <run-id>",
    summary: "Run the judge for an earlier verify run.",
    arrives: "M3",
  },
  {
    name: "baseline update",
    group: "The loop",
    usage: "fazon baseline update (<component>... [--story <name>]... | --all)",
    summary: "Write baselines from the latest qualifying run, and remove orphans.",
    options: { story: { type: "string", multiple: true }, all: { type: "boolean" } },
    run: baselineUpdate,
  },
  {
    name: "sync",
    group: "Repository",
    usage: "fazon sync [--check]",
    summary: "Regenerate the generated files, the entry file's exports and the token CSS; --check only compares.",
    options: { check: { type: "boolean" } },
    maxPositionals: 0,
    run: sync,
  },
  {
    name: "runs",
    group: "Repository",
    usage: "fazon runs [<component>] [--limit <n>]",
    summary: "List runs, newest first.",
    arrives: "M2",
  },
  {
    name: "prune",
    group: "Repository",
    usage: "fazon prune [--keep <n>] [--older-than <days>]",
    summary: "Delete old run directories.",
    arrives: "M2",
  },
  {
    name: "measure",
    group: "Measurement",
    usage: "fazon measure --round <n> [<component>...] [--repeats <n>]",
    summary: "Make measured runs.",
    arrives: "M2",
  },
  {
    name: "calibrate",
    group: "Measurement",
    usage: "fazon calibrate --round <n> [--model <model>] --out <path>",
    summary: "A judge calibration round.",
    arrives: "M3",
  },
];

/** The first words of two-word commands: `spec`, `baseline`. */
export const commandGroups: ReadonlySet<string> = new Set(
  commands.filter((command) => command.name.includes(" ")).map((command) => command.name.split(" ")[0] ?? ""),
);

export function findCommand(name: string): Command | undefined {
  return commands.find((command) => command.name === name);
}
