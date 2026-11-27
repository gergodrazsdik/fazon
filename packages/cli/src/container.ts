// SPDX-License-Identifier: GPL-3.0-or-later
// Running the verifier image on the host (docs/spec/cli.md#environment): the container runtime,
// the pinned image, and the `run` command for the in-image part of `fazon verify`. The repository
// is mounted read-only at a fixed path, with any directory its dependencies are linked from, and
// only the run's directory is writable. The container has no network.
import { access, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Environment } from "./environment.js";

export type Runtime = "docker" | "podman";
const runtimes: readonly Runtime[] = ["docker", "podman"];

/** Where the mounted directory is in the container. */
export const containerSource = "/fazon/src";
/** The writable scratch directory in the container: the working copy and caches. */
export const containerScratch = "/tmp/fazon-verify";

/** A container runtime command, and whether it is Podman (also when `docker` is Podman's alias). */
export interface FoundRuntime {
  readonly runtime: Runtime;
  readonly podman: boolean;
}

/** The runtime: FAZON_CONTAINER_RUNTIME, or the first of docker and podman that runs. */
export async function findRuntime(environment: Environment): Promise<FoundRuntime | { problem: string }> {
  const chosen = environment.env.FAZON_CONTAINER_RUNTIME;
  if (chosen !== undefined && chosen !== "") {
    if (!(runtimes as readonly string[]).includes(chosen)) {
      return { problem: `FAZON_CONTAINER_RUNTIME is '${chosen}', which is neither docker nor podman.` };
    }
    const result = await environment.exec(chosen, ["--version"]);
    return result?.exitCode === 0
      ? { runtime: chosen as Runtime, podman: /podman/i.test(result.stdout) }
      : {
          problem: `FAZON_CONTAINER_RUNTIME names ${chosen}, but '${chosen} --version' doesn't run. Install it, or set the variable to the runtime you have.`,
        };
  }
  for (const runtime of runtimes) {
    const result = await environment.exec(runtime, ["--version"]);
    if (result?.exitCode === 0) return { runtime, podman: /podman/i.test(result.stdout) };
  }
  return {
    problem:
      "Neither docker nor podman runs: install Docker (https://docs.docker.com/get-docker/) or Podman (https://podman.io/docs/installation).",
  };
}

/** Whether the image is on this machine (`<runtime> image inspect`); never pulls it. */
export async function hasImage(environment: Environment, runtime: Runtime, image: string): Promise<boolean> {
  const inspect = await environment.exec(runtime, ["image", "inspect", image], { timeoutMs: 60_000 });
  return inspect?.exitCode === 0;
}

/** Makes sure the image is there, pulling it for linux/amd64 when it isn't. */
export async function ensureImage(
  environment: Environment,
  runtime: Runtime,
  image: string,
  log: (text: string) => void,
): Promise<string | undefined> {
  if (await hasImage(environment, runtime, image)) return undefined;
  log(`Pulling the verifier image ${image}\n`);
  const pull = await environment.exec(runtime, ["pull", "--platform", "linux/amd64", image], {
    timeoutMs: 30 * 60_000,
    stream: log,
  });
  if (pull?.exitCode === 0) return undefined;
  return `The verifier image ${image} can't be pulled: ${(pull?.stderr ?? "").trim().split("\n").slice(-3).join(" ")}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function inside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The root of the project a linked directory belongs to: the part before its first `node_modules`
 * segment, or the nearest ancestor with a pnpm workspace, a git checkout or a lockfile.
 */
async function projectRoot(directory: string): Promise<string> {
  const segments = directory.split(path.sep);
  const modules = segments.indexOf("node_modules");
  if (modules > 0) return segments.slice(0, modules).join(path.sep) || path.sep;
  for (let current = directory; ; current = path.dirname(current)) {
    for (const marker of ["pnpm-workspace.yaml", ".git", "pnpm-lock.yaml", "package-lock.json"]) {
      if (await exists(path.join(current, marker))) return current;
    }
    if (path.dirname(current) === current) return directory;
  }
}

function commonAncestor(paths: readonly string[]): string {
  let common = paths[0] ?? path.sep;
  for (const other of paths.slice(1)) {
    while (!inside(other, common)) common = path.dirname(common);
  }
  return common;
}

/**
 * The directory to mount: the repository, or, when its dependencies (or this CLI) are linked from
 * outside it, as in a workspace or with `link:` dependencies, the nearest directory holding them
 * all. Refuses the file system's root.
 */
export async function mountRoot(repo: string, cliPackage: string): Promise<{ root: string } | { problem: string }> {
  const real = await realpath(repo);
  const roots = new Set<string>();
  const consider = async (entry: string) => {
    const target = await realpath(entry).catch(() => undefined);
    if (target !== undefined && !inside(target, real)) roots.add(await projectRoot(target));
  };
  await consider(cliPackage);
  const modules = path.join(real, "node_modules");
  for (const entry of await readdir(modules, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(path.join(modules, entry.name)).catch(() => [])) {
        await consider(path.join(modules, entry.name, scoped));
      }
    } else {
      await consider(path.join(modules, entry.name));
    }
  }
  const root = commonAncestor([real, ...roots]);
  if (path.dirname(root) === root) {
    return {
      problem: `The repository's dependencies are linked from ${[...roots].join(", ")}, which share no directory below the file system's root to mount into the verifier image.`,
    };
  }
  return { root };
}

/** A host path inside the mount root, as the container sees it. */
export function inContainer(root: string, file: string): string {
  const relative = path.relative(root, file).split(path.sep).join("/");
  return relative === "" ? containerSource : `${containerSource}/${relative}`;
}

export interface RunInImage {
  readonly runtime: FoundRuntime;
  readonly image: string;
  /** The mount root, on the host. */
  readonly root: string;
  /** The repository, the run's directory and the CLI's entry, on the host, inside `root`. */
  readonly repo: string;
  readonly runDir: string;
  readonly bin: string;
  /** The CLI's arguments after `node <bin>`. */
  readonly args: readonly string[];
  readonly user?: { readonly uid: number; readonly gid: number };
  /** Variables passed through, by name, when the host has them. */
  readonly env: Readonly<Record<string, string>>;
  /** The container's name, so the host can stop it (`<runtime> kill <name>`); the runtime picks one when absent. */
  readonly name?: string;
}

/**
 * The container runtime's arguments: linux/amd64, no network, the mount root read-only and the
 * run's directory writable, the host's user so the run's files are the developer's (Podman's
 * `keep-id`; Docker's `--user`), and no SELinux relabelling of the mounted checkout.
 */
export function runArguments(run: RunInImage): string[] {
  const user = run.runtime.podman
    ? ["--userns=keep-id"]
    : run.user === undefined
      ? []
      : ["--user", `${String(run.user.uid)}:${String(run.user.gid)}`];
  return [
    "run",
    "--rm",
    ...(run.name === undefined ? [] : ["--name", run.name]),
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--security-opt",
    "label=disable",
    ...user,
    "--env",
    `HOME=${containerScratch}/home`,
    ...Object.entries(run.env).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    "--volume",
    `${run.root}:${containerSource}:ro`,
    "--volume",
    `${run.runDir}:${inContainer(run.root, run.runDir)}:rw`,
    "--workdir",
    inContainer(run.root, run.repo),
    run.image,
    "node",
    inContainer(run.root, run.bin),
    ...run.args,
  ];
}
