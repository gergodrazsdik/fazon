// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon generate` against the fake Claude Code and a fake verifier image: no real `claude -p`
// runs, and `docker run` plays the in-image checks by writing the iteration's `checks.json`.
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselinePath,
  encodePng,
  readRunRecord,
  runDirectory,
  runRecordProblems,
  type CheckFinding,
  type CheckResult,
} from "@fazon/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecResult } from "../environment.js";
import {
  capture,
  captureJson,
  copyExample,
  fakeClaudeCode,
  fakeJudge,
  gitInit,
  libraryConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
const checkIds = ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"] as const;
const button = "src/components/button/Button.vue";
const written = "<template><button><slot /></button></template>\n";

const rawValue: CheckFinding = {
  check: "tokens",
  rule: "raw-value",
  message: "color is #2050d0, a raw value; use a role token.",
  file: button,
  line: 4,
  blocking: true,
};

/** Every check of an iteration: passing, or failing with the findings given. */
function checks(findings: readonly CheckFinding[] = []): CheckResult[] {
  return checkIds.map((check) => {
    const own = findings.filter((finding) => finding.check === check);
    return { check, status: own.length > 0 ? "fail" : "pass", durationSeconds: 1, findings: own };
  });
}

let claude: string;
beforeAll(async () => {
  claude = await fakeClaudeCode();
});
afterAll(() => rm(path.dirname(claude), { recursive: true, force: true }));

let root: string;
beforeEach(async () => {
  root = await repository({
    "fazon.yaml": libraryConfig,
    ".gitignore": "node_modules/\n",
    // The CLI as the repository installs it, which the image runs.
    "node_modules/fazon/package.json": JSON.stringify({ name: "fazon", bin: { fazon: "./dist/bin.js" } }),
    "node_modules/fazon/dist/bin.js": "",
  });
  await copyExample(root, "valid/button.md", "specs/button.md");
  await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  for (const step of [["sync"], ["approve", "button"]]) {
    const ran = await capture(step, { cwd: root });
    if (ran.code !== 0) throw new Error(ran.stderr);
  }
  await gitInit(root);
});
afterEach(() => removeRepository(root));

interface Image {
  /** Each iteration's checks, by iteration from 1; every check passes when there's none. */
  readonly iterations?: readonly (readonly CheckResult[])[];
  /** Writes no results and exits with this code, as a crash does. */
  readonly crash?: number;
  /** Called when the container starts; the run waits until `docker kill` when it returns true. */
  readonly onStart?: () => boolean;
  /** Write a capture of every story the manifest gives, in each theme it's judged in. */
  readonly captures?: boolean;
}

interface Machine extends FakeMachine {
  /** The arguments of each `docker run`. */
  readonly runs: string[][];
  /** The names `docker kill` was called with. */
  readonly kills: string[];
}

function machine(image: Image = {}, env: Record<string, string> = {}, extra: Partial<FakeMachine> = {}): Machine {
  const runs: string[][] = [];
  const kills: string[] = [];
  let release: (() => void) | undefined;
  return {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      FAKE_CLAUDE_LOG: path.join(root, ".fazon", "fake.json"),
      FAKE_CLAUDE_EDITS: JSON.stringify({ [button]: written }),
      ...env,
    },
    programs: { [claude]: "2.1.332 (Claude Code)", docker: "Docker version 28.0.0, build abc" },
    claudeCode: claude,
    runs,
    kills,
    ...extra,
    handle: (program: string, args: readonly string[]) => {
      if (program !== "docker" || args[0] === "--version") return undefined;
      if (args[0] === "image") return Promise.resolve({ exitCode: 0, stdout: "[]", stderr: "" });
      if (args[0] === "kill") {
        kills.push(args[1] ?? "");
        const running = release;
        running?.();
        return Promise.resolve({ exitCode: running === undefined ? 1 : 0, stdout: "", stderr: "" });
      }
      if (args[0] !== "run") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
      runs.push([...args]);
      return (async (): Promise<ExecResult> => {
        if (image.onStart?.() === true) {
          await new Promise<void>((resolve) => (release = resolve));
          release = undefined;
          return { exitCode: 137, stdout: "", stderr: "" };
        }
        if (image.crash !== undefined) return { exitCode: image.crash, stdout: "", stderr: "Error: no space left\n" };
        const id = args[args.indexOf("--in-image") + 1] ?? "";
        const n = Number(args[args.indexOf("--iteration") + 1]);
        const dir = path.join(runDirectory(root, id), "checks", String(n));
        await mkdir(dir, { recursive: true });
        const result = {
          fazon: 0,
          iteration: n,
          checks: image.iterations?.[n - 1] ?? checks(),
          captures: `captures/${String(n)}`,
        };
        await writeFile(path.join(dir, "checks.json"), JSON.stringify(result));
        if (image.captures === true) {
          const manifest = JSON.parse(await read("src/components/button/generated/stories.json")) as {
            stories: { name: string; judge: string[] }[];
          };
          for (const story of manifest.stories) {
            for (const theme of story.judge) {
              const file = path.join(
                runDirectory(root, id),
                "captures",
                String(n),
                baselinePath(theme, "button", story.name),
              );
              await mkdir(path.dirname(file), { recursive: true });
              await writeFile(file, encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(200) }));
            }
          }
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      })();
    },
  };
}

const read = (file: string) => readFile(path.join(root, file), "utf8");
const exists = (file: string) =>
  access(path.join(root, file)).then(
    () => true,
    () => false,
  );
const runs = async () => readdir(path.join(root, ".fazon/runs")).catch(() => []);
const fakeLog = async () => JSON.parse(await read(".fazon/fake.json")) as { args: string[]; prompt: string };
const config = (loop: string) => writeFile(path.join(root, "fazon.yaml"), `${libraryConfig}loop:\n${loop}`);

describe("fazon generate", () => {
  it("runs the loop until the checks pass, with the record and the report", async () => {
    const fake = machine();
    const { code, json } = await captureJson(["generate", "button"], fake);
    expect(code, JSON.stringify(json.messages)).toBe(0);
    const [run = ""] = await runs();
    expect(json).toMatchObject({
      command: "generate",
      status: "ok",
      result: {
        run,
        kind: "generate",
        status: "passed",
        component: "Button",
        iterations: 1,
        costUsd: 0.4321,
        record: `.fazon/runs/${run}/run.json`,
        report: `.fazon/runs/${run}/report/index.html`,
      },
    });
    expect(json.result).not.toHaveProperty("removed");
    expect(json.messages).toContainEqual({
      level: "info",
      text: `Review the result in its report, .fazon/runs/${run}/report/index.html; then accept it (decision 2).`,
      hint: "fazon report button",
    });
    expect(await exists(`.fazon/runs/${run}/report/index.html`)).toBe(true);
    expect(await read(button)).toBe(written);

    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    expect(runRecordProblems(record)).toEqual([]);
    expect(record).toMatchObject({ kind: "generate", component: "Button", status: "passed", handEdits: [] });
    expect(record?.inputs).toHaveProperty("api");
    expect(record?.iterations[0]?.call.filesChanged).toEqual([button]);
    // The refresh before the checks wrote the story files and the export the root file waits for.
    expect(await read("src/index.ts")).toContain("Button");
    expect(await readdir(path.join(root, ".fazon/locks"))).toEqual([]);

    // The image runs the in-image entry for the run and iteration, as verify starts it.
    expect(fake.runs).toHaveLength(1);
    const args = fake.runs[0] ?? [];
    expect(args.slice(0, 4)).toEqual(["run", "--rm", "--name", `fazon-${run}-1`]);
    expect(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(args.slice(-6)).toEqual(["generate", "--in-image", run, "--iteration", "1", "button"]);

    const { args: claudeArgs, prompt } = await fakeLog();
    expect(claudeArgs[claudeArgs.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(prompt).toContain("# Generate the Button component");
    expect(prompt).toContain("This is the run's first call");
  });

  it("judges the iteration whose checks pass, counting its cost toward the run's budget", async () => {
    const judge = fakeJudge();
    const fake = machine({ captures: true }, { ANTHROPIC_API_KEY: "test-key" }, { judgeClient: judge.client });
    const { code, json } = await captureJson(["generate", "button"], fake);
    expect(code, JSON.stringify(json.messages)).toBe(0);
    expect(judge.requests).toHaveLength(17);
    const [run = ""] = await runs();
    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    expect(runRecordProblems(record)).toEqual([]);
    expect(record).toMatchObject({
      status: "passed",
      versions: { judge: 1 },
      config: { judgeCalibrated: false },
      iterations: [{ verification: { judge: { calls: 17, blocking: false, results: "judge/1.json" } } }],
    });
    expect(record?.totals.judgeCostUsd).toBeCloseTo(17 * 0.003, 4);
    expect(record?.totals.costUsd).toBeCloseTo(0.4321 + 17 * 0.003, 4);
    expect(await exists(`.fazon/runs/${run}/judge/1.json`)).toBe(true);
    // The key never reaches the image or Claude Code's sandboxed checks (CLI-003).
    expect((fake.runs[0] ?? []).join(" ")).not.toMatch(/test-key/);
  });

  it("says once that the judge didn't run without a credential", async () => {
    const { json } = await captureJson(["generate", "button"], machine());
    const warnings = (json.messages as { text: string }[]).filter((message) =>
      message.text.startsWith("The judge didn't run"),
    );
    expect(warnings).toHaveLength(1);
  });

  it("feeds a failing iteration's blocking findings into the next prompt", async () => {
    const { code, json } = await captureJson(["generate", "button"], machine({ iterations: [checks([rawValue])] }));
    expect(code).toBe(0);
    expect(json.result).toMatchObject({ status: "passed", iterations: 2 });
    const { prompt } = await fakeLog();
    expect(prompt).toContain("The checks after iteration 1 found these");
    expect(prompt).toContain("`tokens/raw-value` at `src/components/button/Button.vue:4`: color is #2050d0");
    const [run = ""] = await runs();
    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    expect(record?.iterations.map((iteration) => iteration.outcome)).toEqual(["fail", "pass"]);
  });

  it("escalates after two failed iterations and needs a person (1) when the calls run out", async () => {
    await config("  iterations: 3\n");
    const failing = checks([rawValue]);
    const { code, json } = await captureJson(
      ["generate", "button"],
      machine({ iterations: [failing, failing, failing] }),
    );
    expect(code).toBe(1);
    expect(json).toMatchObject({
      status: "needs-a-person",
      result: { status: "needs-a-person", reason: "iterations", iterations: 3 },
    });
    expect(json.messages).toContainEqual({
      level: "error",
      text: "Button: 3 of 3 iterations used; 1 blocking finding remains (tokens/raw-value).",
      hint: "fazon report button",
    });
    const [run = ""] = await runs();
    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    expect(record?.iterations.map((iteration) => iteration.call.model)).toEqual([
      "claude-sonnet-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
    ]);
    expect(record?.totals.escalated).toBe(true);
    expect(await exists(`.fazon/runs/${run}/report/index.html`)).toBe(true);
  });

  it("needs a person at the budget cap", async () => {
    await config("  budgetUsd: 0.5\n");
    const failing = checks([rawValue]);
    const { code, json } = await captureJson(["generate", "button"], machine({ iterations: [failing, failing] }));
    expect(code).toBe(1);
    expect(json.result).toMatchObject({ status: "needs-a-person", reason: "budget", iterations: 2 });
  });

  it("fails an iteration whose image wrote no results, and needs a person when it happens twice", async () => {
    const { code, json } = await captureJson(["generate", "button"], machine({ crash: 1 }));
    expect(code).toBe(1);
    expect(json.result).toMatchObject({ status: "needs-a-person", reason: "check-error", iterations: 2 });
    const [run = ""] = await runs();
    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    const message = record?.iterations[0]?.verification?.checks[0]?.message ?? "";
    expect(message).toBe("The checks couldn't run in the verifier image (exit 1):\nError: no space left");
  });

  it("stops the container and the run (130) when the developer interrupts the checks", async () => {
    const interrupt = new AbortController();
    const fake = machine(
      {
        onStart: () => {
          interrupt.abort();
          return true;
        },
      },
      {},
      { interrupt: interrupt.signal },
    );
    const { code, json } = await captureJson(["generate", "button"], fake);
    expect(code).toBe(130);
    expect(json.result).toMatchObject({ status: "stopped", iterations: 1 });
    const [run = ""] = await runs();
    // The interrupt came as the container started: the first kill found nothing to stop, and the
    // runner tried again until it stopped the container.
    expect(fake.kills).toEqual([`fazon-${run}-1`, `fazon-${run}-1`]);
    expect(await readdir(path.join(root, ".fazon/locks"))).toEqual([]);
  });

  it("--clean removes the component's own files outside generated/, and nothing else", async () => {
    const own = {
      [button]: "<template><span /></template>\n",
      "src/components/button/Button.test.ts": "// a behaviour test\n",
      "src/components/button/icons/check.svg": "<svg />\n",
    };
    const others = {
      "src/components/button-group/ButtonGroup.vue": "<template><div /></template>\n",
      "src/components/buttons.ts": "export {};\n",
      "src/shared.ts": "export {};\n",
    };
    for (const [file, text] of Object.entries({ ...own, ...others })) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    const generated = (await readdir(path.join(root, "src/components/button/generated"))).sort();

    const { code, json } = await captureJson(["generate", "button", "--clean"], machine());
    expect(code, JSON.stringify(json.messages)).toBe(0);
    const removed = Object.keys(own).sort();
    expect(json.result).toMatchObject({ removed });
    expect(json.messages).toContainEqual({
      level: "info",
      text: `--clean removed 3 files from src/components/button/, keeping generated/: ${removed.join(", ")}.`,
    });
    // The agent wrote the root file again; the other files it removed stay gone.
    expect(await read(button)).toBe(written);
    expect(await exists("src/components/button/Button.test.ts")).toBe(false);
    expect(await exists("src/components/button/icons")).toBe(false);
    for (const [file, text] of Object.entries(others)) expect(await read(file)).toBe(text);
    const after = await readdir(path.join(root, "src/components/button/generated"));
    for (const file of generated) expect(after).toContain(file);
    expect(await exists("src/components/button/generated/provenance.json")).toBe(true);

    const [run = ""] = await runs();
    const record = await readRunRecord(path.join(root, ".fazon/runs", run));
    expect(record?.handEdits).toEqual([]);
  });

  it("--clean says when there's nothing to remove", async () => {
    const { json } = await captureJson(["generate", "button", "--clean"], machine());
    expect(json.result).toMatchObject({ removed: [] });
    expect(json.messages).toContainEqual({
      level: "info",
      text: "--clean: src/components/button/ has no files outside generated/ to remove.",
    });
  });

  it("refuses (2) when the API isn't approved, or isn't the approved one", async () => {
    const provenance = "src/components/button/generated/provenance.json";
    const approved = JSON.parse(await read(provenance)) as { api: { hash: string; approved: string } };
    await writeFile(
      path.join(root, provenance),
      JSON.stringify({ ...approved, api: { ...approved.api, hash: `sha256:${"0".repeat(64)}` } }),
    );
    const changed = await captureJson(["generate", "button"], machine());
    expect(changed.code).toBe(2);
    expect(changed.json.messages).toEqual([
      {
        level: "error",
        text: `The API in specs/button.md isn't the one approved on ${approved.api.approved}: its hash is ${approved.api.hash}, the approved one sha256:${"0".repeat(64)}. Review the change, then approve it again.`,
        hint: "fazon approve button",
      },
    ]);

    await rm(path.join(root, provenance));
    const missing = await captureJson(["generate", "button"], machine());
    expect(missing.code).toBe(2);
    expect(missing.json.messages).toEqual([
      {
        level: "error",
        text: `Button's API isn't approved: ${provenance} doesn't exist. Review the API in specs/button.md, then approve it (decision 1).`,
        hint: "fazon approve button",
      },
    ]);
    expect(await runs()).toEqual([]);
    expect(await exists(".fazon/fake.json")).toBe(false);
  });

  it("refuses (2) while the component has a run in progress, and cleans nothing", async () => {
    await writeFile(path.join(root, button), "<template><span /></template>\n");
    await mkdir(path.join(root, ".fazon/locks"), { recursive: true });
    const holder = { run: "20261126T120000Z-button-3f9a", pid: process.pid, started: "2026-11-26T12:00:00.000Z" };
    await writeFile(path.join(root, ".fazon/locks/button.json"), JSON.stringify(holder));
    const fake = machine();
    const { code, json } = await captureJson(["generate", "button", "--clean"], fake);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: `Button has a run in progress: 20261126T120000Z-button-3f9a, started 2026-11-26T12:00:00.000Z by process ${String(process.pid)}. Wait for it to end, or stop it, before starting another.`,
        hint: "fazon runs",
      },
    ]);
    expect(await read(button)).toBe("<template><span /></template>\n");
    expect(await runs()).toEqual([]);
    expect(fake.runs).toEqual([]);
  });

  it("refuses (2) before any call when generated files outside the component are stale", async () => {
    await writeFile(path.join(root, button), "<template><span /></template>\n");
    await writeFile(path.join(root, "src/tokens.css"), "/* edited by hand */\n");
    const fake = machine();
    const { code, json } = await captureJson(["generate", "button", "--clean"], fake);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "1 generated file outside Button's differs from what the specs and the token set give: src/tokens.css (modified). The build check's rule generated would block every iteration, and the agent may not fix it: run fazon sync and commit the result first.",
        hint: "fazon sync",
      },
    ]);
    // Refused before --clean and before any call.
    expect(await read(button)).toBe("<template><span /></template>\n");
    expect(await exists(".fazon/fake.json")).toBe(false);
    expect(await runs()).toEqual([]);
    expect(await readdir(path.join(root, ".fazon/locks"))).toEqual([]);
  });

  it("ignores the component's own generated files and the entry file in the pre-flight", async () => {
    await writeFile(path.join(root, "src/index.ts"), "// stale\n");
    await rm(path.join(root, "src/components/button/generated/stories.json"));
    const { code, json } = await captureJson(["generate", "button"], machine());
    expect(code, JSON.stringify(json.messages)).toBe(0);
  });

  it("exits 3 without a container runtime or the image, before any call", async () => {
    const none = machine();
    const { code, json } = await captureJson(["generate", "button"], {
      ...none,
      programs: { [claude]: "2.1.332 (Claude Code)" },
    });
    expect(code).toBe(3);
    expect((json.messages as { text: string }[])[0]?.text).toMatch(/^Neither docker nor podman runs/);
    expect(await exists(".fazon/fake.json")).toBe(false);
    expect(await runs()).toEqual([]);
  });

  it("refuses to start (3) with a Claude Code older than the minimum", async () => {
    const { code } = await captureJson(["generate", "button"], {
      ...machine(),
      programs: { [claude]: "2.1.300 (Claude Code)", docker: "Docker version 28.0.0" },
    });
    expect(code).toBe(3);
    expect(await runs()).toEqual([]);
  });

  it("refuses (2) a spec with findings", async () => {
    const spec = await read("specs/button.md");
    await writeFile(
      path.join(root, "specs/button.md"),
      spec.replace("## Never\n", "## Never\n\n- TODO: a use or a look that is wrong.\n"),
    );
    const { code, json } = await captureJson(["generate", "button"], machine());
    expect(code).toBe(2);
    expect((json.messages as { text: string }[])[0]?.text).toBe(
      "specs/button.md has findings, so the component can't be generated from it: 1 finding. Fix it first.",
    );
  });

  it("refuses (2) a spec without fixtures whose API requires a slot, before the lock", async () => {
    const spec = await read("specs/button.md");
    const withoutFixtures = spec.slice(0, spec.indexOf("fixtures:\n")) + spec.slice(spec.indexOf("tokens:\n"));
    await writeFile(path.join(root, "specs/button.md"), withoutFixtures);
    const { code, json } = await captureJson(["generate", "button"], machine());
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "specs/button.md has no fixtures, so its stories would render the empty fixture, which doesn't set the slot default: Button requires it.",
        hint: "Add fixtures to specs/button.md first, then run 'fazon spec check button'; fixtures need no new approval.",
      },
    ]);
    expect(await runs()).toEqual([]);
    expect(await exists(".fazon/fake.json")).toBe(false);
  });

  it("refuses (2) the in-image entry without a run ID and an iteration", async () => {
    const { code } = await captureJson(["generate", "--in-image", "../elsewhere", "--iteration", "1", "button"], {
      cwd: root,
    });
    expect(code).toBe(2);
  });
});
