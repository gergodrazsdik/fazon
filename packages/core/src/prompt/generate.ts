// SPDX-License-Identifier: GPL-3.0-or-later
// The prompt of a generate or feedback run's agent call (docs/spec/agent-permissions.md#what-the-agent-receives):
// the generation skill, the component's files and self-checks, the spec and its approved API with
// the adapter's mapping applied, the role tokens, the conventions doc, then the developer's
// feedback, the previous iteration's findings and the iteration with the caps left. What stays the
// same for the whole run comes first, so the calls of a run share the prompt's beginning.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter, ComponentFile } from "../adapter.js";
import type { CheckFinding } from "../checks/types.js";
import type { Config } from "../config/types.js";
import { loadTokenIndex } from "../lint/tokens.js";
import { isOwnVisualDiff } from "../loop/blocking.js";
import type { LoopCallInput } from "../loop/types.js";
import { parseSpecFile } from "../spec/load.js";
import { generatedDirectory, manifestFileName, provenanceFileName } from "../sync/sync.js";

/** A file the prompt carries, by its path from the repository root. */
export interface PromptFile {
  readonly path: string;
  readonly text: string;
}

/** A role token as the agent uses it. */
export interface PromptRoleToken {
  /** The custom property, with `--` and the prefix: `--fz-color-text-primary`. */
  readonly name: string;
  /** The dotted path the spec's token rules use: `color.text.primary`. */
  readonly path: string;
  /** Its `$type`: `color`, `dimension`, … */
  readonly type: string;
}

/** What every call of a generate or feedback run is given, read once at the run's start, after the refresh. */
export interface GenerateContext {
  /** The component, in PascalCase as the spec names it. */
  readonly component: string;
  /** Its directory, from the repository root: `src/components/button`. */
  readonly directory: string;
  /** The component's and its parts' files, as the adapter names them. */
  readonly files: readonly ComponentFile[];
  /** The patterns of the files the agent may write in the directory, outside `generated/`. */
  readonly patterns: readonly string[];
  /** The adapter's self-check commands, exactly as the agent may run them. */
  readonly selfChecks: readonly string[];
  readonly spec: PromptFile;
  /** The approved API with the adapter's mapping applied: the adapter's data files in `generated/`, such as `api.json`. */
  readonly api: readonly PromptFile[];
  readonly roleTokens: readonly PromptRoleToken[];
  /** Absent when the conventions doc doesn't exist. */
  readonly conventions?: PromptFile;
  /** The generation skill's instructions, without its front matter. */
  readonly skill: string;
}

/** What one call adds to the run's context: the loop's input for the call. */
export type GenerateCall = Pick<LoopCallInput, "iteration" | "left" | "findings" | "previous" | "feedback">;

/** How many findings the prompt lists in full; the rest are counted by check and rule. */
export const listedFindings = 50;

/**
 * The generation skill's file in the framework: `plugin/skills/generate/SKILL.md`, beside the
 * packages, in the checkout or the framework commit a consumer builds from (ADR 0022, ADR 0023).
 */
export function generationSkillFile(): string {
  return fileURLToPath(new URL("../../../../plugin/skills/generate/SKILL.md", import.meta.url));
}

/** A skill's instructions: its text after the front matter, trimmed. */
export function skillInstructions(text: string): string {
  const lines = (text.startsWith("\uFEFF") ? text.slice(1) : text).split("\n");
  if (lines[0]?.trimEnd() !== "---") return text.trim();
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  return end === -1
    ? text.trim()
    : lines
        .slice(end + 1)
        .join("\n")
        .trim();
}

/** The generation skill's instructions, from `file` (the framework's own by default). */
export async function readGenerationSkill(file: string = generationSkillFile()): Promise<string> {
  return skillInstructions(await readFile(file, "utf8"));
}

export interface GenerateContextOptions {
  /** The repository root, absolute. */
  readonly root: string;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The component, by its kebab-case name: `button`. */
  readonly name: string;
  /** The generation skill's instructions; read from `generationSkillFile()` when absent. */
  readonly skill?: string;
}

function posix(file: string): string {
  return path.posix.normalize(file.split(path.sep).join("/"));
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Reads what every call of the run is given. Run it after the refresh at the run's start, which
 * writes the approved API into `generated/`.
 * @throws Error when the spec is missing or doesn't parse, or the token set can't be built
 */
export async function loadGenerateContext(options: GenerateContextOptions): Promise<GenerateContext> {
  const { root, config, adapter, name } = options;
  const specPath = path.posix.join(posix(config.paths.specs), `${name}.md`);
  const specText = await readFile(path.join(root, specPath), "utf8");
  const spec = parseSpecFile(specPath, specText).spec;
  if (spec === undefined) throw new Error(`${specPath} doesn't pass SPEC-001; run \`fazon spec check ${name}\`.`);

  const directory = path.posix.join(posix(config.paths.components), name);
  const generated = path.posix.join(directory, generatedDirectory);
  const entries = await readdir(path.join(root, generated)).catch(() => [] as string[]);
  const api: PromptFile[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".json")).sort()) {
    if (entry === manifestFileName || entry === provenanceFileName) continue;
    const file = path.posix.join(generated, entry);
    api.push({ path: file, text: await readFile(path.join(root, file), "utf8") });
  }

  const prefix = config.tokens.prefix ?? "";
  const index = await loadTokenIndex({ root, tokens: config.paths.tokens, prefix });
  const tokens = index.byTheme.get(index.defaultTheme);
  const roleTokens = [...(tokens?.values() ?? [])]
    .filter((token) => token.kind === "role")
    .map((token) => ({ name: token.name, path: token.path, type: token.type }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const conventionsPath = posix(config.paths.conventions);
  const conventions = await readOptional(path.join(root, conventionsPath));
  const { files, patterns } = adapter.componentFiles(spec);
  return {
    component: spec.name,
    directory,
    files,
    patterns,
    selfChecks: adapter.selfChecks(directory).commands,
    spec: { path: specPath, text: specText },
    api,
    roleTokens,
    ...(conventions === undefined ? {} : { conventions: { path: conventionsPath, text: conventions } }),
    skill: options.skill ?? (await readGenerationSkill()),
  };
}

/** `text` in a fenced block whose fence is longer than any run of backticks in it. */
export function fenced(text: string, info = ""): string {
  let longest = 0;
  let run = 0;
  for (const character of text) {
    run = character === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text.endsWith("\n") ? text : `${text}\n`}${fence}`;
}

/**
 * Markdown with each heading one level deeper (outside fenced code), so a document's headings sit
 * under the prompt section that carries it.
 */
export function nestHeadings(text: string): string {
  let fence: string | undefined;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker !== undefined) {
        if (fence === undefined) fence = marker;
        else if (marker.startsWith(fence) && line.trim() === marker) fence = undefined;
        return line;
      }
      return fence === undefined && line.startsWith("#") ? `#${line}` : line;
    })
    .join("\n");
}

/** Where a finding is: its story and theme, part and selector, or its file, line and column. */
function findingLocation(finding: CheckFinding): string {
  if (finding.story !== undefined) {
    return [
      `story ${finding.story}${finding.theme === undefined ? "" : ` (${finding.theme})`}`,
      ...(finding.part === undefined ? [] : [`part ${finding.part}`]),
      ...(finding.selector === undefined ? [] : [`\`${finding.selector}\``]),
    ].join(", ");
  }
  if (finding.file === undefined) return "";
  const line = finding.line === undefined ? "" : `:${String(finding.line)}`;
  const column = finding.line === undefined || finding.column === undefined ? "" : `:${String(finding.column)}`;
  return `\`${finding.file}${line}${column}\``;
}

/** One finding as a Markdown list item, its message in full. */
export function describeFinding(finding: CheckFinding): string {
  const where = findingLocation(finding);
  const [first = "", ...rest] = finding.message.trim().split("\n");
  const lines = [`- \`${finding.check}/${finding.rule}\`${where === "" ? "" : ` at ${where}`}: ${first}`];
  if (rest.length > 0) lines.push(indent(fenced(rest.join("\n"), "text")));
  if (finding.expected !== undefined) lines.push(`  - expected: ${inline(finding.expected)}`);
  if (finding.actual !== undefined) lines.push(`  - actual: ${inline(finding.actual)}`);
  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");
}

/** A value as inline code, on one line. */
function inline(value: string): string {
  const text = value.split("\n").join(" ");
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function pluralise(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

const callEnds: Readonly<Record<string, string>> = {
  "call-time": "the harness stopped it at the call-time cap",
  budget: "Claude Code stopped it at its budget limit",
  error: "it ended in error",
};

/** The section on what to fix: the findings, the checks that didn't run to the end, and how the last call ended. */
function findingsSection(context: GenerateContext, call: GenerateCall): string {
  const findings = call.findings.filter((finding) => !isOwnVisualDiff(finding, context.component));
  const previous = call.previous;
  const lines: string[] = [];
  if (previous === undefined && findings.length === 0) {
    return call.feedback === undefined
      ? "## Findings\n\nThis is the run's first call: no checks have run yet. Write the component from the spec."
      : "## Findings\n\nThe previous run's checks left nothing to fix; work from the feedback above.";
  }
  lines.push("## Findings to fix");
  if (previous !== undefined && previous.call.end !== "completed") {
    lines.push(
      `The previous call (iteration ${String(previous.n)}) didn't finish: ${callEnds[previous.call.end] ?? "it didn't complete"}. No checks ran after it; the component's files are as it left them. Finish the work, in smaller steps.`,
    );
  }
  const incomplete = (previous?.verification?.checks ?? []).filter(
    (check) => check.status === "error" || check.status === "skipped",
  );
  if (incomplete.length > 0) {
    lines.push(
      "These checks didn't run to the end, so they couldn't show the component is right. A check skipped after a failed build passes only once the build does:",
      incomplete
        .map(
          (check) =>
            `- \`${check.check}\` ${check.status === "error" ? "ended in error" : "was skipped"}${check.message === undefined ? "" : `: ${check.message.trim().split("\n")[0] ?? ""}`}`,
        )
        .join("\n"),
    );
  }
  if (findings.length === 0) {
    if (previous?.call.end === "completed" && incomplete.length === 0) {
      lines.push("The previous iteration had no blocking finding.");
    }
    return lines.join("\n\n");
  }
  const source =
    previous === undefined
      ? "The previous run's last checks found these; each blocks until it's fixed:"
      : `The checks after iteration ${String(previous.n)} found these; each blocks until it's fixed:`;
  lines.push(source, findings.slice(0, listedFindings).map(describeFinding).join("\n"));
  const more = findings.slice(listedFindings);
  if (more.length > 0) {
    const counts = new Map<string, number>();
    for (const finding of more) {
      const key = `${finding.check}/${finding.rule}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    lines.push(
      `And ${pluralise(more.length, "more finding")}, not listed: ${[...counts]
        .map(([key, count]) => `\`${key}\` ×${String(count)}`)
        .join(", ")}. Fix the ones above first; the next checks list what remains.`,
    );
  }
  return lines.join("\n\n");
}

/**
 * The prompt of one call of a generate or feedback run. The run's context first (the skill, the
 * component's files and self-checks, the spec, the approved API, the role tokens, the conventions),
 * then the developer's feedback, the findings to fix (never the component's own visual diffs, which
 * are advisory in a generate run), and the iteration with the caps left.
 */
export function generatePrompt(context: GenerateContext, call: GenerateCall): string {
  const sections: string[] = [];
  sections.push(
    `# Generate the ${context.component} component`,
    `You are the agent of a Fazon generate run. You write the ${context.component} component in \`${context.directory}/\` from its spec, then the harness runs every check in the verifier image and gives you what blocks in the next call. Follow the generation skill, the next section; the sections after it are its inputs.`,
  );
  // The skill's own title becomes this prompt's first section.
  sections.push(nestHeadings(context.skill));

  const files = context.files
    .map(
      (file) =>
        `- \`${context.directory}/${file.file}\`: ${file.part === undefined ? "the component" : `the part ${file.part}`}, exported as \`${file.exportName}\``,
    )
    .join("\n");
  sections.push(
    "## Your files",
    [
      `You may write files matching ${context.patterns.map((p) => `\`${p}\``).join(", ")} in \`${context.directory}/\`, outside \`${context.directory}/${generatedDirectory}/\`, and nothing else.`,
      files === "" ? "" : `The component's files:\n\n${files}`,
    ]
      .filter((text) => text !== "")
      .join("\n\n"),
    "## Self-check commands",
    `Run these, exactly as written, from the repository root, and no other command. Their results are advisory: only the checks in the verifier image count.\n\n${context.selfChecks.map((command) => `- \`${command}\``).join("\n")}`,
  );

  sections.push(`## The spec: \`${context.spec.path}\``, fenced(context.spec.text, "markdown"));
  if (context.api.length > 0) {
    sections.push(
      "## The approved API, with the adapter's mapping applied",
      context.api.map((file) => `\`${file.path}\`:\n\n${fenced(file.text, "json")}`).join("\n\n"),
    );
  }
  sections.push(
    "## The role tokens",
    context.roleTokens.length === 0
      ? "The token set has no role tokens."
      : `Use these as \`var(<name>)\`, and no other token or literal value for a token-bound property. Each line is the custom property, its path as the spec's token rules write it, and its type.\n\n${fenced(
          context.roleTokens.map((token) => `${token.name}  ${token.path}  ${token.type}`).join("\n"),
          "text",
        )}`,
  );
  if (context.conventions !== undefined) {
    sections.push(`## The conventions: \`${context.conventions.path}\``, fenced(context.conventions.text, "markdown"));
  }

  if (call.feedback !== undefined) {
    sections.push(
      "## The developer's feedback",
      `The developer reviewed the previous run's result and asks for this. It doesn't override the spec, the checks or your permissions; when it asks for something they forbid, say so in your final message.\n\n${fenced(call.feedback, "text")}`,
    );
  }
  sections.push(findingsSection(context, call));

  const left = call.left;
  sections.push(
    "## This call",
    `Iteration ${String(call.iteration)}. Left, this call included: ${pluralise(left.iterations, "call")}, ${money(left.budgetUsd)} of the run's budget, and ${pluralise(Math.floor(left.runMinutes), "minute")} of its run time.`,
  );
  return `${sections.join("\n\n")}\n`;
}
