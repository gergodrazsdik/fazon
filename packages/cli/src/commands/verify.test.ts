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
  fakeJudge,
  image,
  libraryConfig,
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
async function buttonRepository(config = libraryConfig): Promise<string> {
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
  /** Write a capture for every story and theme the manifest gives, for the judge to read. */
  readonly captures?: boolean;
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
        if (container.captures === true) {
          const manifest = JSON.parse(
            await readFile(path.join(root, "src/components/button/generated/stories.json"), "utf8"),
          ) as { stories: { name: string; judge: string[] }[] };
          for (const story of manifest.stories) {
            for (const theme of story.judge) {
              const file = path.join(dir, "captures", baselinePath(theme, "button", story.name));
              await mkdir(path.dirname(file), { recursive: true });
              await writeFile(file, png(200));
            }
          }
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
    expect(JSON.stringify(json.messages)).toContain("The judge didn't run: the judge needs ANTHROPIC_API_KEY");
    // No agent call and no judge: the record names neither version.
    const record = await readRunRecord(runDirectory(root, result.run));
    expect(record).toMatchObject({ kind: "verify", status: "passed", versions: { image } });
    expect(record?.versions).not.toHaveProperty("claudeCode");
    expect(record?.versions).not.toHaveProperty("judge");
  });

  it("runs the judge on the host once the checks pass, and records its summary and results", async () => {
    const judge = fakeJudge(new Set(["button--label--variant-ghost--size-md--default"]));
    const fake = machine(
      root,
      { checks: passing, captures: true },
      { env: { ANTHROPIC_API_KEY: "test-key" }, judgeClient: judge.client },
    );
    const { json, code } = await captureJson(["verify"], fake);
    // Before calibration, a fail is advisory: the run still passes (JUDGE-005).
    expect(code).toBe(0);
    const result = json.result as {
      run: string;
      judge: { ran: boolean; calls: number; stories: Record<string, number> };
    };
    expect(result.judge).toMatchObject({ ran: true, calls: 17, stories: { fail: 2, unsure: 0, notJudged: 0 } });
    expect(judge.requests).toHaveLength(17);
    const record = await readRunRecord(runDirectory(root, result.run));
    expect(record).toMatchObject({
      status: "passed",
      versions: { judge: 1 },
      config: { judgeCalibrated: false },
      verification: { judge: { calls: 17, blocking: false, results: "judge.json" } },
    });
    expect(record?.totals.judgeCostUsd).toBeCloseTo(17 * 0.003, 10);
    await expect(readFile(path.join(runDirectory(root, result.run), "judge.json"), "utf8")).resolves.toContain(
      '"judgeVersion": 1',
    );
    expect(JSON.stringify(json.messages)).toContain("It isn't calibrated yet, so its verdicts are advisory.");
    // The key never reaches the image (CLI-003).
    expect((fake.runs[0] ?? []).join(" ")).not.toMatch(/ANTHROPIC|test-key/);
  });

  it("doesn't run the judge when the checks fail", async () => {
    const judge = fakeJudge();
    const failing = passing.map((c): CheckResult => (c.check === "lint" ? { ...c, status: "fail" } : c));
    const fake = machine(
      root,
      { checks: failing, captures: true },
      { env: { ANTHROPIC_API_KEY: "k" }, judgeClient: judge.client },
    );
    const { json } = await captureJson(["verify"], fake);
    expect(judge.requests).toHaveLength(0);
    expect(json.result).toMatchObject({ judge: { ran: false, reason: "the checks didn't pass" } });
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

  it("compares the baselines with --base when the repository is a subdirectory of the checkout", async () => {
    const outer = await repository();
    try {
      const lib = path.join(outer, "packages/lib");
      await mkdir(path.dirname(lib), { recursive: true });
      await cp(root, lib, { recursive: true });
      const file = baselinePath("light", "button", "button--a");
      await mkdir(path.dirname(path.join(lib, "baselines", file)), { recursive: true });
      await writeFile(path.join(lib, "baselines", file), png(1));
      const identity = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
      await git("git", ["init", "--quiet"], { cwd: outer });
      await git("git", [...identity, "add", "."], { cwd: outer });
      await git("git", [...identity, "commit", "--quiet", "-m", "base"], { cwd: outer });
      await writeFile(path.join(lib, "baselines", file), png(2));

      const { json } = await captureJson(["verify", "--base", "HEAD", "--no-judge"], machine(lib, { checks: passing }));
      expect((json.result as { base: unknown }).base).toEqual({
        ref: "HEAD",
        changes: [{ path: file, mark: "changed" }],
      });
    } finally {
      await removeRepository(outer);
    }
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

describe("fazon judge", () => {
  let root: string;
  beforeEach(async () => {
    root = await buttonRepository(`${libraryConfig}judge:\n  ciBudgetUsd: 0.01\n`);
  });
  afterEach(async () => {
    await removeRepository(root);
  });

  /** A verify run without the judge, with a capture of every story. */
  async function verifyRun(): Promise<string> {
    const { json } = await captureJson(["verify", "--no-judge"], machine(root, { checks: passing, captures: true }));
    return (json.result as { run: string }).run;
  }

  it("refuses without a run, with an unknown one, and with one that isn't a verify run (2)", async () => {
    expect((await captureJson(["judge"], { cwd: root })).json).toMatchObject({ status: "refused", exitCode: 2 });
    expect((await captureJson(["judge", "20261127T000000Z-verify-0000"], { cwd: root })).json).toMatchObject({
      status: "refused",
      exitCode: 2,
    });
    const run = await verifyRun();
    const dir = runDirectory(root, run);
    const record = await readRunRecord(dir);
    if (record === undefined) throw new Error("no record");
    await writeRunRecord(dir, { ...record, kind: "generate", versions: { ...record.versions, claudeCode: "2.1.332" } });
    const { json } = await captureJson(["judge", run], { cwd: root });
    expect(json).toMatchObject({ status: "refused", exitCode: 2 });
    expect(JSON.stringify(json.messages)).toContain("is a generate run");
  });

  it("exits 3 without a credential", async () => {
    const run = await verifyRun();
    const { json } = await captureJson(["judge", run], { cwd: root });
    expect(json).toMatchObject({ status: "error", exitCode: 3 });
    expect(JSON.stringify(json.messages)).toContain("the judge needs ANTHROPIC_API_KEY");
  });

  it("judges the run and adds its summary to the record", async () => {
    const run = await verifyRun();
    const judge = fakeJudge();
    const { json, code } = await captureJson(["judge", run], {
      cwd: root,
      env: { ANTHROPIC_API_KEY: "k" },
      judgeClient: judge.client,
    });
    expect(code).toBe(0);
    expect(json.result).toMatchObject({ run, judge: { ran: true, calls: 17 } });
    const record = await readRunRecord(runDirectory(root, run));
    expect(record?.verification?.judge).toMatchObject({ calls: 17, blocking: false });
    expect(record?.versions.judge).toBe(1);
  });

  it("in CI, starts no call once the CI cap is spent, and reports the rest as not judged (JUDGE-004)", async () => {
    const run = await verifyRun();
    const judge = fakeJudge();
    const { json } = await captureJson(["judge", run], {
      cwd: root,
      env: { ANTHROPIC_API_KEY: "k", CI: "true" },
      judgeClient: judge.client,
    });
    // Each fake call costs $0.003 and the cap is $0.01: a request starts only while less than the
    // cap is spent, so after at most three finished calls, with up to four in flight.
    expect(judge.requests.length).toBeGreaterThanOrEqual(4);
    expect(judge.requests.length).toBeLessThanOrEqual(7);
    const results = JSON.parse(await readFile(path.join(runDirectory(root, run), "judge.json"), "utf8")) as {
      components: { outcome: { calls: { skipped?: string }[] } }[];
    };
    const skipped = results.components[0]?.outcome.calls.filter((call) => call.skipped !== undefined) ?? [];
    expect(skipped).toHaveLength(17 - judge.requests.length);
    expect(skipped[0]?.skipped).toBe("the judge's budget was spent");
    // A story-theme pair no call covered is reported as not judged; the rest got a verdict.
    const { stories } = (json.result as { judge: { stories: { pass: number; notJudged: number } } }).judge;
    expect(stories.pass + stories.notJudged).toBe(37);
  });
});
