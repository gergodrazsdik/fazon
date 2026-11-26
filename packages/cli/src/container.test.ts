// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRuntime, inContainer, mountRoot, runArguments, type RunInImage } from "./container.js";
import { fakeEnvironment } from "./test-support.js";

describe("the container runtime", () => {
  it("is FAZON_CONTAINER_RUNTIME, or the first of docker and podman that runs", async () => {
    const env = (programs: Record<string, string>, chosen?: string) =>
      fakeEnvironment({ cwd: "/", programs, env: chosen === undefined ? {} : { FAZON_CONTAINER_RUNTIME: chosen } });
    expect(await findRuntime(env({ docker: "Docker version 28", podman: "podman version 5" }))).toEqual({
      runtime: "docker",
      podman: false,
    });
    expect(await findRuntime(env({ podman: "podman version 5" }))).toEqual({ runtime: "podman", podman: true });
    // Podman's docker alias is Podman.
    expect(await findRuntime(env({ docker: "podman version 5.6.0" }))).toEqual({ runtime: "docker", podman: true });
    expect(await findRuntime(env({ docker: "Docker version 28", podman: "podman version 5" }, "podman"))).toMatchObject(
      {
        runtime: "podman",
      },
    );
    expect(await findRuntime(env({}, "nerdctl"))).toMatchObject({
      problem: expect.stringContaining("neither docker nor podman") as string,
    });
    expect(await findRuntime(env({}, "podman"))).toMatchObject({
      problem: expect.stringContaining("doesn't run") as string,
    });
    expect(await findRuntime(env({}))).toMatchObject({
      problem: expect.stringContaining("Neither docker nor podman runs") as string,
    });
  });
});

describe("the mount", () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "fazon-mount-")));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is the repository when everything it needs is in it", async () => {
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, "node_modules/fazon"), { recursive: true });
    expect(await mountRoot(repo, path.join(repo, "node_modules/fazon"))).toEqual({ root: repo });
  });

  it("holds dependencies linked from a workspace outside the repository", async () => {
    const repo = path.join(root, "work/repo");
    const workspace = path.join(root, "work/framework");
    await mkdir(path.join(workspace, "packages/cli"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules/.pnpm/vite@8/node_modules/vite"), { recursive: true });
    await writeFile(path.join(workspace, "pnpm-workspace.yaml"), "packages: []\n");
    await mkdir(path.join(repo, "node_modules/@scope"), { recursive: true });
    await symlink(
      path.join(workspace, "node_modules/.pnpm/vite@8/node_modules/vite"),
      path.join(repo, "node_modules/vite"),
    );
    await symlink(path.join(workspace, "packages/cli"), path.join(repo, "node_modules/@scope/cli"));
    expect(await mountRoot(repo, path.join(repo, "node_modules/@scope/cli"))).toEqual({
      root: path.join(root, "work"),
    });
    expect(inContainer(path.join(root, "work"), path.join(repo, ".fazon/runs/x"))).toBe(
      "/fazon/src/repo/.fazon/runs/x",
    );
  });
});

describe("the run command", () => {
  const run: RunInImage = {
    runtime: { runtime: "docker", podman: false },
    image: "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8),
    root: "/home/me/work",
    repo: "/home/me/work/library",
    runDir: "/home/me/work/library/.fazon/runs/20261126T100000Z-verify-abcd",
    bin: "/home/me/work/library/node_modules/fazon/dist/bin.js",
    args: ["verify", "--in-image", "20261126T100000Z-verify-abcd"],
    user: { uid: 1000, gid: 1000 },
    env: { CI: "true" },
  };

  it("runs linux/amd64 without network, the source read-only and only the run's directory writable", () => {
    expect(runArguments(run)).toEqual([
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "--security-opt",
      "label=disable",
      "--user",
      "1000:1000",
      "--env",
      "HOME=/tmp/fazon-verify/home",
      "--env",
      "CI=true",
      "--volume",
      "/home/me/work:/fazon/src:ro",
      "--volume",
      "/home/me/work/library/.fazon/runs/20261126T100000Z-verify-abcd:/fazon/src/library/.fazon/runs/20261126T100000Z-verify-abcd:rw",
      "--workdir",
      "/fazon/src/library",
      run.image,
      "node",
      "/fazon/src/library/node_modules/fazon/dist/bin.js",
      "verify",
      "--in-image",
      "20261126T100000Z-verify-abcd",
    ]);
  });

  it("keeps the host's user with Podman's keep-id", () => {
    const args = runArguments({ ...run, runtime: { runtime: "docker", podman: true } });
    expect(args).toContain("--userns=keep-id");
    expect(args).not.toContain("--user");
  });
});
