// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon generate` and `fazon feedback` end to end, in the verifier image (`just test-verify`): the
// example Button's project (./project.ts), approved, generated with `--clean` by the fake Claude
// Code, whose one call writes the known-good Button and its behaviour test back, so the in-image
// entry runs every check of the iteration and the run passes; then one feedback run on it, whose
// call changes nothing, passes the same way. No real `claude -p` runs. Needs the built packages, a
// container runtime and the image, which scripts/test-verify.sh provides as FAZON_E2E_IMAGE.
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateWithSchema } from "@fazon/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeClaude } from "../../core/src/agent/test-support.js";
import { behaviourTest, cliBin, createProject, workspace } from "./project.js";

const run = promisify(execFile);
const image = process.env.FAZON_E2E_IMAGE ?? "";

interface Json {
  readonly status: string;
  readonly exitCode: number;
  readonly messages: readonly { level: string; text: string }[];
  readonly result: Record<string, unknown>;
}

let project: string;
let claude: string;
/** The generate run's ID, which the feedback run answers. */
let generated = "";

async function fazon(args: readonly string[], env: Record<string, string> = {}): Promise<Json> {
  const { stdout, code } = await run(process.execPath, [cliBin, ...args, "--json"], {
    cwd: project,
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30 * 60_000,
  }).then(
    ({ stdout }) => ({ stdout, code: 0 }),
    (error: unknown) => {
      const failed = error as { stdout: string; code: number };
      return { stdout: failed.stdout, code: failed.code };
    },
  );
  const json = JSON.parse(stdout) as Json;
  expect(validateWithSchema("cli-output", json)).toEqual([]);
  expect(json.exitCode).toBe(code);
  return json;
}

beforeAll(async () => {
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error("Set FAZON_E2E_IMAGE to the verifier image by digest; scripts/test-verify.sh does.");
  }
  await access(cliBin).catch(() => {
    throw new Error("Build the packages first: pnpm run build (just test-verify does).");
  });
  const parent = path.join(workspace, ".fazon/e2e");
  await mkdir(parent, { recursive: true });
  project = await createProject({ image }, parent);
  // The agent call's snapshots need a git repository.
  await run("git", ["init", "--quiet", "."], { cwd: project });
  claude = await fakeClaude();
});

afterAll(async () => {
  if (process.env.FAZON_E2E_KEEP === undefined) await rm(project, { recursive: true, force: true });
  await rm(path.dirname(claude), { recursive: true, force: true });
});

describe("fazon generate and fazon feedback in the verifier image", () => {
  it("passes on its first iteration when the agent writes a component that passes every check", async () => {
    const approved = await fazon(["approve", "button"]);
    expect(approved.status, JSON.stringify(approved.messages)).toBe("ok");

    const button = "src/components/button/Button.vue";
    const edits = {
      [button]: await readFile(new URL("library/Button.vue", import.meta.url), "utf8"),
      "src/components/button/Button.test.ts": behaviourTest,
    };
    const json = await fazon(["generate", "button", "--clean"], {
      PATH: `${path.dirname(claude)}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_EDITS: JSON.stringify(edits),
    });
    expect(json.status, JSON.stringify(json.messages)).toBe("ok");
    expect(json.result).toMatchObject({ kind: "generate", status: "passed", component: "Button", iterations: 1 });
    expect(json.result.removed).toEqual([button, "src/components/button/Button.test.ts"].sort());

    const dir = path.join(project, ".fazon/runs", String(json.result.run));
    const record = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")) as {
      iterations: { verification: { checks: { check: string; status: string }[] } }[];
    };
    expect(validateWithSchema("run-record", record)).toEqual([]);
    const checks = record.iterations[0]?.verification.checks ?? [];
    expect(Object.fromEntries(checks.map((c) => [c.check, c.status]))).toEqual(
      Object.fromEntries(
        ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"].map((c) => [c, "pass"]),
      ),
    );
    await access(path.join(dir, "checks/1/checks.json"));
    await access(path.join(dir, "checks/1/verify.json"));
    await access(path.join(project, String(json.result.report)));
    generated = String(json.result.run);
  });

  it("runs a feedback run linked to the generate run, which passes on its first iteration too", async () => {
    expect(generated, "the generate run above passed").not.toBe("");
    const json = await fazon(["feedback", "button", "-m", "Keep the component as it is."], {
      PATH: `${path.dirname(claude)}${path.delimiter}${process.env.PATH ?? ""}`,
    });
    expect(json.status, JSON.stringify(json.messages)).toBe("ok");
    expect(json.result).toMatchObject({
      kind: "feedback",
      status: "passed",
      parent: generated,
      component: "Button",
      iterations: 1,
    });
    const dir = path.join(project, ".fazon/runs", String(json.result.run));
    const record = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")) as { parent: string };
    expect(validateWithSchema("run-record", record)).toEqual([]);
    expect(record.parent).toBe(generated);
    await access(path.join(dir, "checks/1/verify.json"));
  });
});
