// SPDX-License-Identifier: GPL-3.0-or-later
import path from "node:path";
import {
  checkedSpecRules,
  checkSpec,
  isKebabCase,
  kebabCase,
  readSpecCheckInputs,
  readSpecFiles,
  specNotes,
  type SpecFile,
} from "@fazon/core";
import { findAdapter } from "../adapters.js";
import { refused, type Message, type Outcome, type TextLine } from "../outcome.js";
import { describeFinding, requireConfig, type Context, type Invocation } from "./context.js";

/** `fazon spec check [<component>...]` (docs/spec/cli.md#fazon-spec-check). */
export async function specCheck(invocation: Invocation, context: Context): Promise<Outcome> {
  for (const name of invocation.positionals) {
    if (!isKebabCase(name)) {
      const suggestion = kebabCase(name.replace(/[^A-Za-z0-9]+/g, "-")).replace(/-+/g, "-");
      return refused(
        `'${name}' isn't a component name. Name components in kebab-case, as their spec files are named: ${suggestion}.`,
        isKebabCase(suggestion) ? `fazon spec check ${suggestion}` : undefined,
      );
    }
  }

  const loaded = await requireConfig(context);
  if ("refusal" in loaded) {
    return loaded.refusal;
  }
  const directory = loaded.config.paths.specs;

  let all: SpecFile[];
  try {
    all = await readSpecFiles(context.environment.cwd, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return refused(
        `The specs directory '${directory}' doesn't exist. Create it, or set paths.specs in fazon.yaml to where the specs are.`,
      );
    }
    throw error;
  }

  const byComponent = new Map(all.map((file) => [file.component, file]));
  const missing = invocation.positionals.filter((name) => !byComponent.has(name));
  if (missing.length > 0) {
    const [first] = missing;
    const files = missing.map((name) => `${path.posix.join(directory, name)}.md`).join(", ");
    return refused(
      `There's no spec at ${files}. Write ${missing.length === 1 ? "it" : "them"} first, or check the component name.`,
      first === undefined ? undefined : `fazon spec new ${first}`,
    );
  }

  const selected =
    invocation.positionals.length === 0
      ? all
      : [...new Set(invocation.positionals)].flatMap((name) => byComponent.get(name) ?? []);
  const { inputs, skipped } = await readSpecCheckInputs(
    context.environment.cwd,
    loaded.config,
    findAdapter(loaded.config.adapter),
  );
  const checked = selected.map((file) => ({
    file,
    findings: checkSpec(file, all, inputs),
    notes: specNotes(file, inputs),
  }));
  const findingCount = checked.reduce((sum, spec) => sum + spec.findings.length, 0);
  const failing = checked.filter((spec) => spec.findings.length > 0).length;

  const text: TextLine[] = [];
  for (const { file, findings, notes } of checked) {
    if (context.global.verbose && findings.length === 0) {
      text.push({ stream: "stdout", text: `ok   ${file.file}` });
    }
    for (const finding of findings) {
      text.push({ stream: "stderr", text: describeFinding(finding, true) });
      if (finding.hint !== undefined) {
        text.push({ stream: "stderr", text: `     ${finding.hint}` });
      }
    }
    if (context.global.verbose) {
      for (const note of notes) {
        const location = note.line === undefined ? note.file : `${note.file}:${String(note.line)}`;
        text.push({ stream: "stdout", text: `note ${location}: ${note.message}` });
      }
    }
  }

  const specs = `${String(checked.length)} ${checked.length === 1 ? "spec" : "specs"} checked`;
  const messages: Message[] = [
    findingCount === 0
      ? { level: "info", text: checked.length === 0 ? `No specs in ${directory}/.` : `${specs}: no findings.` }
      : {
          level: "error",
          text: `${specs}: ${String(findingCount)} ${findingCount === 1 ? "finding" : "findings"} in ${String(failing)} ${failing === 1 ? "spec" : "specs"}.`,
        },
    { level: "info", text: `Checked ${ruleRange(checkedSpecRules)}.` },
    // An input that couldn't be read matters only to specs that name tokens or have fixtures.
    ...skipped
      .filter(({ input }) =>
        selected.some(({ spec }) => (input === "tokens" ? spec?.tokens : spec?.fixtures) !== undefined),
      )
      .map(({ message }): Message => ({ level: "warning", text: message })),
  ];

  return {
    status: findingCount === 0 ? "ok" : "failed",
    messages,
    result: {
      rules: checkedSpecRules,
      specs: checked.map(({ file, findings, notes }) => ({
        spec: file.file,
        findings: findings.map(({ rule, path: at, line, message, hint }) => ({
          rule,
          ...(at === undefined ? {} : { path: at }),
          ...(line === undefined ? {} : { line }),
          message,
          ...(hint === undefined ? {} : { hint }),
        })),
        ...(notes.length === 0
          ? {}
          : {
              notes: notes.map(({ path: at, line, message }) => ({
                ...(at === undefined ? {} : { path: at }),
                ...(line === undefined ? {} : { line }),
                message,
              })),
            }),
      })),
    },
    text,
  };
}

/** `SPEC-001 to SPEC-019` for rules that follow each other; `a, b and c` otherwise. */
function ruleRange(rules: readonly string[]): string {
  const numbers = rules.map((rule) => Number(rule.slice("SPEC-".length)));
  const consecutive = numbers.every((n, index) => index === 0 || n === (numbers[index - 1] ?? 0) + 1);
  if (consecutive && rules.length > 2) return `${rules[0] ?? ""} to ${rules.at(-1) ?? ""}`;
  return rules.length <= 1 ? (rules[0] ?? "") : `${rules.slice(0, -1).join(", ")} and ${rules.at(-1) ?? ""}`;
}
