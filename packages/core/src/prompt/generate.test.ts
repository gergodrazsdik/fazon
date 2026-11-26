// SPDX-License-Identifier: GPL-3.0-or-later
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../adapter.js";
import type { CheckFinding } from "../checks/types.js";
import { resolveConfig } from "../config/load.js";
import { parseAgentNeed } from "../loop/blocking.js";
import type { IterationRecord } from "../records/run-record.js";
import {
  describeFinding,
  fenced,
  generatePrompt,
  generationSkillFile,
  listedFindings,
  nestHeadings,
  loadGenerateContext,
  readGenerationSkill,
  skillInstructions,
  type GenerateCall,
  type GenerateContext,
} from "./generate.js";

const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const config = resolveConfig({ fazon: 0, adapter: "vue", image, tokens: { prefix: "fz" } }).config;

const adapter = {
  id: "fake",
  componentFiles: () => ({
    files: [
      { name: "Button", exportName: "Button", file: "Button.vue" },
      { name: "ButtonIcon", part: "Icon", exportName: "ButtonIcon", file: "ButtonIcon.vue" },
    ],
    patterns: ["*.vue", "*.ts", "*.css"],
  }),
  selfChecks: (directory: string) => ({
    commands: ["pnpm exec vue-tsc --noEmit", `pnpm exec vitest run ${directory}`],
    cacheDirectories: [],
  }),
} as unknown as Adapter;

const left = { iterations: 5, budgetUsd: 10, runMinutes: 90 };

function finding(extra: Partial<CheckFinding> = {}): CheckFinding {
  return { check: "tokens", rule: "raw-value", message: "A literal colour.", blocking: true, ...extra };
}

function iteration(n: number, extra: Partial<IterationRecord> = {}): IterationRecord {
  return {
    n,
    call: {
      model: "claude-sonnet-5-5",
      started: "2026-11-26T10:00:00Z",
      durationSeconds: 60,
      end: "completed",
      tokens: { input: 1, output: 1 },
      costUsd: 1,
      transcript: `calls/${String(n)}.jsonl`,
    },
    outcome: "fail",
    ...extra,
  };
}

/** A context with short texts, for the prompt's shape. */
const context: GenerateContext = {
  component: "Button",
  directory: "src/components/button",
  files: [
    { name: "Button", exportName: "Button", file: "Button.vue" },
    { name: "ButtonIcon", part: "Icon", exportName: "ButtonIcon", file: "ButtonIcon.vue" },
  ],
  patterns: ["*.vue", "*.ts", "*.css"],
  selfChecks: ["pnpm exec vue-tsc --noEmit"],
  spec: { path: "specs/button.md", text: "---\nname: Button\n---\n\nA button.\n" },
  api: [{ path: "src/components/button/generated/api.json", text: '{ "name": "FzButton" }\n' }],
  roleTokens: [{ name: "--fz-color-text-primary", path: "color.text.primary", type: "color" }],
  conventions: { path: "docs/conventions.md", text: "The conventions.\n" },
  skill: "# Generate a component\n\nThe skill's text.\n\n## Its rules\n\nThe rules.",
};

function call(extra: Partial<GenerateCall> = {}): GenerateCall {
  return { iteration: 1, left, findings: [], ...extra };
}

describe("the generation skill", () => {
  it("is the plugin's skill, without its front matter and license comment", async () => {
    const text = await readFile(generationSkillFile(), "utf8");
    expect(text.split("\n").slice(0, 3)).toEqual([
      "---",
      "# SPDX-License-Identifier: GPL-3.0-or-later",
      "name: generate",
    ]);
    const skill = await readGenerationSkill();
    expect(skill.startsWith("# Generate a component")).toBe(true);
    expect(skill).not.toContain("SPDX-License-Identifier");
  });

  it("teaches what the checks hold the component to (T-0095, F-0011)", async () => {
    const skill = await readGenerationSkill();
    for (const text of ["defineOptions({ name })", "generated/api.json", "withDefaults", "vitest-browser-vue"]) {
      expect(skill).toContain(text);
    }
  });

  it("gives the agent's need for a person in the form the harness parses", async () => {
    const skill = await readGenerationSkill();
    const lines = skill.split("\n").filter((line) => line.startsWith("FAZON-NEEDS "));
    expect(lines.map((line) => parseAgentNeed(line)?.kind)).toEqual(["dependency", "shared-code"]);
  });

  it("keeps a text without front matter whole", () => {
    expect(skillInstructions("  # Just text\n")).toBe("# Just text");
    expect(skillInstructions("---\nname: x\n---\n\nBody\n")).toBe("Body");
    expect(skillInstructions("---\nunclosed\n")).toBe("---\nunclosed");
  });
});

describe("the generate context", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fazon-prompt-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
    await cp(path.join(docs, "examples/specs/valid/button.md"), path.join(root, "specs/button.md"));
    await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
    const generated = path.join(root, "src/components/button/generated");
    await mkdir(generated, { recursive: true });
    await writeFile(path.join(generated, "api.json"), '{ "name": "FzButton" }\n');
    await writeFile(path.join(generated, "stories.json"), "{}\n");
    await writeFile(path.join(generated, "provenance.json"), "{}\n");
    await writeFile(path.join(generated, "Button.stories.ts"), "stories\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads the spec, the approved API, the role tokens and the conventions doc", async () => {
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs/conventions.md"), "# Conventions\n");
    const loaded = await loadGenerateContext({ root, config, adapter, name: "button", skill: "The skill." });
    expect(loaded).toMatchObject({
      component: "Button",
      directory: "src/components/button",
      patterns: ["*.vue", "*.ts", "*.css"],
      selfChecks: ["pnpm exec vue-tsc --noEmit", "pnpm exec vitest run src/components/button"],
      spec: { path: "specs/button.md", text: await readFile(path.join(root, "specs/button.md"), "utf8") },
      // The adapter's data files only: not the manifest, the provenance or a story file.
      api: [{ path: "src/components/button/generated/api.json", text: '{ "name": "FzButton" }\n' }],
      conventions: { path: "docs/conventions.md", text: "# Conventions\n" },
      skill: "The skill.",
    });
    expect(loaded.roleTokens.length).toBeGreaterThan(10);
    expect(loaded.roleTokens).toContainEqual({
      name: "--fz-color-text-primary",
      path: "color.text.primary",
      type: "color",
    });
    // Role tokens only, in path order: never a raw token.
    expect(loaded.roleTokens.every((token) => token.name.startsWith("--fz-"))).toBe(true);
    expect(loaded.roleTokens.some((token) => token.path.startsWith("color.neutral."))).toBe(false);
    const paths = loaded.roleTokens.map((token) => token.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("goes without a conventions doc, and refuses a spec that doesn't parse", async () => {
    const loaded = await loadGenerateContext({ root, config, adapter, name: "button", skill: "" });
    expect(loaded.conventions).toBeUndefined();
    await writeFile(path.join(root, "specs/button.md"), "no front matter\n");
    await expect(loadGenerateContext({ root, config, adapter, name: "button", skill: "" })).rejects.toThrow(
      /specs\/button\.md doesn't pass SPEC-001/,
    );
  });
});

describe("the generate prompt", () => {
  it("puts the run's context first, then the findings and the caps left", () => {
    const prompt = generatePrompt(context, call());
    const headings = prompt.split("\n").filter((line) => line.startsWith("#"));
    expect(headings).toEqual([
      "# Generate the Button component",
      "## Generate a component",
      "### Its rules",
      "## Your files",
      "## Self-check commands",
      "## The spec: `specs/button.md`",
      "## The approved API, with the adapter's mapping applied",
      "## The role tokens",
      "## The conventions: `docs/conventions.md`",
      "## Findings",
      "## This call",
    ]);
    expect(prompt).toContain("- `src/components/button/ButtonIcon.vue`: the part Icon, exported as `ButtonIcon`");
    expect(prompt).toContain("- `pnpm exec vue-tsc --noEmit`");
    expect(prompt).toContain("--fz-color-text-primary  color.text.primary  color");
    expect(prompt).toContain("This is the run's first call");
    expect(prompt).toContain(
      "Iteration 1. Left, this call included: 5 calls, $10.00 of the run's budget, and 90 minutes of its run time.",
    );
    expect(prompt.endsWith("\n")).toBe(true);
  });

  it("lists the previous iteration's blocking findings, never the component's own visual diffs", () => {
    const own = finding({ check: "visual", rule: "changed", story: "button--default", theme: "light" });
    const other = finding({ check: "visual", rule: "changed", story: "badge--default", theme: "dark" });
    const prompt = generatePrompt(
      context,
      call({
        iteration: 2,
        left: { iterations: 4, budgetUsd: 8.5, runMinutes: 80.7 },
        previous: iteration(1),
        findings: [
          finding({
            file: "src/components/button/Button.vue",
            line: 12,
            column: 3,
            expected: "a role token",
            actual: "#2050d0",
          }),
          own,
          other,
        ],
      }),
    );
    expect(prompt).toContain("## Findings to fix");
    expect(prompt).toContain("The checks after iteration 1 found these");
    expect(prompt).toContain(
      "- `tokens/raw-value` at `src/components/button/Button.vue:12:3`: A literal colour.\n  - expected: `a role token`\n  - actual: `#2050d0`",
    );
    expect(prompt).toContain("- `visual/changed` at story badge--default (dark)");
    expect(prompt).not.toContain("button--default");
    expect(prompt).toContain("Left, this call included: 4 calls, $8.50 of the run's budget, and 80 minutes");
  });

  it("says which checks didn't run to the end, and when the previous call didn't finish", () => {
    const checked = iteration(1, {
      verification: {
        checks: [
          { check: "build", status: "fail", durationSeconds: 1, findings: [] },
          {
            check: "a11y",
            status: "skipped",
            durationSeconds: 0,
            message: "The static Storybook build failed.\nmore",
            findings: [],
          },
          { check: "layout", status: "error", durationSeconds: 0, message: "The browser crashed.", findings: [] },
        ],
      },
    });
    const prompt = generatePrompt(context, call({ iteration: 2, previous: checked }));
    expect(prompt).toContain(
      "- `a11y` was skipped: The static Storybook build failed.\n- `layout` ended in error: The browser crashed.",
    );
    expect(prompt).not.toContain("more");

    const stopped = iteration(2, { call: { ...checked.call, end: "call-time" } });
    const after = generatePrompt(context, call({ iteration: 3, previous: stopped, findings: [finding()] }));
    expect(after).toContain(
      "The previous call (iteration 2) didn't finish: the harness stopped it at the call-time cap.",
    );
    expect(after).toContain("- `tokens/raw-value`: A literal colour.");
  });

  it("carries a feedback run's feedback and its parent's findings", () => {
    const prompt = generatePrompt(
      context,
      call({ feedback: "Make the label bolder.\n```\nno escape\n```", findings: [finding()] }),
    );
    expect(prompt).toContain("## The developer's feedback");
    expect(prompt).toContain("````text\nMake the label bolder.\n```\nno escape\n```\n````");
    expect(prompt).toContain("The previous run's last checks found these");
    const clean = generatePrompt(context, call({ feedback: "Bolder." }));
    expect(clean).toContain("The previous run's checks left nothing to fix; work from the feedback above.");
  });

  it("lists the first findings in full and counts the rest", () => {
    const many = Array.from({ length: listedFindings + 3 }, (_, i) =>
      finding({ rule: i < listedFindings + 1 ? "raw-value" : "unknown-token", line: i + 1, file: "Button.vue" }),
    );
    const prompt = generatePrompt(context, call({ iteration: 2, previous: iteration(1), findings: many }));
    expect(prompt.match(/^- `tokens\//gm)).toHaveLength(listedFindings);
    expect(prompt).toContain("And 3 more findings, not listed: `tokens/raw-value` ×1, `tokens/unknown-token` ×2.");
  });

  it("fences a multi-line message and any text with backticks so it can't close its block", () => {
    expect(
      describeFinding(finding({ check: "test", rule: "behaviour", message: "A test failed:\nexpected 1\nto be 2" })),
    ).toBe("- `test/behaviour`: A test failed:\n  ```text\n  expected 1\n  to be 2\n  ```");
    expect(fenced("a ```` b")).toBe("`````\na ```` b\n`````");
    expect(fenced("plain\n", "json")).toBe("```json\nplain\n```");
  });

  it("nests a document's headings one level, outside its fenced code", () => {
    expect(nestHeadings("# A\n\n````sh\n# a comment\n```\n# still code\n````\n## B\n~~~\n# code\n~~~\n# C")).toBe(
      "## A\n\n````sh\n# a comment\n```\n# still code\n````\n### B\n~~~\n# code\n~~~\n## C",
    );
  });
});
