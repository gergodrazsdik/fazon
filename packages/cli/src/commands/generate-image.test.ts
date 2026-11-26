// SPDX-License-Identifier: GPL-3.0-or-later
// The image runner of a generate run against a fake container runtime, and the in-image entry
// outside the image, where its environment check ends every check in error.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { readIterationChecks, runDirectory } from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Environment, ExecResult } from "../environment.js";
import {
  captureJson,
  copyExample,
  fakeEnvironment,
  libraryConfig,
  removeRepository,
  repository,
} from "../test-support.js";
import { containerName, containerRunner } from "./generate-image.js";

let root: string;
beforeEach(async () => {
  root = await repository({ "fazon.yaml": libraryConfig });
  await copyExample(root, "valid/button.md", "specs/button.md");
});
afterEach(() => removeRepository(root));

const runId = "20261126T120000Z-button-3f9a";

/** A container runtime whose `run` waits until `kill` names its container. */
function hangingRuntime(): { environment: Environment; calls: string[][] } {
  const calls: string[][] = [];
  let release: ((result: ExecResult) => void) | undefined;
  const environment = fakeEnvironment({
    cwd: root,
    handle: (program, args) => {
      calls.push([program, ...args]);
      if (args[0] === "run") return new Promise((resolve) => (release = resolve));
      if (args[0] === "kill") {
        release?.({ exitCode: 137, stdout: "", stderr: "killed\n" });
        return Promise.resolve({ exitCode: release === undefined ? 1 : 0, stdout: "", stderr: "" });
      }
      return undefined;
    },
  });
  return { environment, calls };
}

function runner(environment: Environment, timeoutMs: number) {
  return containerRunner({
    environment,
    runtime: { runtime: "podman", podman: true },
    image: "ghcr.io/example/verifier@sha256:" + "0".repeat(64),
    root,
    repo: root,
    bin: path.join(root, "node_modules/fazon/dist/bin.js"),
    component: "button",
    verbose: false,
    stream: () => undefined,
    timeoutMs,
    retryMs: 5,
  });
}

describe("the image runner", () => {
  it("stops the container at the timeout, and says it was stopped", async () => {
    const { environment, calls } = hangingRuntime();
    const exit = await runner(
      environment,
      20,
    )({
      runDir: runDirectory(root, runId),
      iteration: 2,
      signal: new AbortController().signal,
    });
    expect(exit).toEqual({ exitCode: null, output: "killed\n" });
    const run = calls.find((call) => call[1] === "run") ?? [];
    expect(run).toContain("--userns=keep-id");
    expect(run.slice(run.indexOf("--name"), run.indexOf("--name") + 2)).toEqual(["--name", containerName(runId, 2)]);
    expect(calls.filter((call) => call[1] === "kill")).toEqual([["podman", "kill", `fazon-${runId}-2`]]);
  });

  it("starts no container once the run is interrupted", async () => {
    const { environment, calls } = hangingRuntime();
    const interrupt = new AbortController();
    interrupt.abort();
    const exit = await runner(
      environment,
      60_000,
    )({
      runDir: runDirectory(root, runId),
      iteration: 1,
      signal: interrupt.signal,
    });
    expect(exit?.exitCode).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is undefined when the runtime can't be started", async () => {
    const environment = fakeEnvironment({ cwd: root });
    const exit = await runner(
      environment,
      60_000,
    )({
      runDir: runDirectory(root, runId),
      iteration: 1,
      signal: new AbortController().signal,
    });
    expect(exit).toBeUndefined();
  });
});

describe("fazon generate --in-image", () => {
  it("writes the iteration's checks.json, every check in error where the image's tools are missing", async () => {
    const runDir = runDirectory(root, runId);
    await mkdir(runDir, { recursive: true });
    const { code, json } = await captureJson(["generate", "--in-image", runId, "--iteration", "1", "button"], {
      cwd: root,
    });
    expect(code, JSON.stringify(json.messages)).toBe(0);
    const result = await readIterationChecks(runDir, 1);
    expect(result?.checks.map((check) => check.status)).toEqual(Array(8).fill("error"));
    expect(result?.captures).toBe("captures/1");
    await rm(runDir, { recursive: true, force: true });
  });
});
