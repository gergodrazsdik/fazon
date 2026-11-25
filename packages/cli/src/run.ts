// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from "node:module";
import type { Adapter } from "@fazon/core";
import { vueAdapter } from "@fazon/adapter-vue";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const adapters: readonly Adapter[] = [vueAdapter];

const help = `fazon ${version}

Usage: fazon [--help | --version]

The commands arrive during milestone M1 (docs/spec/cli.md).
Adapters: ${adapters.map((adapter) => `${adapter.id} (${adapter.framework})`).join(", ")}
`;

export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs the CLI with its arguments (without the node and script paths) and returns the exit code. */
export function run(args: readonly string[], output: Output): number {
  const [first] = args;
  if (first === undefined || first === "--help" || first === "-h") {
    output.stdout(help);
    return 0;
  }
  if (first === "--version") {
    output.stdout(`${version}\n`);
    return 0;
  }
  output.stderr(`fazon: unknown command or option: ${first}\nRun 'fazon --help' for usage.\n`);
  return 2;
}
