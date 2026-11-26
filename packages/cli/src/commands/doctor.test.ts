// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capture,
  captureJson,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

const secret = "sk-ant-test-0123456789-do-not-print";
const programs = {
  docker: "Docker version 28.1.0, build 1234",
  podman: "podman version 5.6.1",
  claude: "2.1.332 (Claude Code)",
};

let root: string;
let machine: FakeMachine;
beforeEach(async () => {
  root = await repository({ "fazon.yaml": minimalConfig });
  machine = { cwd: root, env: { ANTHROPIC_API_KEY: secret }, programs };
});
afterEach(() => removeRepository(root));

function check(json: Record<string, unknown>, name: string) {
  return (json.result as { checks: { check: string }[] }).checks.find((item) => item.check === name);
}

describe("fazon doctor", () => {
  it("passes on a ready machine, and lists every check", async () => {
    const { code, json } = await captureJson(["doctor"], machine);
    expect(code).toBe(0);
    expect(json).toMatchObject({ command: "doctor", status: "ok" });
    const checks = (json.result as { checks: { check: string; state: string }[] }).checks;
    expect(checks.map((item) => [item.check, item.state])).toEqual([
      ["node", "ok"],
      ["container-runtime", "ok"],
      ["claude-code", "ok"],
      ["api-key", "ok"],
      ["verifier-image", "not-checked"],
      ["config", "ok"],
    ]);
    expect(check(json, "container-runtime")).toMatchObject({ detail: "Docker version 28.1.0, build 1234 (detected)" });
    expect(check(json, "claude-code")).toMatchObject({ detail: "Claude Code 2.1.332 (2.1.332 or later needed)" });
  });

  it("never prints the API key, in text or JSON (CLI-003)", async () => {
    const text = await capture(["doctor", "--verbose"], machine);
    const json = await capture(["doctor", "--json"], machine);
    for (const output of [text.stdout, text.stderr, json.stdout, json.stderr]) {
      expect(output).not.toContain(secret);
      expect(output).not.toContain(secret.slice(0, 12));
    }
    expect(text.stdout).toContain("ANTHROPIC_API_KEY is set");
  });

  it("detects Podman when Docker is missing", async () => {
    const { json } = await captureJson(["doctor"], { ...machine, programs: { podman: programs.podman } });
    expect(check(json, "container-runtime")).toMatchObject({ state: "ok", detail: "podman version 5.6.1 (detected)" });
  });

  it("uses FAZON_CONTAINER_RUNTIME when it's set", async () => {
    const { json } = await captureJson(["doctor"], { ...machine, env: { FAZON_CONTAINER_RUNTIME: "podman" } });
    expect(check(json, "container-runtime")).toMatchObject({
      state: "ok",
      detail: "podman version 5.6.1 (FAZON_CONTAINER_RUNTIME)",
    });
  });

  it("exits 3 without a container runtime, and says how to get one", async () => {
    const { code, json } = await captureJson(["doctor"], { ...machine, programs: { claude: programs.claude } });
    expect(code).toBe(3);
    expect(json.status).toBe("error");
    expect(check(json, "container-runtime")).toMatchObject({
      state: "missing",
      hint: expect.stringContaining("Install Docker") as string,
    });
  });

  it("exits 3 when FAZON_CONTAINER_RUNTIME names something else, or a runtime that isn't there", async () => {
    const bogus = await captureJson(["doctor"], { ...machine, env: { FAZON_CONTAINER_RUNTIME: "nerdctl" } });
    expect(bogus.code).toBe(3);
    expect(check(bogus.json, "container-runtime")).toMatchObject({ state: "invalid" });
    const absent = await captureJson(["doctor"], {
      ...machine,
      env: { FAZON_CONTAINER_RUNTIME: "podman" },
      programs: { docker: programs.docker },
    });
    expect(absent.code).toBe(3);
    expect(check(absent.json, "container-runtime")).toMatchObject({ state: "missing" });
  });

  it("exits 3 on an old Node.js", async () => {
    const { code, json } = await captureJson(["doctor"], { ...machine, nodeVersion: "24.4.0" });
    expect(code).toBe(3);
    expect(check(json, "node")).toMatchObject({ state: "outdated" });
  });

  it("only warns when Claude Code or the API key is missing", async () => {
    const result = await capture(["doctor"], { ...machine, env: {}, programs: { docker: programs.docker } });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning: Claude Code: not found");
    expect(result.stderr).toContain("warning: ANTHROPIC_API_KEY is not set");
  });

  it("only warns when Claude Code is older than the minimum, or its version can't be read (T-0094)", async () => {
    const old = await captureJson(["doctor"], {
      ...machine,
      programs: { ...programs, claude: "2.1.331 (Claude Code)" },
    });
    expect(old.code).toBe(0);
    expect(old.json.status).toBe("ok");
    expect(check(old.json, "claude-code")).toMatchObject({ state: "outdated", required: false });
    expect(old.json.messages).toContainEqual({
      level: "warning",
      text: "Claude Code 2.1.331 is older than 2.1.332, the minimum this version of Fazon needs; propose, generate and feedback refuse to start with it. Update it with 'claude update' to 2.1.332 or later.",
    });
    const newer = await captureJson(["doctor"], {
      ...machine,
      programs: { ...programs, claude: "2.2.0 (Claude Code)" },
    });
    expect(check(newer.json, "claude-code")).toMatchObject({ state: "ok" });
    const odd = await captureJson(["doctor"], { ...machine, programs: { ...programs, claude: "Claude Code nightly" } });
    expect(odd.code).toBe(0);
    expect(check(odd.json, "claude-code")).toMatchObject({ state: "invalid" });
  });

  it("warns, without failing, when there is no fazon.yaml", async () => {
    await removeRepository(root);
    root = await repository();
    const { code, json } = await captureJson(["doctor"], { ...machine, cwd: root });
    expect(code).toBe(0);
    expect(check(json, "config")).toMatchObject({ state: "missing" });
    expect(json.messages).toContainEqual({
      level: "warning",
      text: "fazon.yaml: not found in this directory. Run fazon doctor from the repository root, or set the repository up with 'fazon init'.",
    });
  });

  it("fails (1) on an invalid config, with its findings", async () => {
    await removeRepository(root);
    root = await repository({ "fazon.yaml": `${minimalConfig}loops: 3\n` });
    const { code, json } = await captureJson(["doctor"], { ...machine, cwd: root });
    expect(code).toBe(1);
    expect(json.status).toBe("failed");
    expect(check(json, "config")).toMatchObject({
      state: "invalid",
      findings: [expect.objectContaining({ message: "unknown key 'loops'" })],
    });
  });

  it("refuses (2) in CI while fazon.local.yaml exists", async () => {
    await removeRepository(root);
    root = await repository({ "fazon.yaml": minimalConfig, "fazon.local.yaml": "fazon: 0\n" });
    const local = await captureJson(["doctor"], { ...machine, cwd: root });
    expect(local.code).toBe(0);
    const ci = await captureJson(["doctor"], { ...machine, cwd: root, env: { CI: "true" } });
    expect(ci.code).toBe(2);
    expect(ci.json.status).toBe("refused");
    expect(JSON.stringify(ci.json.messages)).toContain("Remove fazon.local.yaml");
  });
});
