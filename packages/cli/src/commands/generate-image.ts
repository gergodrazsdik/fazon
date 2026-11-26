// SPDX-License-Identifier: GPL-3.0-or-later
// The verifier image in a generate or feedback run (docs/spec/loop-and-caps.md#an-iteration, step
// 4): on the host, the environment the image needs, checked before the run starts, and the runner
// that starts the image on one iteration's checks, as `fazon verify` starts it, and stops it when
// the developer interrupts the run; inside the image, the entry that runs the iteration's checks
// (`fazon generate --in-image <run> --iteration <n> <component>`, internal options).
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  capturePlatform,
  checkIterationInImage,
  ociPlatform,
  runDirectory,
  runsDirectory,
  type ImageRunner,
} from "@fazon/core";
import { readComponent, type AgentCommandSetup, type Stop } from "../agent-run.js";
import {
  containerScratch,
  ensureImage,
  findRuntime,
  mountRoot,
  runArguments,
  type FoundRuntime,
} from "../container.js";
import { isSet, type Environment } from "../environment.js";
import { refused, type Outcome } from "../outcome.js";
import type { Context, Invocation } from "./context.js";
import { inImageCli, passedThrough } from "./verify.js";

/** Status `error` (exit 3): the environment can't run the image. */
function environmentError(text: string, hint?: string): Stop {
  return { stop: { status: "error", messages: [{ level: "error", text, ...(hint === undefined ? {} : { hint }) }] } };
}

/** The container a run's iteration runs in: named after the run, so the host can stop it. */
export function containerName(runId: string, iteration: number): string {
  return `fazon-${runId}-${String(iteration)}`;
}

export interface ContainerRunnerOptions {
  readonly environment: Environment;
  readonly runtime: FoundRuntime;
  readonly image: string;
  /** The mount root, the repository and the CLI's entry the image runs, on the host. */
  readonly root: string;
  readonly repo: string;
  readonly bin: string;
  /** The component, by its kebab-case name. */
  readonly component: string;
  /** Passes `--verbose` to the in-image part. */
  readonly verbose: boolean;
  /** Receives the image's standard error as it comes. */
  readonly stream: (text: string) => void;
  /** Stops the container after this long: the run-time cap. */
  readonly timeoutMs: number;
  /** How long to wait between attempts to stop a container that isn't running yet; 1 second by default. */
  readonly retryMs?: number;
}

/**
 * The image runner of a generate or feedback run: starts the verifier image on the in-image entry
 * for the run and iteration, with the same mounts, user and pinned image as `fazon verify`, and
 * no network. When the signal aborts or the timeout passes, it stops the container with
 * `<runtime> kill <name>`, retrying while the container hasn't started, and the exit is `null`.
 */
export function containerRunner(options: ContainerRunnerOptions): ImageRunner {
  const { environment, runtime } = options;
  const env = Object.fromEntries(
    passedThrough.filter((name) => isSet(environment, name)).map((name) => [name, environment.env[name] ?? ""]),
  );
  return async ({ runDir, iteration, signal }) => {
    if (signal.aborted) return { exitCode: null, output: "The run was interrupted before the checks started." };
    const id = path.basename(runDir);
    const name = containerName(id, iteration);
    const args = runArguments({
      runtime,
      image: options.image,
      root: options.root,
      repo: options.repo,
      runDir,
      bin: options.bin,
      args: [
        "generate",
        "--in-image",
        id,
        "--iteration",
        String(iteration),
        options.component,
        ...(options.verbose ? ["--verbose"] : []),
      ],
      env,
      name,
      ...(environment.user === undefined ? {} : { user: environment.user }),
    });

    let done = false;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopping ??= (async () => {
        while (!done) {
          const killed = await environment.exec(runtime.runtime, ["kill", name], { timeoutMs: 60_000 });
          if (killed?.exitCode === 0) return;
          await delay(options.retryMs ?? 1000);
        }
      })();
    };
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, options.timeoutMs);
    try {
      const result = await environment.exec(runtime.runtime, args, { stream: options.stream });
      if (result === undefined) return undefined;
      return {
        exitCode: stopping === undefined ? result.exitCode : null,
        output: `${result.stdout}${result.stderr}`,
      };
    } finally {
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      await stopping;
    }
  };
}

/**
 * What the image needs before a generate or feedback run starts, checked so that no call is
 * spent on a run whose checks can't run: linux/amd64 (the image runs the repository's installed
 * dependencies, as `fazon verify` does), a container runtime, the pinned image (pulled when it
 * isn't there), and a directory to mount. Each missing one is an error (3). Returns the runner.
 */
export async function prepareImage(setup: AgentCommandSetup, context: Context): Promise<ImageRunner | Stop> {
  const { environment } = context;
  const { repo, config } = setup;
  const platform = ociPlatform();
  if (platform !== capturePlatform) {
    return environmentError(
      `fazon generate runs the checks with the repository's installed dependencies in the verifier image, which is ${capturePlatform}; this machine is ${platform}. Run it on ${capturePlatform} until the image can install them itself.`,
    );
  }
  const runtime = await findRuntime(environment);
  if ("problem" in runtime) return environmentError(runtime.problem, "fazon doctor");
  const stream = (text: string) => {
    if (context.global.verbose || !context.global.json) context.stderr?.(text);
  };
  const pulled = await ensureImage(environment, runtime.runtime, config.image, stream);
  if (pulled !== undefined) return environmentError(pulled);
  const cli = await inImageCli(repo);
  const mount = await mountRoot(repo, cli.package);
  if ("problem" in mount) return environmentError(mount.problem);
  return containerRunner({
    environment,
    runtime,
    image: config.image,
    root: mount.root,
    repo,
    bin: cli.bin,
    component: setup.component,
    verbose: context.global.verbose,
    stream,
    timeoutMs: config.loop.runMinutes * 60_000,
  });
}

/** A run ID as `newRunId` makes it: no separator or dot, so it stays a directory of `.fazon/runs/`. */
const runIdPattern = /^[0-9A-Za-z][0-9A-Za-z-]*$/;

/**
 * The in-image part of one iteration's checks phase: every check over the whole library, with the
 * results in the run's `checks/<n>/checks.json` for the host to read. It writes no run record:
 * the host's loop owns it.
 */
export async function generateInImage(id: string, invocation: Invocation, context: Context): Promise<Outcome> {
  const iteration = Number(invocation.options.iteration);
  if (!runIdPattern.test(id) || !Number.isInteger(iteration) || iteration < 1) {
    return refused("--in-image is internal: it takes a run ID, with --iteration <n> from 1 and the component.");
  }
  const setup = await readComponent("generate", invocation, context);
  if ("stop" in setup) return setup.stop;
  const { repo, config, adapter, spec } = setup;
  const result = await checkIterationInImage({
    repo,
    runDir: runDirectory(repo, id),
    config,
    adapter,
    work: path.join(containerScratch, "work"),
    log: (text) => context.stderr?.(`${text}\n`),
    component: spec.spec.name,
    iteration,
  });
  const errored = result.checks.filter((check) => check.status === "error").map((check) => check.check);
  return {
    status: "ok",
    messages: [
      {
        level: "info",
        text: `The checks of iteration ${String(iteration)} ran${errored.length === 0 ? "" : ` (${errored.join(", ")} ended in error)`}; the results are in ${runsDirectory}/${id}/checks/${String(iteration)}/checks.json.`,
      },
    ],
  };
}
