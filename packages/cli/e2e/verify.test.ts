// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon verify` and `fazon baseline update` end to end, in the verifier image (`just test-verify`):
// a component library with the example Button (./project.ts) passes every check, gets its
// baselines, passes again against them, and then fails each check with the rule a seeded defect
// breaks, `visual` with a diff image. Needs the built packages, a container runtime and the image,
// which scripts/test-verify.sh provides as FAZON_E2E_IMAGE (by digest).
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateWithSchema } from "@fazon/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliBin, createProject, lucideLicense, workspace } from "./project.js";

const run = promisify(execFile);
const image = process.env.FAZON_E2E_IMAGE ?? "";

interface Json {
  readonly status: string;
  readonly exitCode: number;
  readonly messages: readonly { level: string; text: string }[];
  readonly result: Record<string, unknown>;
}

interface Finding {
  readonly check: string;
  readonly rule: string;
  readonly message: string;
  readonly evidence?: string;
  readonly blocking: boolean;
}

let project: string;

/** Runs the CLI in the project with --json; checks CLI-001 and returns the document. */
async function fazon(...args: string[]): Promise<Json> {
  const { stdout, code } = await run(process.execPath, [cliBin, ...args, "--json"], {
    cwd: project,
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

async function record(json: Json): Promise<{ run: Record<string, unknown>; findings: Finding[]; dir: string }> {
  const dir = path.join(project, ".fazon/runs", String(json.result.run));
  const data = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")) as {
    verification: { checks: { findings: Finding[] }[] };
  };
  expect(validateWithSchema("run-record", data)).toEqual([]);
  return { run: data, findings: data.verification.checks.flatMap((c) => c.findings), dir };
}

function statuses(json: Json): Record<string, string> {
  const checks = json.result.checks as { check: string; status: string }[];
  return Object.fromEntries(checks.map((c) => [c.check, c.status]));
}

const allPass = Object.fromEntries(
  ["build", "lint", "test", "package", "a11y", "tokens", "layout", "visual"].map((check) => [check, "pass"]),
);

beforeAll(async () => {
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error("Set FAZON_E2E_IMAGE to the verifier image by digest; scripts/test-verify.sh does.");
  }
  await access(cliBin).catch(() => {
    throw new Error("Build the packages first: pnpm run build (just test-verify does).");
  });
  // Inside the workspace, so the project's links to its packages resolve in the image's one mount.
  const parent = path.join(workspace, ".fazon/e2e");
  await mkdir(parent, { recursive: true });
  project = await createProject({ image }, parent);
});

afterAll(async () => {
  if (process.env.FAZON_E2E_KEEP === undefined) await rm(project, { recursive: true, force: true });
});

describe("fazon verify and fazon baseline update in the verifier image", () => {
  it("pass every check on a clean component, with every story new", async () => {
    const json = await fazon("verify", "--no-judge");
    expect(json.status, JSON.stringify(json.messages)).toBe("ok");
    expect(statuses(json)).toEqual(allPass);
    const [button] = json.result.components as { stories: Record<string, number> }[];
    expect(button?.stories).toEqual({ unchanged: 0, changed: 0, new: 54 });
    const { run, findings } = await record(json);
    expect(validateWithSchema("run-record", run)).toEqual([]);
    expect(run.status).toBe("passed");
    // No agent call and no judge: the record names neither version.
    expect(run.versions).not.toHaveProperty("claudeCode");
    expect(run.versions).not.toHaveProperty("judge");
    // The spec's exemption waives the ghost variant's active contrast: kept, marked, not blocking.
    const waived = findings.filter((f) => f.check === "a11y" && f.rule === "color-contrast");
    expect(waived.length).toBeGreaterThan(0);
    expect(waived.every((f) => !f.blocking && (f as { exempt?: number }).exempt === 0)).toBe(true);
  });

  it("write the baselines from that run, and nothing on a second update", async () => {
    const first = await fazon("baseline", "update", "button");
    expect(first.status, JSON.stringify(first.messages)).toBe("ok");
    expect((first.result.written as string[]).length).toBe(54);
    const baselines = path.join(project, "baselines");
    expect(JSON.parse(await readFile(path.join(baselines, "fazon.json"), "utf8"))).toEqual({ fazon: 0, image });
    expect(await readFile(path.join(baselines, "NOTICE.md"), "utf8")).toContain(lucideLicense.trim());
    await access(path.join(baselines, "dark/button/label--variant-primary--size-md--hover.png"));

    const second = await fazon("baseline", "update", "button");
    expect(second.result.written).toEqual([]);
    expect((second.result.unchanged as string[]).length).toBe(54);
  });

  it("pass again against the baselines: every story unchanged", async () => {
    const json = await fazon("verify", "--no-judge");
    expect(json.status, JSON.stringify(json.messages)).toBe("ok");
    expect(statuses(json)).toEqual(allPass);
    const [button] = json.result.components as { stories: Record<string, number> }[];
    expect(button?.stories).toEqual({ unchanged: 54, changed: 0, new: 0 });
  });

  it("fail each check with the rule a seeded defect breaks", async () => {
    const vue = path.join(project, "src/components/button/Button.vue");
    const original = await readFile(vue, "utf8");
    const seeded = original
      // test: contract-api, a default that differs from the approved API
      .replace('size: "md"', 'size: "lg"')
      // a11y: spec-aria, an attribute the spec lists that no story shows any more
      .replace(`:aria-disabled="props.loading ? 'true' : undefined"`, "")
      // lint and tokens: raw-value
      .replace("</style>", '.button[data-variant="ghost"] {\n  border-color: #2050d0;\n}\n</style>')
      // layout: clipped-text
      .replace(
        "</style>",
        '.button[data-size="sm"] {\n  max-inline-size: 4ch;\n  overflow: hidden;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n</style>',
      );
    expect(seeded).not.toBe(original);
    await writeFile(vue, seeded);
    // build: types
    await writeFile(path.join(project, "src/components/button/seed.ts"), 'export const size: number = "md";\n');
    // package: export, an entry that leaves the component out (and build: generated, as sync wrote it)
    const entry = path.join(project, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace(/^export \{ default as Button \}.*\n/m, ""));

    const json = await fazon("verify", "--no-judge");
    expect(json.status, JSON.stringify(json.messages)).toBe("failed");
    expect(json.exitCode).toBe(1);
    const { findings, dir, run } = await record(json);
    expect(validateWithSchema("run-record", run)).toEqual([]);
    expect(run.status).toBe("failed");
    expect(run).not.toHaveProperty("reason");
    const rules = new Set(findings.filter((f) => f.blocking).map((f) => `${f.check}/${f.rule}`));
    for (const expected of [
      "build/types",
      "build/generated",
      "lint/raw-value",
      "test/contract-api",
      "package/export",
      "a11y/spec-aria",
      "tokens/raw-value",
      "layout/clipped-text",
      "visual/changed",
    ]) {
      expect([...rules], expected).toContain(expected);
    }
    const changed = findings.filter((f) => f.check === "visual" && f.rule === "changed");
    for (const finding of changed) await access(path.join(dir, finding.evidence ?? "missing"));

    const refused = await fazon("baseline", "update", "button");
    expect(refused.status).toBe("refused");
    expect(refused.messages.map((m) => m.text).join("\n")).toMatch(/didn't pass every check other than visual/);
  });
});
