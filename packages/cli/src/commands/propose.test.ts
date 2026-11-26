// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon propose` against the fake Claude Code: no real `claude -p` runs.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseSpecFile, readRunRecord, runRecordProblems } from "@fazon/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  captureJson,
  fakeClaudeCode,
  gitInit,
  minimalConfig,
  removeRepository,
  repository,
  type FakeMachine,
} from "../test-support.js";

/** A spec with its content written and no API yet. */
const spec = [
  "---",
  "# Every field: docs/spec/spec-format.md in the Fazon repository.",
  "fazon: 0",
  "name: Badge",
  "tier: primitive",
  "summary: Shows a short status next to a label.",
  "# The API comes from `fazon propose`.",
  "---",
  "",
  "## Purpose",
  "",
  "A compact status label, in a neutral or a positive tone.",
  "",
  "## Behaviour",
  "",
  "- Doesn't respond to input.",
  "",
  "## Never",
  "",
  "- Never a button.",
  "",
].join("\n");

const proposal = {
  props: {
    tone: { type: "enum", values: ["neutral", "positive"], default: "neutral", description: "The status it shows." },
  },
  slots: { default: { required: true, description: "The label." } },
};

let claude: string;
beforeAll(async () => {
  claude = await fakeClaudeCode();
});
afterAll(() => rm(path.dirname(claude), { recursive: true, force: true }));

let root: string;
beforeEach(async () => {
  root = await repository({
    "fazon.yaml": minimalConfig,
    "specs/badge.md": spec,
    "docs/conventions.md": "# Conventions\n\nComponent-local custom properties start with `--_`.\n",
  });
  await gitInit(root);
});
afterEach(() => removeRepository(root));

function machine(env: Record<string, string> = {}, version = "2.1.332 (Claude Code)"): FakeMachine {
  return {
    cwd: root,
    env: { PATH: process.env.PATH, FAKE_CLAUDE_LOG: path.join(root, ".fazon", "fake.json"), ...env },
    programs: { [claude]: version },
    claudeCode: claude,
  };
}

const read = (file: string) => readFile(path.join(root, file), "utf8");
const runs = async () => readdir(path.join(root, ".fazon/runs")).catch(() => []);
const fakeLog = async () => JSON.parse(await read(".fazon/fake.json")) as { args: string[]; prompt: string };

describe("fazon propose", () => {
  it("writes the agent's API into the spec's API fields, leaving the rest of the file as it was", async () => {
    const { code, json } = await captureJson(
      ["propose", "badge"],
      machine({ FAKE_CLAUDE_STRUCTURED: JSON.stringify(proposal) }),
    );
    expect(code).toBe(0);
    const [run] = await runs();
    expect(json).toMatchObject({
      command: "propose",
      status: "ok",
      result: {
        run,
        kind: "propose",
        status: "passed",
        iterations: 1,
        costUsd: 0.4321,
        record: `.fazon/runs/${run ?? ""}/run.json`,
        spec: "specs/badge.md",
        fields: ["props", "slots"],
      },
    });
    expect(json.messages).toContainEqual({
      level: "info",
      text: "Wrote the proposed API into specs/badge.md: props, slots. Review it as a diff, edit it if needed, then approve it.",
      hint: "fazon approve badge",
    });
    expect(json.messages).toContainEqual({
      level: "info",
      text: `Run ${run ?? ""} (propose): 1 call, $0.43. It passed.`,
    });

    const text = await read("specs/badge.md");
    expect(parseSpecFile("specs/badge.md", text).spec).toMatchObject(proposal);
    const kept = (source: string) =>
      source.split("\n").filter((line) => !line.startsWith(" ") && !/^(props|slots):/.test(line));
    expect(kept(text)).toEqual(kept(spec));

    const record = await readRunRecord(path.join(root, ".fazon/runs", run ?? ""));
    expect(record).toMatchObject({
      kind: "propose",
      component: "Badge",
      status: "passed",
      proposal: { path: "specs/badge.md" },
    });
    expect(runRecordProblems(record)).toEqual([]);
    expect(record?.versions).toMatchObject({ claudeCode: "2.1.332" });
    expect(await readdir(path.join(root, ".fazon/locks"))).toEqual([]);
  });

  it("calls Claude Code to read only, with the answer's schema and the propose prompt", async () => {
    await captureJson(["propose", "badge"], machine({ FAKE_CLAUDE_STRUCTURED: JSON.stringify(proposal) }));
    const { args, prompt } = await fakeLog();
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "{}") as { properties: object };
    expect(Object.keys(schema.properties)).toEqual([
      "props",
      "events",
      "slots",
      "methods",
      "forward",
      "form",
      "parts",
      "extensions",
    ]);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(prompt).toContain("# Propose the API of Badge");
    expect(prompt).toContain("A compact status label, in a neutral or a positive tone.");
    expect(prompt).toContain("## The Vue 3 mapping");
    expect(prompt).toContain("Component-local custom properties start with `--_`.");
  });

  it("reads the API from the final message when there's no structured output", async () => {
    const message = `Here is the API:\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`\n`;
    const { code } = await captureJson(["propose", "badge"], machine({ FAKE_CLAUDE_RESULT: message }));
    expect(code).toBe(0);
    expect(parseSpecFile("specs/badge.md", await read("specs/badge.md")).spec?.props).toEqual(proposal.props);
  });

  it("needs a person (1) when the answer has no API, and leaves the spec as it was", async () => {
    const { code, json } = await captureJson(["propose", "badge"], machine({ FAKE_CLAUDE_RESULT: "I can't." }));
    expect(code).toBe(1);
    expect(json).toMatchObject({
      status: "needs-a-person",
      result: { status: "needs-a-person", reason: "iterations", fields: [] },
    });
    expect(json.messages).toContainEqual({
      level: "error",
      text: "The agent's last call ended in error: the agent's answer has no API: no JSON object in its structured output or final message",
    });
    expect(await read("specs/badge.md")).toBe(spec);
  });

  it("needs a person when the proposed API breaks a SPEC rule, and leaves the spec as it was", async () => {
    const broken = { props: { tone: { type: "enum" } } };
    const { code, json } = await captureJson(
      ["propose", "badge"],
      machine({ FAKE_CLAUDE_STRUCTURED: JSON.stringify(broken) }),
    );
    expect(code).toBe(1);
    const messages = json.messages as { text: string }[];
    expect(
      messages.some((message) => message.text.includes("the proposed API breaks a SPEC rule: specs/badge.md:")),
    ).toBe(true);
    expect(
      messages.some((message) => message.text.includes("SPEC-001 $.props.tone: missing required key 'values'")),
    ).toBe(true);
    expect(await read("specs/badge.md")).toBe(spec);
  });

  it("needs a person when the agent changes a file, which it may not, and leaves the change", async () => {
    const edits = JSON.stringify({ "specs/badge.md": "changed\n" });
    const { code, json } = await captureJson(
      ["propose", "badge"],
      machine({ FAKE_CLAUDE_EDITS: edits, FAKE_CLAUDE_STRUCTURED: JSON.stringify(proposal) }),
    );
    expect(code).toBe(1);
    expect(json.result).toMatchObject({ status: "needs-a-person", reason: "violation" });
    expect(json.messages).toContainEqual({
      level: "error",
      text: "The agent changed files it may not change (PERM-002), which are left as they are: specs/badge.md.",
    });
    expect(await read("specs/badge.md")).toBe("changed\n");
  });

  it("needs a person at the budget limit (reason budget) and at the call-time cap", async () => {
    const budget = await captureJson(["propose", "badge"], machine({ FAKE_CLAUDE: "budget" }));
    expect(budget.code).toBe(1);
    expect(budget.json.result).toMatchObject({ status: "needs-a-person", reason: "budget" });

    await writeFile(path.join(root, "fazon.yaml"), `${minimalConfig}loop:\n  callMinutes: 0.005\n`);
    const timed = await captureJson(["propose", "badge"], machine({ FAKE_CLAUDE: "hang" }));
    expect(timed.code).toBe(1);
    expect(timed.json.result).toMatchObject({ status: "needs-a-person", reason: "iterations" });
    const record = await readRunRecord(path.join(root, ".fazon/runs", (timed.json.result as { run: string }).run));
    expect(record?.iterations[0]?.call.end).toBe("call-time");
    expect(await read("specs/badge.md")).toBe(spec);
  });

  it("refuses to start (3) with a Claude Code older than the minimum, or none", async () => {
    const old = await captureJson(["propose", "badge"], machine({}, "2.1.300 (Claude Code)"));
    expect(old.code).toBe(3);
    expect(old.json.messages).toEqual([
      {
        level: "error",
        text: "Claude Code 2.1.300 is older than 2.1.332, the minimum this version of Fazon needs, so the agent can't run. Update it with 'claude update' to 2.1.332 or later.",
        hint: "fazon doctor",
      },
    ]);
    const missing = await captureJson(["propose", "badge"], { ...machine(), programs: {} });
    expect(missing.code).toBe(3);
    expect(await runs()).toEqual([]);
  });

  it("refuses (2) while the component has a run in progress", async () => {
    await mkdir(path.join(root, ".fazon/locks"), { recursive: true });
    const holder = { run: "20261126T120000Z-badge-3f9a", pid: process.pid, started: "2026-11-26T12:00:00.000Z" };
    await writeFile(path.join(root, ".fazon/locks/badge.json"), JSON.stringify(holder));
    const { code, json } = await captureJson(
      ["propose", "badge"],
      machine({ FAKE_CLAUDE_STRUCTURED: JSON.stringify(proposal) }),
    );
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: `Badge has a run in progress: 20261126T120000Z-badge-3f9a, started 2026-11-26T12:00:00.000Z by process ${String(process.pid)}. Wait for it to end, or stop it, before starting another.`,
        hint: "fazon runs",
      },
    ]);
    expect(await runs()).toEqual([]);
    expect(await read("specs/badge.md")).toBe(spec);
  });

  it("refuses (2) a spec with findings, such as the template's placeholders, and a missing spec", async () => {
    await writeFile(
      path.join(root, "specs/badge.md"),
      spec.replace("- Never a button.", "- TODO: a use or a look that is wrong."),
    );
    const { code, json } = await captureJson(["propose", "badge"], machine());
    expect(code).toBe(2);
    expect(json.messages).toEqual([
      {
        level: "error",
        text: "specs/badge.md has findings, so there's nothing reliable to propose from: 1 finding. Fix it first.",
        hint: "fazon spec check badge",
      },
      {
        level: "error",
        text: "specs/badge.md:20: SPEC-019 a placeholder from the spec template is left: '- TODO: a use or a look that is wrong.'. Replace it with the component's content, or remove it; the spec skill drafts the content with you.",
      },
    ]);
    const missing = await captureJson(["propose", "link"], machine());
    expect(missing.code).toBe(2);
    expect(missing.json.messages).toEqual([
      {
        level: "error",
        text: "There's no spec at specs/link.md. Write it first, or check the component name.",
        hint: "fazon spec new link",
      },
    ]);
    expect(await runs()).toEqual([]);
  });

  it("refuses (2) without a kebab-case component name", async () => {
    expect((await captureJson(["propose"], machine())).code).toBe(2);
    const { code, json } = await captureJson(["propose", "RadioGroup"], machine());
    expect(code).toBe(2);
    expect(json.messages).toEqual([expect.objectContaining({ hint: "fazon propose radio-group" })]);
  });
});
