// SPDX-License-Identifier: GPL-3.0-or-later
// The source checks of a verify run (docs/spec/check-catalogue.md): `build` (`compile`, `types`,
// `storybook`, `generated`), `lint`, `test` and `package`, from the adapter's commands. The
// commands run through an injected runner, so the orchestration is tested without the tools.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Adapter, SourceCommand, SourceCommands } from "../adapter.js";
import type { CheckFinding, CheckId } from "../checks/types.js";
import { lintFindings, type EslintFileReport, type StylelintFileReport } from "../lint/report.js";
import type { SyncResult } from "../sync/sync.js";
import type { VerifyComponent } from "./components.js";
import {
  exportFindings,
  manifestFindings,
  readPackedPackage,
  stylesFindings,
  typesFindings,
  type EntryImport,
} from "./package-check.js";
import type { CheckResult } from "./run-record.js";

/** What a command printed and how it ended. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one command in a directory; `label` names its log. Rejects only when it can't be started. */
export type CommandRunner = (
  command: SourceCommand,
  options: { readonly cwd: string; readonly label: string },
) => Promise<CommandResult>;

export interface SourceChecksInput {
  /** The working copy the commands run in. */
  readonly root: string;
  /** The components the run covers. */
  readonly components: readonly VerifyComponent[];
  readonly adapter: Adapter;
  readonly commands: SourceCommands;
  readonly reports: { readonly eslint: string; readonly stylelint: string; readonly test: string };
  readonly packDir: string;
  readonly run: CommandRunner;
  /** `fazon sync --check` on the working copy: the `build` rule `generated`. */
  readonly generated: () => Promise<SyncResult>;
  /** The clock, in milliseconds; for durations. */
  readonly now?: () => number;
}

export interface SourceChecksResult {
  /** `build`, `lint`, `test` and `package`, in that order. */
  readonly checks: CheckResult[];
  /** Whether the static Storybook build succeeded: the rendered checks need it. */
  readonly storybook: boolean;
}

/** Terminal colours, which make no sense in a record. */
const ansiColours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The last lines of a command's output, for a finding's message. */
export function outputTail(result: CommandResult, lines = 20): string {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  const tail = text.split("\n").slice(-lines).join("\n");
  return tail.replace(ansiColours, "");
}

function describe(command: SourceCommand): string {
  return "package" in command
    ? `${command.bin ?? command.package} ${command.args.join(" ")}`
    : `${command.program} ${command.args.join(" ")}`;
}

/** TypeScript's diagnostics, `file(line,col): error TS1234: message`, as `types` findings. */
export function typeFindings(output: string, root: string): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const line of output.split("\n")) {
    // The location marker alone, without quantifiers around it that could overlap: the file is
    // what comes before it, the message what follows.
    const text = line.trim();
    const match = /\((\d+),(\d+)\): (?:error|warning) (TS\d+): /.exec(text);
    if (match === null || match.index === 0) continue;
    const [marker, row = "1", column = "1", code = ""] = match;
    const file = text.slice(0, match.index);
    const message = text.slice(match.index + marker.length);
    const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
    findings.push({
      check: "build",
      rule: "types",
      message: `${code}: ${message}`,
      file: relative.split(path.sep).join("/"),
      line: Number(row),
      column: Number(column),
      blocking: true,
    });
  }
  return findings;
}

/** `generated`: the files `fazon sync --check` finds different, or the problems that stop it. */
export function generatedFindings(result: SyncResult): CheckFinding[] {
  if (!result.ok) {
    return result.problems.map((problem) => ({
      check: "build",
      rule: "generated",
      message: `fazon sync can't generate the files: ${problem.rule === undefined ? "" : `${problem.rule} `}${problem.message}`,
      ...(problem.file === undefined ? {} : { file: problem.file }),
      ...(problem.line === undefined ? {} : { line: problem.line }),
      blocking: true,
    }));
  }
  const what = {
    added: "is missing",
    modified: "differs from what the specs give",
    removed: "is an orphan no spec gives",
  };
  return result.changes.map((change) => ({
    check: "build",
    rule: "generated",
    message: `${change.path} ${what[change.change]}; run \`fazon sync\` and commit the result.`,
    file: change.path,
    blocking: true,
  }));
}

/** One test file of Vitest's JSON report. */
export interface VitestFileReport {
  /** The test file's absolute path. */
  readonly name: string;
  readonly status: string;
  readonly message?: string;
  readonly assertionResults: readonly {
    readonly fullName: string;
    readonly status: string;
    readonly failureMessages?: readonly string[];
  }[];
}

/** Vitest's JSON report as `test` findings: failed tests by their rule, and components without a behaviour test. */
export function testFindings(
  files: readonly VitestFileReport[],
  root: string,
  components: readonly VerifyComponent[],
  rule: Adapter["testRule"],
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const behaviour = new Set<string>();
  for (const file of files) {
    const relative = path.relative(root, file.name).split(path.sep).join("/");
    if (file.assertionResults.length === 0 && file.status !== "passed") {
      findings.push({
        check: "test",
        rule: rule(relative, ""),
        message: `The test file failed to run: ${firstLine(file.message ?? "no message")}`,
        file: relative,
        blocking: true,
      });
    }
    for (const result of file.assertionResults) {
      const which = rule(relative, result.fullName);
      if (which === "behaviour" && result.status !== "skipped" && result.status !== "pending") {
        const owner = components.find((c) => relative.startsWith(`${c.directory}/`));
        if (owner !== undefined) behaviour.add(owner.name);
      }
      if (result.status !== "failed") continue;
      findings.push({
        check: "test",
        rule: which,
        message: `${result.fullName}: ${firstLine(result.failureMessages?.[0] ?? "failed")}`,
        file: relative,
        blocking: true,
      });
    }
  }
  for (const component of components) {
    if (!component.generated || behaviour.has(component.name)) continue;
    findings.push({
      check: "test",
      rule: "missing-behaviour",
      message: `${component.spec.name} has no behaviour test: write one next to the component, for the spec's Behaviour section and keyboard map.`,
      file: component.directory,
      blocking: true,
    });
  }
  return findings;
}

function firstLine(text: string): string {
  return (
    text
      .replace(ansiColours, "")
      .split("\n")
      .find((line) => line.trim() !== "") ?? text
  ).trim();
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function result(
  check: CheckId,
  started: number,
  now: () => number,
  findings: CheckFinding[],
  extra: Partial<CheckResult> = {},
): CheckResult {
  return {
    check,
    status: extra.status ?? (findings.length > 0 ? "fail" : "pass"),
    durationSeconds: Math.round((now() - started) / 100) / 10,
    ...(extra.message === undefined ? {} : { message: extra.message }),
    findings,
  };
}

/** Runs `build`, then `lint`, `test` and `package`. A check whose input a failed check didn't produce is skipped. */
export async function runSourceChecks(input: SourceChecksInput): Promise<SourceChecksResult> {
  const now = input.now ?? Date.now;
  const { root, commands, run } = input;
  const failure = (rule: string, command: SourceCommand, output: CommandResult): CheckFinding => ({
    check: "build",
    rule,
    message: `\`${describe(command)}\` failed (exit ${String(output.exitCode)}):\n${outputTail(output)}`,
    blocking: true,
  });

  // build
  let started = now();
  const build: CheckFinding[] = [];
  let compiled = true;
  for (const [index, command] of commands.compile.entries()) {
    const output = await run(command, { cwd: root, label: `build-compile-${String(index + 1)}` });
    if (output.exitCode !== 0) {
      build.push(failure("compile", command, output));
      compiled = false;
      break;
    }
  }
  const types = await run(commands.types, { cwd: root, label: "build-types" });
  if (types.exitCode !== 0) {
    const found = typeFindings(`${types.stdout}\n${types.stderr}`, root);
    build.push(...(found.length > 0 ? found : [failure("types", commands.types, types)]));
  }
  const storybook = await run(commands.storybook, { cwd: root, label: "build-storybook" });
  if (storybook.exitCode !== 0) build.push(failure("storybook", commands.storybook, storybook));
  build.push(...generatedFindings(await input.generated()));
  const checks: CheckResult[] = [result("build", started, now, build)];

  // lint
  started = now();
  const eslint = await run(commands.eslint, { cwd: root, label: "lint-eslint" });
  const stylelint = await run(commands.stylelint, { cwd: root, label: "lint-stylelint" });
  const eslintReport = await readJson<EslintFileReport[]>(input.reports.eslint);
  const stylelintReport = await readJson<StylelintFileReport[]>(input.reports.stylelint);
  if (eslintReport === undefined || stylelintReport === undefined || eslint.exitCode > 1) {
    const which =
      eslintReport === undefined || eslint.exitCode > 1
        ? { c: commands.eslint, o: eslint }
        : { c: commands.stylelint, o: stylelint };
    checks.push(
      result("lint", started, now, [], {
        status: "error",
        message: `\`${describe(which.c)}\` didn't write its report (exit ${String(which.o.exitCode)}):\n${outputTail(which.o)}`,
      }),
    );
  } else {
    const report = lintFindings({ eslint: eslintReport, stylelint: stylelintReport }, { root });
    checks.push(
      report.errors.length > 0
        ? result("lint", started, now, [...report.findings], { status: "error", message: report.errors.join("\n") })
        : result("lint", started, now, [...report.findings]),
    );
  }

  // test
  started = now();
  const test = await run(commands.test, { cwd: root, label: "test" });
  const testReport = await readJson<{ testResults?: VitestFileReport[] }>(input.reports.test);
  if (testReport?.testResults === undefined) {
    checks.push(
      result("test", started, now, [], {
        status: "error",
        message: `\`${describe(commands.test)}\` didn't write its report (exit ${String(test.exitCode)}):\n${outputTail(test)}`,
      }),
    );
  } else {
    const findings = testFindings(testReport.testResults, root, input.components, (file, name) =>
      input.adapter.testRule(file, name),
    );
    if (test.exitCode !== 0 && findings.length === 0) {
      findings.push({
        check: "test",
        rule: "behaviour",
        message: `\`${describe(commands.test)}\` failed (exit ${String(test.exitCode)}) without a failed test:\n${outputTail(test)}`,
        blocking: true,
      });
    }
    checks.push(result("test", started, now, findings));
  }

  // package
  started = now();
  if (!compiled) {
    checks.push(
      result("package", started, now, [], {
        status: "skipped",
        message: "The library build failed (build rule compile).",
      }),
    );
  } else {
    checks.push(await packageCheck(input, started, now));
  }

  return { checks, storybook: storybook.exitCode === 0 };
}

async function packageCheck(input: SourceChecksInput, started: number, now: () => number): Promise<CheckResult> {
  const { root, commands, run } = input;
  await mkdir(input.packDir, { recursive: true });
  const pack = await run(commands.pack, { cwd: root, label: "package-pack" });
  const tarballs = (await readdir(input.packDir)).filter((file) => file.endsWith(".tgz"));
  const [tarball] = tarballs;
  if (pack.exitCode !== 0 || tarball === undefined) {
    return result("package", started, now, [
      {
        check: "package",
        rule: "manifest",
        message: `\`${describe(commands.pack)}\` didn't pack the package (exit ${String(pack.exitCode)}):\n${outputTail(pack)}`,
        file: "package.json",
        blocking: true,
      },
    ]);
  }
  let unpacked;
  try {
    unpacked = readPackedPackage(new Uint8Array(await readFile(path.join(input.packDir, tarball))));
  } catch (error) {
    return result("package", started, now, [], {
      status: "error",
      message: `The packed tarball ${tarball} can't be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // The entry, imported from the unpacked tarball in a Node.js process of its own, with the
  // working copy's dependencies (such as the framework) in reach.
  const scratch = path.join(root, ".fazon-package");
  const target = path.join(scratch, "node_modules", unpacked.name);
  for (const file of unpacked.files) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), unpacked.text(file));
  }
  const probe = path.join(scratch, "probe.mjs");
  await writeFile(
    probe,
    `const names = Object.keys(await import(${JSON.stringify(unpacked.name)}));\nprocess.stdout.write(JSON.stringify(names));\n`,
  );
  const imported = await run({ program: "node", args: [probe] }, { cwd: scratch, label: "package-import" });
  let entry: EntryImport;
  try {
    entry =
      imported.exitCode === 0
        ? { ok: true, names: JSON.parse(imported.stdout) as string[] }
        : { ok: false, error: outputTail(imported, 5) };
  } catch {
    entry = { ok: false, error: outputTail(imported, 5) };
  }
  const components = input.components
    .filter((component) => component.generated)
    .map((component) => {
      const files = input.adapter.componentFiles(component.spec).files;
      return {
        file: `${component.directory}/${files[0]?.file ?? ""}`,
        exports: files.map((file) => file.exportName),
      };
    });

  const findings = [
    ...exportFindings(entry, components),
    ...(await typesFindings(unpacked, input.commands.typesResolutions)),
    ...stylesFindings(unpacked),
    ...(await manifestFindings(unpacked)),
  ];
  return result("package", started, now, findings);
}
