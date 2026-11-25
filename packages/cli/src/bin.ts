#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
