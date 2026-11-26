// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon feedback` against the fake Claude Code and a fake verifier image, as generate.test.ts runs
// `fazon generate`: no real `claude -p` runs, and `docker run` plays the in-image checks by writing
// the iteration's `checks.json`. Each `docker run` also keeps the prompt of the call before it.
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  linkedRuns,
  readRunRecord,
  runDirectory,
  runRecordProblems,
  type CheckFinding,
  type CheckResult,
  type RunRecord,
} from "@fazon/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecResult } from "../environment.js";
import {
  capture,
  captureJson,
  copyExample,
  fakeClaudeCode,
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
const feedbackHeading = "## The developer's feedback";

const rawValue: CheckFinding = {
  check: "tokens",
  rule: "raw-value",
  message: "color is #2050d0, a raw value; use a role token.",
  file: button,
  line: 4,
  blocking: true,
};
const targetSize: CheckFinding = {
  check: "layout",
  rule: "target-size",
  message: "The button is 20px tall; it needs 24px.",
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

interface Machine extends FakeMachine {
  /** The prompt of each call that the checks followed, in order. */
  readonly prompts: string[];
  /** The arguments of each `docker run`. */
  readonly runs: string[][];
}

/** A machine whose image gives each iteration the checks given, by iteration from 1; every check passes when there's none. */
function machine(iterations: readonly (readonly CheckResult[])[] = []): Machine {
  const prompts: string[] = [];
  const runs: string[][] = [];
  const log = path.join(root, ".fazon", "fake.json");
  return {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      FAKE_CLAUDE_LOG: log,
      FAKE_CLAUDE_EDITS: JSON.stringify({ [button]: written }),
    },
    programs: { [claude]: "2.1.332 (Claude Code)", docker: "Docker version 28.0.0, build abc" },
    claudeCode: claude,
    prompts,
    runs,
    handle: (program: string, args: readonly string[]) => {
      if (program !== "docker" || args[0] === "--version") return undefined;
      if (args[0] === "image") return Promise.resolve({ exitCode: 0, stdout: "[]", stderr: "" });
      if (args[0] !== "run") return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
      runs.push([...args]);
      return (async (): Promise<ExecResult> => {
        prompts.push((JSON.parse(await readFile(log, "utf8")) as { prompt: string }).prompt);
        const id = args[args.indexOf("--in-image") + 1] ?? "";
        const n = Number(args[args.indexOf("--iteration") + 1]);
        const dir = path.join(runDirectory(root, id), "checks", String(n));
        await mkdir(dir, { recursive: true });
        const result = {
          fazon: 0,
          iteration: n,
          checks: iterations[n - 1] ?? checks(),
          captures: `captures/${String(n)}`,
        };
        await writeFile(path.join(dir, "checks.json"), JSON.stringify(result));
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
const config = (loop: string) => writeFile(path.join(root, "fazon.yaml"), `${libraryConfig}loop:\n${loop}`);
const record = async (id: string) => {
  const found = await readRunRecord(runDirectory(root, id));
  if (found === undefined) throw new Error(`no record for ${id}`);
  return found;
};

/** Runs `fazon generate button` on a machine, and returns its run's ID. */
async function generate(fake: Machine = machine()): Promise<string> {
  const { json } = await captureJson(["generate", "button"], fake);
  const id = (json.result as { run?: string } | undefined)?.run;
  if (id === undefined) throw new Error(JSON.stringify(json.messages));
  return id;
}

/** Writes a run record under `.fazon/runs/<id>/`, from another one. */
async function writeRecord(id: string, from: RunRecord, changes: Partial<RunRecord>): Promise<void> {
  await mkdir(runDirectory(root, id), { recursive: true });
  await writeFile(path.join(runDirectory(root, id), "run.json"), JSON.stringify({ ...from, id, ...changes }));
}

describe("fazon feedback", () => {
  it("answers the latest run, with the feedback in every prompt and its findings in the first, fresh caps and the generator model", async () => {
    await config("  iterations: 3\n");
    const failing = checks([rawValue]);
    const parent = await generate(machine([failing, failing, failing]));
    const parentRecord = await record(parent);
    expect(parentRecord).toMatchObject({ status: "needs-a-person", reason: "iterations" });
    expect(parentRecord.iterations.at(-1)?.call.model).toBe("claude-opus-5-5");

    const fake = machine([checks([targetSize]), checks()]);
    const { code, json } = await captureJson(["feedback", "button", "-m", "  Make the label bolder.\n"], fake);
    expect(code, JSON.stringify(json.messages)).toBe(0);
    const run = (await runs()).find((id) => id !== parent) ?? "";
    expect(json).toMatchObject({
      command: "feedback",
      status: "ok",
      result: {
        run,
        kind: "feedback",
        status: "passed",
        parent,
        component: "Button",
        iterations: 2,
        record: `.fazon/runs/${run}/run.json`,
        report: `.fazon/runs/${run}/report/index.html`,
      },
    });
    expect((json.messages as unknown[])[0]).toEqual({
      level: "info",
      text: `This feedback run answers ${parent}: every prompt carries your feedback, and the first also carries the 1 blocking finding of that run's last checks.`,
    });
    expect(await exists(`.fazon/runs/${run}/report/index.html`)).toBe(true);

    const own = await record(run);
    expect(runRecordProblems(own)).toEqual([]);
    expect(own).toMatchObject({ kind: "feedback", parent, component: "Button", status: "passed", handEdits: [] });
    expect(own.inputs).toHaveProperty("api");
    // Fresh caps, and the generator model again although the parent ended on the escalation model.
    expect(own.iterations.map((iteration) => iteration.call.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
    expect(own.totals.escalated).toBe(false);
    expect((await linkedRuns(root, run)).map((linked) => linked.id)).toEqual([parent, run]);

    const [first = "", second = ""] = fake.prompts;
    expect(first).toContain(`${feedbackHeading}\n\nThe developer reviewed the previous run's result`);
    expect(first).toContain("```text\nMake the label bolder.\n```");
    expect(first).toContain("The previous run's last checks found these");
    expect(first).toContain("`tokens/raw-value` at `src/components/button/Button.vue:4`: color is #2050d0");
    expect(first).toContain("Iteration 1. Left, this call included: 3 calls, $10.00 of the run's budget");
    // The feedback goes into every prompt; the parent's findings into the first only.
    expect(second).toContain(feedbackHeading);
    expect(second).toContain("```text\nMake the label bolder.\n```");
    expect(second).not.toContain("tokens/raw-value");
    expect(second).toContain("The checks after iteration 1 found these");
    expect(second).toContain("`layout/target-size`");
    expect(second).toContain("Iteration 2. Left, this call included: 2 calls");
  });

  it("reads the feedback from --file, and answers a run that passed with no findings", async () => {
    const parent = await generate();
    await writeFile(
      path.join(root, "feedback.md"),
      "\uFEFF\nUse the brand colour for the focus ring.\n\nAnd round the corners.\n\n",
    );
    const fake = machine();
    const { code, json } = await captureJson(["feedback", "button", "--file", "feedback.md"], fake);
    expect(code, JSON.stringify(json.messages)).toBe(0);
    expect(json.result).toMatchObject({ kind: "feedback", status: "passed", parent, iterations: 1 });
    expect((json.messages as unknown[])[0]).toEqual({
      level: "info",
      text: `This feedback run answers ${parent}: every prompt carries your feedback, and that run left no findings that block.`,
    });
    const [prompt = ""] = fake.prompts;
    expect(prompt).toContain("```text\nUse the brand colour for the focus ring.\n\nAnd round the corners.\n```");
    expect(prompt).toContain("The previous run's checks left nothing to fix; work from the feedback above.");
  });

  it("needs a person (1) when the run's calls run out", async () => {
    const parent = await generate();
    await config("  iterations: 1\n");
    const { code, json } = await captureJson(
      ["feedback", "button", "-m", "Make it bigger."],
      machine([checks([targetSize])]),
    );
    expect(code).toBe(1);
    expect(json).toMatchObject({
      status: "needs-a-person",
      result: { kind: "feedback", status: "needs-a-person", reason: "iterations", iterations: 1, parent },
    });
    expect(json.messages).toContainEqual({
      level: "error",
      text: "Button: 1 of 1 iterations used; 1 blocking finding remains (layout/target-size).",
      hint: "fazon report button",
    });
  });

  it("answers the latest generate or feedback run of the component, passing over propose runs and other components", async () => {
    const generated = await record(await generate());
    await rm(path.join(root, ".fazon/runs"), { recursive: true });
    await writeRecord("20261126T100000Z-button-aaaa", generated, { kind: "generate" });
    await writeRecord("20261126T110000Z-button-bbbb", generated, {
      kind: "feedback",
      parent: "20261126T100000Z-button-aaaa",
      iterations: [],
    });
    await writeRecord("20261126T120000Z-button-cccc", generated, { kind: "propose", iterations: [] });
    await writeRecord("20261126T130000Z-button-group-dddd", generated, { component: "ButtonGroup" });
    const { code, json } = await captureJson(["feedback", "button", "-m", "Round the corners."], machine());
    expect(code, JSON.stringify(json.messages)).toBe(0);
    const run = (json.result as { run: string }).run;
    expect(json.result).toMatchObject({ parent: "20261126T110000Z-button-bbbb" });
    expect((await linkedRuns(root, run)).map((linked) => linked.id)).toEqual([
      "20261126T100000Z-button-aaaa",
      "20261126T110000Z-button-bbbb",
      run,
    ]);
  });

  it("refuses (2) when the component has no generate or feedback run", async () => {
    const generated = await record(await generate());
    await rm(path.join(root, ".fazon/runs"), { recursive: true });
    await writeRecord("20261126T120000Z-button-cccc", generated, { kind: "propose", iterations: [] });
    const fake = machine();
    const { code, json } = await captureJson(["feedback", "button", "-m", "Round the corners."], fake);
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "Button has no generate or feedback run to give feedback on. Generate it first; then review the run's report and give your feedback on it.",
        hint: "fazon generate button",
      },
    ]);
    expect(await runs()).toEqual(["20261126T120000Z-button-cccc"]);
    expect(fake.runs).toEqual([]);
  });

  it("refuses (2) when the latest run's record can't be read", async () => {
    await generate();
    await mkdir(runDirectory(root, "20991231T000000Z-button-ffff"), { recursive: true });
    const { code, json } = await captureJson(["feedback", "button", "-m", "Round the corners."], machine());
    expect(code).toBe(2);
    expect((json.messages as { text: string }[])[0]?.text).toBe(
      "The run record of Button's latest run, .fazon/runs/20991231T000000Z-button-ffff/run.json, is missing or can't be read, so fazon can't tell which run the feedback answers. Delete that run's directory if it's no longer needed, or generate again.",
    );
  });

  it.each([
    [[], "fazon feedback needs your feedback: give it as -m <text>, or as --file <path> for a longer text."],
    [
      ["-m", "a", "--file", "b.md"],
      "fazon feedback takes your feedback once: one -m <text> or one --file <path>, not 2.",
    ],
    [["-m", "a", "-m", "b"], "fazon feedback takes your feedback once: one -m <text> or one --file <path>, not 2."],
    [["-m", " \n "], "The feedback given with -m is empty. Say in plain words what the next run should change."],
    [["--file", "empty.md"], "The feedback in empty.md is empty. Say in plain words what the next run should change."],
    [
      ["--file", "missing.md"],
      "The feedback file missing.md can't be read: it doesn't exist. Give the path to a text file, or the text as -m <text>.",
    ],
    [
      ["--file", "specs"],
      "The feedback file specs can't be read: it's a directory. Give the path to a text file, or the text as -m <text>.",
    ],
  ])("refuses (2) feedback given as %j, before any run", async (args, text) => {
    await generate();
    await writeFile(path.join(root, "empty.md"), "\n  \n");
    const before = await runs();
    const { code, json } = await captureJson(["feedback", "button", ...args], machine());
    expect(code).toBe(2);
    expect((json.messages as { text: string }[])[0]?.text).toContain(text);
    expect(await runs()).toEqual(before);
  });

  it("refuses (2) --clean, which feedback doesn't take", async () => {
    await generate();
    const { code, json } = await captureJson(["feedback", "button", "-m", "Round it.", "--clean"], machine());
    expect(code).toBe(2);
    expect((json.messages as { text: string }[])[0]?.text).toMatch(/^Unknown option '--clean'/);
  });

  it("refuses as generate does: an API that isn't the approved one (2), a run in progress (2), an old Claude Code (3)", async () => {
    await generate();
    const before = await runs();

    const provenance = "src/components/button/generated/provenance.json";
    const approved = await read(provenance);
    const parsed = JSON.parse(approved) as { api: { hash: string } };
    await writeFile(
      path.join(root, provenance),
      JSON.stringify({ ...parsed, api: { ...parsed.api, hash: `sha256:${"0".repeat(64)}` } }),
    );
    const changed = await captureJson(["feedback", "button", "-m", "Round it."], machine());
    expect(changed.code).toBe(2);
    expect((changed.json.messages as { hint?: string }[])[0]?.hint).toBe("fazon approve button");
    await writeFile(path.join(root, provenance), approved);

    await mkdir(path.join(root, ".fazon/locks"), { recursive: true });
    const holder = { run: "20261126T120000Z-button-3f9a", pid: process.pid, started: "2026-11-26T12:00:00.000Z" };
    await writeFile(path.join(root, ".fazon/locks/button.json"), JSON.stringify(holder));
    const locked = await captureJson(["feedback", "button", "-m", "Round it."], machine());
    expect(locked.code).toBe(2);
    expect((locked.json.messages as { text: string }[])[0]?.text).toMatch(/^Button has a run in progress/);
    await rm(path.join(root, ".fazon/locks/button.json"));

    const old = await captureJson(["feedback", "button", "-m", "Round it."], {
      ...machine(),
      programs: { [claude]: "2.1.300 (Claude Code)", docker: "Docker version 28.0.0" },
    });
    expect(old.code).toBe(3);
    expect(await runs()).toEqual(before);
  });

  it("refuses (2) as generate does a spec without fixtures whose API requires a slot", async () => {
    await generate();
    const before = await runs();
    const spec = await read("specs/button.md");
    const withoutFixtures = spec.slice(0, spec.indexOf("fixtures:\n")) + spec.slice(spec.indexOf("tokens:\n"));
    await writeFile(path.join(root, "specs/button.md"), withoutFixtures);
    const { code, json } = await captureJson(["feedback", "button", "-m", "Round it."], machine());
    expect(code).toBe(2);
    expect((json.messages as { text: string; hint?: string }[])[0]).toEqual({
      level: "error",
      text: "specs/button.md has no fixtures, so its stories would render the empty fixture, which doesn't set the slot default: Button requires it.",
      hint: "Add fixtures to specs/button.md first, then run 'fazon spec check button'; fixtures need no new approval.",
    });
    expect(await runs()).toEqual(before);
    expect(await readdir(path.join(root, ".fazon/locks"))).toEqual([]);
  });
});
