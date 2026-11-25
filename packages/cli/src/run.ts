// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { Adapter } from "@fazon/core";
import { vueAdapter } from "@fazon/adapter-vue";
import { commandGroups, commands, findCommand, type Command } from "./commands.js";
import type { Context, GlobalOptions } from "./commands/context.js";
import { isSet, systemEnvironment, type Environment } from "./environment.js";
import { envelope, exitCodes, refused, type ExitCode, type Message, type Outcome } from "./outcome.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const adapters: readonly Adapter[] = [vueAdapter];

const globalOptions = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  json: { type: "boolean" },
  verbose: { type: "boolean" },
  "no-color": { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

/** Where the CLI writes; `colors` when the terminal shows them. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readonly colors?: boolean;
}

/** The CLI itself, as `command` in JSON, before or without a command. */
const cliName = "fazon";

/**
 * Runs the CLI with its arguments (without the node and script paths) and returns the exit code.
 * Commands see the machine only through `environment`, so tests can replace it.
 */
export async function run(
  args: readonly string[],
  io: Io,
  environment: Environment = systemEnvironment(),
): Promise<ExitCode> {
  // These options take no value, so they're known before the arguments are parsed, and even when
  // parsing fails: a usage error under --json is still one JSON document.
  const end = args.indexOf("--");
  const leading = end === -1 ? args : args.slice(0, end);
  const global: GlobalOptions = {
    json: leading.includes("--json"),
    verbose: leading.includes("--verbose"),
    color: io.colors === true && !leading.includes("--no-color") && !isSet(environment, "NO_COLOR"),
  };
  const context: Context = { environment, global };

  let command = cliName;
  let outcome: Outcome;
  try {
    ({ command, outcome } = await dispatch(args, context));
  } catch (error) {
    outcome = {
      status: "error",
      messages: [
        {
          level: "error",
          text: `fazon failed unexpectedly: ${error instanceof Error ? error.message : String(error)}. Run it again with --verbose for details, and report it at https://github.com/gergodrazsdik/fazon/issues if it happens again.`,
        },
      ],
    };
    if (global.verbose && error instanceof Error && error.stack !== undefined) {
      io.stderr(`${error.stack}\n`);
    }
  }

  if (global.json) {
    // CLI-001: one document on standard output, and nothing else there.
    io.stdout(`${JSON.stringify(envelope(command, outcome), null, 2)}\n`);
  } else {
    writeText(outcome, io, global.color);
  }
  return exitCodes[outcome.status];
}

async function dispatch(args: readonly string[], context: Context): Promise<{ command: string; outcome: Outcome }> {
  const words = commandWords(args);
  const [first] = words;
  if (first === undefined) {
    const parsed = parse(args, globalOptions, cliName);
    if ("refusal" in parsed) return { command: cliName, outcome: parsed.refusal };
    return { command: cliName, outcome: parsed.values.version === true ? versionOutcome() : helpOutcome(mainHelp()) };
  }

  let name = args[first] ?? "";
  const used = [first];
  if (commandGroups.has(name)) {
    const second = words[1];
    const subcommands = commands.filter((command) => command.name.startsWith(`${name} `));
    if (second === undefined) {
      if (args.includes("--help") || args.includes("-h")) {
        return { command: cliName, outcome: helpOutcome(groupHelp(name, subcommands)) };
      }
      const names = subcommands.map((command) => command.name.split(" ")[1]).join(" or ");
      return {
        command: cliName,
        outcome: refused(`fazon ${name} needs a subcommand: ${names}.`, `fazon ${name} --help`),
      };
    }
    name = `${name} ${args[second] ?? ""}`;
    used.push(second);
  }

  const command = findCommand(name);
  if (command === undefined) {
    return {
      command: cliName,
      outcome: refused(`'${name}' isn't a fazon command. Run 'fazon --help' for the list.`, "fazon --help"),
    };
  }
  const rest = args.filter((_, index) => !used.includes(index));

  if (command.run === undefined) {
    if (rest.includes("--help") || rest.includes("-h")) {
      return { command: command.name, outcome: helpOutcome(commandHelp(command)) };
    }
    return {
      command: command.name,
      outcome: refused(
        `fazon ${command.name} is not implemented yet; it arrives in ${command.arrives ?? "a later milestone"}. This version has: ${implemented().join(", ")}.`,
        "fazon --help",
      ),
    };
  }

  const parsed = parse(rest, { ...globalOptions, ...command.options }, command.name);
  if ("refusal" in parsed) return { command: command.name, outcome: parsed.refusal };
  if (parsed.values.help === true) {
    return { command: command.name, outcome: helpOutcome(commandHelp(command)) };
  }
  if (command.maxPositionals !== undefined && parsed.positionals.length > command.maxPositionals) {
    const extra = parsed.positionals.slice(command.maxPositionals).join(" ");
    return {
      command: command.name,
      outcome: refused(
        `fazon ${command.name} doesn't take '${extra}'. Usage: ${command.usage}`,
        `fazon ${command.name} --help`,
      ),
    };
  }
  const outcome = await command.run({ positionals: parsed.positionals, options: parsed.values }, context);
  return { command: command.name, outcome };
}

/** The indices of the arguments that aren't options, before `--`: the command's words come first. */
function commandWords(args: readonly string[]): number[] {
  const words: number[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg === "--") break;
    if (!arg.startsWith("-")) words.push(index);
  }
  return words;
}

type Parsed = ReturnType<typeof parseArgs<{ options: ParseArgsOptionsConfig; allowPositionals: true; strict: true }>>;

function parse(
  args: readonly string[],
  options: ParseArgsOptionsConfig,
  command: string,
): Parsed | { refusal: Outcome } {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (error) {
    const help = command === cliName ? "fazon --help" : `fazon ${command} --help`;
    const reason = error instanceof Error ? error.message.replace(/\.$/, "") : String(error);
    return { refusal: refused(`${reason}. Run '${help}' for the usage.`, help) };
  }
}

function implemented(): string[] {
  return commands.filter((command) => command.run !== undefined).map((command) => command.name);
}

function versionOutcome(): Outcome {
  return { status: "ok", messages: [], result: { version }, text: [{ stream: "stdout", text: version }] };
}

function helpOutcome(usage: string): Outcome {
  return { status: "ok", messages: [], result: { usage }, text: [{ stream: "stdout", text: usage.trimEnd() }] };
}

const globalHelp = `Global options:
  -h, --help    Show help; after a command, that command's usage.
  --version     Print the version.
  --json        Print one JSON document on standard output and nothing else.
  --verbose     Print more detail.
  --no-color    No colours in text output (also when NO_COLOR is set).
`;

function mainHelp(): string {
  const width = Math.max(...commands.map((command) => command.name.length)) + 2;
  const groups = [...new Set(commands.map((command) => command.group))];
  const lines = groups.flatMap((group) => [
    `${group}:`,
    ...commands
      .filter((command) => command.group === group)
      .map(
        (command) =>
          `  ${command.name.padEnd(width)}${command.summary}${command.arrives === undefined ? "" : ` (not implemented yet: ${command.arrives})`}`,
      ),
    "",
  ]);
  return `fazon ${version}: agent-built UI components from written specs, verified by rendering, checks and a vision judge.

Usage: fazon <command> [arguments] [options]

${lines.join("\n")}
${globalHelp}
Adapters: ${adapters.map((adapter) => `${adapter.id} (${adapter.framework})`).join(", ")}
Exit codes: 0 done, 1 checks failed or a person is needed, 2 refused or a usage or config error,
3 the environment or the tool failed, 130 interrupted.
`;
}

function groupHelp(group: string, subcommands: readonly Command[]): string {
  return `${subcommands.map((command) => `Usage: ${command.usage}\n  ${command.summary}`).join("\n\n")}\n\nRun 'fazon ${group} <subcommand> --help' for one of them.\n`;
}

function commandHelp(command: Command): string {
  const arrives = command.arrives === undefined ? "" : `\nNot implemented yet: it arrives in ${command.arrives}.\n`;
  return `Usage: ${command.usage}\n\n${command.summary}\n${arrives}\n${globalHelp}`;
}

const colors = { error: "\u001b[31m", warning: "\u001b[33m", dim: "\u001b[2m", reset: "\u001b[0m" } as const;

function writeText(outcome: Outcome, io: Io, color: boolean): void {
  const paint = (code: string, text: string) => (color ? `${code}${text}${colors.reset}` : text);
  for (const line of outcome.text ?? []) {
    io[line.stream](`${line.text}\n`);
  }
  for (const message of outcome.messages) {
    const write = message.level === "info" ? io.stdout : io.stderr;
    write(`${label(message, paint)}${message.text}\n`);
    if (message.hint !== undefined) {
      write(`${paint(colors.dim, "  next:")} ${message.hint}\n`);
    }
  }
}

function label({ level }: Message, paint: (code: string, text: string) => string): string {
  if (level === "info") return "";
  return `${paint(colors[level], `${level}:`)} `;
}
