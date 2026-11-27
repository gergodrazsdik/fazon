// SPDX-License-Identifier: GPL-3.0-or-later
// The part of a verify run that runs inside the verifier image (docs/spec/check-catalogue.md#where-checks-run):
// the Playwright check, a writable working copy of the read-only repository, the source checks,
// the rendered checks over the static Storybook build, the exemptions, and the run record after
// each phase.
import { spawn } from "node:child_process";
import { access, appendFile, cp, mkdir, readdir, readFile, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter, SourceCommand } from "../adapter.js";
import { launchRenderer, type Renderer } from "../checks/render.js";
import type { Config } from "../config/types.js";
import { loadTokenIndex } from "../lint/tokens.js";
import { syncRepository } from "../sync/sync.js";
import { loadComponents, type VerifyComponent } from "./components.js";
import {
  componentCheckStatuses,
  componentInputsHash,
  ociPlatform,
  writeVerifyDetails,
  type VerifyDetails,
} from "./details.js";
import { applyExemptions } from "./exemptions.js";
import { capturesDirectory, runRenderedChecks, skippedRenderedChecks, type RenderedChecksResult } from "./rendered.js";
import { readRunRecord, writeRunRecord, type CheckResult, type RunRecord } from "./run-record.js";
import { runSourceChecks, type CommandResult, type CommandRunner } from "./source-checks.js";
import { readStorybookIndex, serveDirectory, storybookRenderer } from "./storybook.js";

/** Where Playwright's browsers are in the verifier image. */
export const defaultBrowsersPath = "/ms-playwright";

/**
 * What's in the repository besides the checked files: left out of the working copy.
 * `.fazon-framework/` is where a consumer builds the framework from source until M5 (ADR 0022);
 * its packages are reached through the links in node_modules.
 */
const notCopied = new Set(["node_modules", ".git", ".fazon", ".fazon-framework"]);

export interface InImageOptions {
  /** The repository, read-only. */
  readonly repo: string;
  /** The run's directory, writable; the host wrote its first record. */
  readonly runDir: string;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The components to verify, by kebab-case name; all when empty. */
  readonly names: readonly string[];
  /** Where the writable working copy goes. */
  readonly work: string;
  /** For progress lines. */
  readonly log: (text: string) => void;
  /** PLAYWRIGHT_BROWSERS_PATH; the image's by default. */
  readonly browsersPath?: string;
}

export type InImageOutcome =
  | { readonly kind: "done"; readonly record: RunRecord }
  | { readonly kind: "environment"; readonly problems: readonly string[] };

/** The directory of a dependency's package, looked up in the `node_modules` directories from `from` up. */
export async function findPackage(from: string, name: string): Promise<string | undefined> {
  for (let directory = path.resolve(from); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    try {
      await access(path.join(candidate, "package.json"));
      return await realpath(candidate);
    } catch {
      // keep looking
    }
    if (path.dirname(directory) === directory) return undefined;
  }
}

interface BrowsersJson {
  readonly browsers: readonly { readonly name: string; readonly revision: string }[];
}

/**
 * The Playwright check (docs/spec/check-catalogue.md#where-checks-run): the Playwright the
 * repository installs, and the one the framework renders with, need Chromium builds the image
 * carries. Each problem says which version needs which build.
 */
export async function playwrightProblems(repo: string, browsersPath: string): Promise<string[]> {
  const problems: string[] = [];
  const own = await findPackage(path.dirname(fileURLToPath(import.meta.url)), "playwright-core");
  const consumer = await findPackage(repo, "playwright");
  const consumerCore = consumer === undefined ? undefined : await findPackage(consumer, "playwright-core");
  if (consumer === undefined || consumerCore === undefined) {
    problems.push(
      "The repository doesn't install Playwright (the `playwright` package), which the components' tests run in.",
    );
  }
  const installed = await readdir(browsersPath).catch(() => [] as string[]);
  for (const [who, dir] of [
    ["The repository's Playwright", consumerCore],
    ["Fazon's playwright-core", own],
  ] as const) {
    if (dir === undefined) continue;
    const version = (JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { version: string }).version;
    const browsers = JSON.parse(await readFile(path.join(dir, "browsers.json"), "utf8")) as BrowsersJson;
    for (const name of ["chromium", "chromium-headless-shell"]) {
      const revision = browsers.browsers.find((b) => b.name === name)?.revision;
      if (revision === undefined) continue;
      const folder = `${name.replace(/-/g, "_")}-${revision}`;
      if (!installed.includes(folder)) {
        problems.push(
          `${who} is version ${version}, which needs ${name} build ${revision}; the verifier image carries ${installed.filter((f) => f.startsWith("chromium")).join(", ") || "no Chromium"}. Install the Playwright version the image carries, or use the image this version of Fazon supports.`,
        );
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * A writable working copy of the repository: its files without node_modules, .git and .fazon,
 * and a node_modules directory of links to the repository's packages, so tools can write their
 * caches. Of node_modules' dot entries only pnpm's own are linked: the rest are tools' caches
 * (`.vite`, `.vite-temp`, `.cache`, `.vitest-cache`), which would point into the read-only mount.
 */
/** The dot entries of node_modules the working copy links: pnpm's store of packages, the executables and pnpm's state. */
const linkedDotEntries = new Set([".bin", ".pnpm", ".modules.yaml"]);

export async function makeWorkingCopy(repo: string, work: string, skip: readonly string[] = []): Promise<void> {
  await mkdir(work, { recursive: true });
  for (const entry of await readdir(repo, { withFileTypes: true })) {
    if (notCopied.has(entry.name) || skip.includes(entry.name)) continue;
    await cp(path.join(repo, entry.name), path.join(work, entry.name), { recursive: true, verbatimSymlinks: true });
  }
  const modules = path.join(repo, "node_modules");
  const linked = path.join(work, "node_modules");
  await mkdir(linked, { recursive: true });
  for (const entry of await readdir(modules, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") && !linkedDotEntries.has(entry.name)) continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      await mkdir(path.join(linked, entry.name), { recursive: true });
      for (const scoped of await readdir(path.join(modules, entry.name))) {
        await symlink(path.join(modules, entry.name, scoped), path.join(linked, entry.name, scoped));
      }
    } else {
      await symlink(path.join(modules, entry.name), path.join(linked, entry.name));
    }
  }
}

/** Runs source-check commands as processes, logging each one's output to `logs/<label>.log` in the run's directory. */
export function processRunner(runDir: string, env: NodeJS.ProcessEnv, timeoutMs = 20 * 60_000): CommandRunner {
  return async (command: SourceCommand, options) => {
    let program: string;
    let args: readonly string[];
    if ("program" in command) {
      program = command.program;
      args = command.args;
    } else {
      const dir = await findPackage(options.cwd, command.package);
      if (dir === undefined) {
        return { exitCode: 127, stdout: "", stderr: `The repository doesn't install ${command.package}.` };
      }
      const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
        bin?: string | Record<string, string>;
      };
      const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command.bin ?? command.package];
      if (bin === undefined)
        return {
          exitCode: 127,
          stdout: "",
          stderr: `${command.package} has no executable ${command.bin ?? command.package}.`,
        };
      program = process.execPath;
      args = [path.join(dir, bin), ...command.args];
    }
    const log = path.join(runDir, "logs", `${options.label}.log`);
    await mkdir(path.dirname(log), { recursive: true });
    await appendFile(log, `$ ${[program, ...args].join(" ")}\n(in ${options.cwd})\n`);
    return await new Promise<CommandResult>((resolve) => {
      const child = spawn(program, args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        void appendFile(log, `${stdout}\n${stderr}\nexit ${String(code ?? signal)}\n`).finally(() => {
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr: signal === null ? stderr : `${stderr}\n(stopped: ${signal})`,
          });
        });
      });
    });
  };
}

/** The run's verify part, ended: passed without a blocking finding or an error, else failed (records.md). */
export function finishRecord(record: RunRecord, checks: readonly CheckResult[], ended: Date): RunRecord {
  const errored = checks.some((check) => check.status === "error");
  const blocking = checks.some((check) => check.findings.some((finding) => finding.blocking));
  const failed = errored || blocking || checks.some((check) => check.status === "fail" || check.status === "skipped");
  const rest = { ...record } as { -readonly [K in keyof RunRecord]: RunRecord[K] };
  delete rest.reason;
  return {
    ...rest,
    status: failed ? "failed" : "passed",
    ...(errored ? { reason: "check-error" as const } : {}),
    ended: ended.toISOString().replace(/\.\d{3}Z$/, "Z"),
    verification: { checks: [...checks], captures: capturesDirectory },
    totals: { ...record.totals, durationSeconds: Math.round((ended.getTime() - Date.parse(record.started)) / 1000) },
  };
}

/** What `runImageChecks` needs besides `InImageOptions`: where its files go. */
export interface ImageChecksOptions extends InImageOptions {
  /**
   * Where the tools' logs (`logs/`), JSON reports (`reports/`), the static Storybook build
   * (`storybook/`) and the packed library (`package/`) go, absolute: the run's directory for a
   * verify run, `checks/<n>` in it for an agent run's iteration.
   */
  readonly output: string;
  /** The captures' and diff images' directory, relative to the run's directory: `captures`, or `captures/<n>`. */
  readonly captures: string;
  /** Called with the source checks' results before the rendered checks start, to record the step. */
  readonly sourceChecked?: (checks: readonly CheckResult[]) => Promise<void>;
  /**
   * How the run counts the checks, after the exemptions and before each component's statuses:
   * a generate run makes its component's visual diffs advisory. Unchanged by default.
   */
  readonly context?: (checks: CheckResult[]) => CheckResult[];
}

/** The checks' results with the exemptions applied, and what the run record has no field for. */
export type ImageChecksOutcome =
  | { readonly kind: "done"; readonly checks: CheckResult[]; readonly details: VerifyDetails }
  | { readonly kind: "environment"; readonly problems: readonly string[] };

/**
 * Runs every check in the verifier image (docs/spec/check-catalogue.md#order-and-results): the
 * Playwright check, then, in a writable working copy, the source checks and the rendered checks
 * of the named components (all when none is named), and the spec exemptions. Writes no record:
 * a verify run and an agent run's iteration each record the results their own way.
 */
export async function runImageChecks(options: ImageChecksOptions): Promise<ImageChecksOutcome> {
  const { repo, config, adapter, log, output } = options;
  const problems = await playwrightProblems(
    repo,
    options.browsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? defaultBrowsersPath,
  );
  if (problems.length > 0) return { kind: "environment", problems };

  const loaded = await loadComponents(repo, config, adapter);
  if (loaded.problems.length > 0) {
    return { kind: "environment", problems: loaded.problems.map((p) => `${p.file}: ${p.message}`) };
  }
  const all = loaded.components;
  const components = options.names.length === 0 ? all : all.filter((c) => options.names.includes(c.name));
  const inputs = new Map<string, string>();
  for (const component of components)
    inputs.set(component.name, await componentInputsHash(repo, component, config.paths.tokens));

  log("Copying the repository into a writable working copy");
  const work = options.work;
  // The baselines are read from the repository itself; a top-level directory of them isn't copied.
  await makeWorkingCopy(repo, work, config.paths.baselines.includes("/") ? [] : [config.paths.baselines]);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    STORYBOOK_DISABLE_TELEMETRY: "1",
    npm_config_cache: path.join(path.dirname(work), "npm-cache"),
    npm_config_update_notifier: "false",
  };
  const run = processRunner(output, env);
  const reports = {
    eslint: path.join(output, "reports", "eslint.json"),
    stylelint: path.join(output, "reports", "stylelint.json"),
    test: path.join(output, "reports", "vitest.json"),
  };
  await mkdir(path.join(output, "reports"), { recursive: true });
  const storybookDir = path.join(output, "storybook");
  const packDir = path.join(output, "package");
  const commands = adapter.sourceCommands({
    // A component with a spec but no root file yet has nothing to lint or test: only its
    // generated manifest and API, which the linters ignore.
    components: components.filter((c) => c.generated).map((c) => c.directory),
    storybookDir,
    packDir,
    reports,
  });

  log("Source checks: build, lint, test, package");
  const source = await runSourceChecks({
    root: work,
    components,
    adapter,
    commands,
    reports,
    packDir,
    run,
    generated: () => syncRepository(work, config, adapter, { check: true }),
  });
  await options.sourceChecked?.(source.checks);

  let rendered: RenderedChecksResult;
  if (!source.storybook) {
    rendered = {
      checks: skippedRenderedChecks("The static Storybook build failed (build rule storybook)."),
      stories: [],
      orphans: [],
      incomplete: [],
    };
  } else {
    log("Rendered checks: a11y, tokens, layout, visual");
    rendered = await renderStories(options, work, storybookDir, components, all);
  }

  const exemptions = applyExemptions(
    [...source.checks, ...rendered.checks].flatMap((check) => check.findings),
    all,
    rendered.elements,
  );
  let at = 0;
  const waived = [...source.checks, ...rendered.checks].map((check) => {
    const findings = exemptions.findings.slice(at, at + check.findings.length);
    at += check.findings.length;
    const status = check.status === "fail" && !findings.some((f) => f.blocking) ? "pass" : check.status;
    return { ...check, status, findings };
  });
  const checks = options.context?.(waived) ?? waived;

  const details: VerifyDetails = {
    fazon: 0,
    platform: ociPlatform(),
    components: components.map((component) => ({
      name: component.name,
      inputs: inputs.get(component.name) ?? "",
      checks: componentCheckStatuses(checks, component, all),
    })),
    stories: rendered.stories,
    orphans: rendered.orphans,
    incomplete: rendered.incomplete,
    unusedExemptions: exemptions.unused.filter((u) => components.some((c) => c.name === u.component)),
  };
  return { kind: "done", checks, details };
}

/** Runs every check of a verify run inside the verifier image. */
export async function verifyInImage(options: InImageOptions): Promise<InImageOutcome> {
  const { runDir } = options;
  const first = await readRunRecord(runDir);
  if (first === undefined) throw new Error(`The run's record is missing in ${runDir}.`);
  let record = first;
  const outcome = await runImageChecks({
    ...options,
    output: runDir,
    captures: capturesDirectory,
    sourceChecked: async (checks) => {
      record = { ...record, verification: { checks: [...checks] } };
      await writeRunRecord(runDir, record);
    },
  });
  if (outcome.kind === "environment") return outcome;
  await writeVerifyDetails(runDir, outcome.details);
  record = finishRecord(record, outcome.checks, new Date());
  await writeRunRecord(runDir, record);
  return { kind: "done", record };
}

async function renderStories(
  options: ImageChecksOptions,
  work: string,
  storybookDir: string,
  components: readonly VerifyComponent[],
  all: readonly VerifyComponent[],
): Promise<RenderedChecksResult> {
  const error = (message: string): RenderedChecksResult => ({
    checks: skippedRenderedChecks(message).map((check) => ({ ...check, status: "error" as const })),
    stories: [],
    orphans: [],
    incomplete: [],
  });
  let index;
  try {
    index = await loadTokenIndex({
      root: work,
      tokens: options.config.paths.tokens,
      prefix: options.config.tokens.prefix ?? "",
    });
  } catch (cause) {
    return error(`The token set can't be read: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let storybookIndex;
  try {
    storybookIndex = await readStorybookIndex(storybookDir);
  } catch (cause) {
    return error(
      `The Storybook build has no readable index.json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const server = await serveDirectory(storybookDir);
  let renderer: Renderer | undefined;
  try {
    renderer = await launchRenderer();
    let last = 0;
    return await runRenderedChecks({
      components,
      allComponents: all,
      named: options.names.length > 0,
      renderer: storybookRenderer(renderer, server.url),
      index,
      baselinesDir: path.join(options.repo, options.config.paths.baselines),
      image: options.config.image,
      runDir: options.runDir,
      captures: options.captures,
      storybookIndex,
      progress: (done, total) => {
        const step = Math.max(1, Math.floor(total / 10));
        if (done === total || done - last >= step) {
          last = done;
          options.log(`  rendered ${String(done)} of ${String(total)} story captures`);
        }
      },
    });
  } catch (cause) {
    return error(`The browser failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await renderer?.close();
    await server.close();
  }
}
