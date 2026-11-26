// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  baselinePath,
  encodePng,
  listRunIds,
  readRunRecord,
  runDirectory,
  writeRunRecord,
  writeVerifyDetails,
  type CheckResult,
} from "@fazon/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecOptions, ExecResult } from "../environment.js";
import {
  capture,
  captureJson,
  copyExample,
  image,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

const git = promisify(execFile);
const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
const checks = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;

function png(shade: number): Uint8Array {
  return encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(shade) });
}

/** A repository with the example Button, its token set, and its generated files. */
async function buttonRepository(config = minimalConfig): Promise<string> {
  const root = await repository({
    "fazon.yaml": config,
    "src/components/button/Button.vue": "<template><button /></template>\n",
    // The CLI as the repository installs it, which the image runs.
    "node_modules/fazon/package.json": JSON.stringify({ name: "fazon", bin: { fazon: "./dist/bin.js" } }),
    "node_modules/fazon/dist/bin.js": "",
  });
  await copyExample(root, "valid/button.md", "specs/button.md");
  await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  const synced = await capture(["sync"], { cwd: root });
  if (synced.code !== 0) throw new Error(synced.stderr);
  return root;
}

interface Container {
  /** The record the checks end with; `undefined` leaves the first record as it was, as a crash does. */
  readonly checks?: CheckResult[];
  readonly exitCode?: number;
  readonly stderr?: string;
}

/** A machine with Docker and the image, whose `docker run` plays the checks in the image. */
function machine(
  root: string,
  container: Container = {},
  extra: Partial<FakeMachine> = {},
): FakeMachine & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    cwd: root,
    programs: { docker: "Docker version 28.0.0, build abc", git: "git version 2.50.0" },
    runs,
    handle: (
      program: string,
      args: readonly string[],
      options: ExecOptions | undefined,
    ): Promise<ExecResult | undefined> | undefined => {
      if (program === "git" && args[0] !== "--version") {
        return git("git", [...args], { cwd: options?.cwd ?? root }).then(
          ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
          (error: unknown) => ({ exitCode: 1, stdout: "", stderr: String(error) }),
        );
      }
      if (program !== "docker" || args[0] === "--version") return undefined;
      if (args[0] === "image") return Promise.resolve({ exitCode: 0, stdout: "[]", stderr: "" });
      if (args[0] !== "run") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
      runs.push([...args]);
      const id = args[args.indexOf("--in-image") + 1] ?? "";
      const dir = runDirectory(root, id);
      return (async () => {
        if (container.checks !== undefined) {
          const first = await readRunRecord(dir);
          if (first === undefined) throw new Error("the host wrote no record");
          const failed = container.checks.some((c) => c.status !== "pass");
          await writeRunRecord(dir, {
            ...first,
            status: failed ? "failed" : "passed",
            ended: first.started,
            verification: { checks: container.checks, captures: "captures" },
          });
          await writeVerifyDetails(dir, {
            fazon: 0,
            platform: "linux/amd64",
            components: [
              {
                name: "button",
                inputs: "sha256:" + "0".repeat(64),
                checks: Object.fromEntries(container.checks.map((c) => [c.check, c.status])),
              },
            ],
            stories: [
              {
                component: "button",
                story: "button--label--variant-primary--size-md--default",
                theme: "light",
                path: "light/button/label--variant-primary--size-md--default.png",
                status: "new",
              },
            ],
            orphans: [],
            incomplete: [],
            unusedExemptions: [],
          });
        }
        return { exitCode: container.exitCode ?? 0, stdout: "", stderr: container.stderr ?? "" };
      })();
    },
    ...extra,
  };
}

const passing = checks.map((check): CheckResult => ({ check, status: "pass", durationSeconds: 1, findings: [] }));

describe("fazon verify", () => {
  let root: string;
  beforeEach(async () => {
    root = await buttonRepository();
  });
  afterEach(async () => {
    await removeRepository(root);
  });

  it("runs the checks in the pinned image, without network, with the repository read-only", async () => {
    const fake = machine(root, { checks: passing });
    const { json, code } = await captureJson(["verify"], fake);
    expect(code).toBe(0);
    expect(json).toMatchObject({ command: "verify", status: "ok" });
    const result = json.result as { run: string; components: { component: string; checks: Record<string, string> }[] };
    expect(result.components).toEqual([
      expect.objectContaining({ component: "button", checks: Object.fromEntries(checks.map((c) => [c, "pass"])) }),
    ]);
    const [args = []] = fake.runs;
    expect(args.slice(0, 8)).toEqual([
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "--security-opt",
      "label=disable",
    ]);
    expect(args).toContain("--user");
    expect(args).toContain(`${await realpath(root)}:/fazon/src:ro`);
    const command = args.slice(args.indexOf(image));
    expect(command.slice(0, 2)).toEqual([image, "node"]);
    expect(command[2]).toBe("/fazon/src/node_modules/fazon/dist/bin.js");
    expect(command.slice(3)).toEqual(["verify", "--in-image", result.run]);
    expect(args.join(" ")).not.toMatch(/ANTHROPIC/);
    expect(JSON.stringify(json.messages)).toContain("The judge isn't available yet");
    // No agent call and no judge: the record names neither version.
    const record = await readRunRecord(runDirectory(root, result.run));
    expect(record).toMatchObject({ kind: "verify", status: "passed", versions: { image } });
    expect(record?.versions).not.toHaveProperty("claudeCode");
    expect(record?.versions).not.toHaveProperty("judge");
  });

  it("says nothing about the judge with --no-judge, and passes the component names on", async () => {
    const fake = machine(root, { checks: passing });
    const { json } = await captureJson(["verify", "button", "--no-judge"], fake);
    expect(JSON.stringify(json.messages)).not.toContain("judge");
    expect(fake.runs[0]?.slice(-1)).toEqual(["button"]);
  });

  it("fails (1) on a blocking finding, listing it", async () => {
    const failing = passing.map((c): CheckResult =>
      c.check === "lint"
        ? {
            ...c,
            status: "fail",
            findings: [
              {
                check: "lint",
                rule: "raw-value",
                message: "#2050d0 is a literal",
                file: "src/components/button/Button.vue",
                line: 3,
                blocking: true,
              },
            ],
          }
        : c,
    );
    const text = await capture(["verify", "--no-judge"], machine(root, { checks: failing }));
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("lint/raw-value src/components/button/Button.vue:3: #2050d0 is a literal");
    expect(text.stdout).toContain("button: build pass, lint fail");
    const [id = ""] = await listRunIds(root);
    expect(await readRunRecord(runDirectory(root, id))).toMatchObject({ status: "failed" });
    expect(await readRunRecord(runDirectory(root, id))).not.toHaveProperty("reason");
  });

  it("ends in error (3) when a check couldn't run", async () => {
    const errored = passing.map((c): CheckResult =>
      c.check === "a11y" ? { ...c, status: "error", message: "the browser crashed" } : c,
    );
    expect((await capture(["verify"], machine(root, { checks: errored }))).code).toBe(3);
  });

  it("ends in error (3) when the image couldn't run the checks, and closes the run's record", async () => {
    const { json, code } = await captureJson(
      ["verify"],
      machine(root, { exitCode: 3, stderr: "error: The repository's Playwright is version 1.70.0\n" }),
    );
    expect(code).toBe(3);
    expect(JSON.stringify(json.messages)).toContain("Playwright is version 1.70.0");
    const record = await readRunRecord(runDirectory(root, (json.result as { run: string }).run));
    expect(record).toMatchObject({ status: "failed", reason: "check-error" });
  });

  it("ends in error (3) without a container runtime or the image", async () => {
    expect((await captureJson(["verify"], { cwd: root })).json).toMatchObject({ status: "error", exitCode: 3 });
    const noPull = machine(root, {}, {});
    const handle = noPull.handle;
    const { json } = await captureJson(["verify"], {
      ...noPull,
      handle: (program, args, options) =>
        program === "docker" && (args[0] === "image" || args[0] === "pull")
          ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "manifest unknown" })
          : handle?.(program, args, options),
    });
    expect(json).toMatchObject({ status: "error", exitCode: 3 });
    expect(JSON.stringify(json.messages)).toContain("can't be pulled: manifest unknown");
  });

  it("refuses (2) a component without a spec, and a --base git doesn't know", async () => {
    expect((await captureJson(["verify", "dialog"], machine(root))).json).toMatchObject({ status: "refused" });
    await git("git", ["init", "--quiet"], { cwd: root });
    expect((await captureJson(["verify", "--base", "nope"], machine(root))).json).toMatchObject({ status: "refused" });
  });

  it("marks the baselines added, changed, removed or renamed since --base", async () => {
    const story = (name: string) => baselinePath("light", "button", `button--${name}`);
    const write = async (file: string, bytes: Uint8Array) => {
      await mkdir(path.dirname(path.join(root, "baselines", file)), { recursive: true });
      await writeFile(path.join(root, "baselines", file), bytes);
    };
    await write(story("a"), png(1));
    await write(story("b"), png(2));
    await write(story("old"), png(3));
    await git("git", ["init", "--quiet"], { cwd: root });
    await git(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "add", "."],
      { cwd: root },
    );
    await git(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "base",
      ],
      { cwd: root },
    );
    await write(story("b"), png(9));
    await write(story("new"), png(3));
    await rm(path.join(root, "baselines", story("old")));
    await write(story("c"), png(4));

    const { json } = await captureJson(["verify", "--base", "HEAD", "--no-judge"], machine(root, { checks: passing }));
    expect((json.result as { base: unknown }).base).toEqual({
      ref: "HEAD",
      changes: [
        { path: story("b"), mark: "changed" },
        { path: story("c"), mark: "added" },
        { path: story("new"), mark: "renamed", from: story("old") },
      ],
    });
    const run = (json.result as { run: string }).run;
    const details = JSON.parse(await readFile(path.join(runDirectory(root, run), "verify.json"), "utf8")) as {
      base: unknown;
    };
    expect(details.base).toEqual((json.result as { base: unknown }).base);
  });
});

describe("fazon baseline update", () => {
  let root: string;
  beforeEach(async () => {
    root = await buttonRepository();
  });
  afterEach(async () => {
    await removeRepository(root);
  });

  it.each([
    [["baseline", "update"], /Name the components to update, or pass --all/],
    [["baseline", "update", "--all", "button"], /--all updates every component/],
    [["baseline", "update", "tabs"], /No spec names tabs/],
    [["baseline", "update", "button", "--story", "button--nope"], /isn't a story of button/],
  ])("refuses (2) %j", async (args, message) => {
    const { json } = await captureJson(args, { cwd: root });
    expect(json).toMatchObject({ status: "refused", exitCode: 2 });
    expect(JSON.stringify(json.messages)).toMatch(message);
  });

  it("refuses (2) without a qualifying run, saying which condition failed", async () => {
    const { json } = await captureJson(["baseline", "update", "button"], { cwd: root });
    expect(json).toMatchObject({ status: "refused", exitCode: 2 });
    expect(JSON.stringify(json.messages)).toContain("Button has no finished run; run `fazon verify button` first.");
  });
});
