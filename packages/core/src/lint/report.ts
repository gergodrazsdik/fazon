// SPDX-License-Identifier: GPL-3.0-or-later
// ESLint's and Stylelint's JSON reports as the `lint` check's findings
// (docs/spec/check-catalogue.md#lint). Fazon's own rules keep their IDs; every other rule of
// either tool is the finding `eslint` or `stylelint`, and its message names the tool's rule.
import path from "node:path";
import type { CheckFinding } from "../checks/types.js";

/** The `lint` check's rule IDs. */
export type LintRuleId = "raw-value" | "raw-token" | "unknown-token" | "inline-suppression" | "eslint" | "stylelint";

/**
 * A finding of the `lint` check, in the run record's shape: always with its file, and blocking
 * until the spec's exemptions are applied.
 */
export interface LintFinding extends CheckFinding {
  readonly check: "lint";
  readonly rule: LintRuleId;
  /** The file, relative to the repository root, with `/` separators. */
  readonly file: string;
}

/** One file of ESLint's JSON report (`eslint --format json`, or `ESLint#lintFiles`). */
export interface EslintFileReport {
  readonly filePath: string;
  readonly messages: readonly {
    readonly ruleId: string | null;
    readonly severity: number;
    readonly message: string;
    readonly line?: number | undefined;
    readonly column?: number | undefined;
    readonly fatal?: boolean | undefined;
  }[];
}

/** One file of Stylelint's JSON report (`stylelint --formatter json`, or `stylelint.lint`'s `results`). */
export interface StylelintFileReport {
  readonly source?: string | undefined;
  readonly warnings: readonly {
    readonly rule: string;
    readonly severity: string;
    readonly text: string;
    readonly line?: number | undefined;
    readonly column?: number | undefined;
  }[];
  readonly parseErrors?:
    | readonly { readonly text: string; readonly line?: number | undefined; readonly column?: number | undefined }[]
    | undefined;
  readonly invalidOptionWarnings?: readonly { readonly text: string }[] | undefined;
}

/** The findings of a lint run, and the problems that mean the check couldn't run properly. */
export interface LintReport {
  readonly findings: readonly LintFinding[];
  /**
   * Problems with the lint configuration itself, such as Stylelint's invalid options. The check
   * ends as **error** when there are any.
   */
  readonly errors: readonly string[];
}

export interface LintReportOptions {
  /** The repository root; findings name files relative to it. */
  readonly root: string;
}

/**
 * The rules whose problems are inline suppressions: Fazon's own, ESLint's notice that a directive
 * comment has no effect under `noInlineConfig`, and typescript-eslint's `ban-ts-comment`, in case
 * a configuration keeps it on.
 */
const eslintSuppressionRules = new Set(["fazon/inline-suppression", "@typescript-eslint/ban-ts-comment"]);
const stylelintRules: Readonly<Record<string, LintRuleId>> = {
  "fazon/raw-value": "raw-value",
  "fazon/raw-token": "raw-token",
  "fazon/unknown-token": "unknown-token",
  "fazon/inline-suppression": "inline-suppression",
};

/** ESLint's text for a directive comment under `linterOptions.noInlineConfig`. */
const noInlineConfigNotice = "has no effect because you have 'noInlineConfig'";

/** ESLint's report as findings. */
export function eslintFindings(files: readonly EslintFileReport[], options: LintReportOptions): LintFinding[] {
  const findings: LintFinding[] = [];
  // ESLint's notices go last, so where Fazon's rule reports the same comment, its message is kept.
  const notices: LintFinding[] = [];
  for (const file of files) {
    const name = relativeFile(file.filePath, options.root);
    for (const message of file.messages) {
      let rule: LintRuleId;
      let text: string;
      if (message.ruleId !== null && eslintSuppressionRules.has(message.ruleId)) {
        rule = "inline-suppression";
        text = message.message;
      } else if (message.ruleId === null && message.message.includes(noInlineConfigNotice)) {
        const text = `${message.message} Inline lint configuration isn't allowed in a component's files.`;
        notices.push(finding("inline-suppression", name, text, message.line, message.column));
        continue;
      } else {
        rule = "eslint";
        text =
          message.ruleId === null
            ? `ESLint${message.fatal === true ? " (parsing)" : ""}: ${message.message}`
            : `ESLint ${message.ruleId}: ${message.message}`;
      }
      findings.push(finding(rule, name, text, message.line, message.column));
    }
  }
  return dedupe([...findings, ...notices]);
}

/** Stylelint's report as findings, and its configuration problems. */
export function stylelintFindings(files: readonly StylelintFileReport[], options: LintReportOptions): LintReport {
  const findings: LintFinding[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const name = file.source === undefined ? "" : relativeFile(file.source, options.root);
    for (const warning of file.warnings) {
      const rule = stylelintRules[warning.rule];
      const text = withoutRuleSuffix(warning.text, warning.rule);
      findings.push(
        rule === undefined
          ? finding("stylelint", name, `Stylelint ${warning.rule}: ${text}`, warning.line, warning.column)
          : finding(rule, name, text, warning.line, warning.column),
      );
    }
    for (const parseError of file.parseErrors ?? []) {
      findings.push(
        finding("stylelint", name, `Stylelint (parsing): ${parseError.text}`, parseError.line, parseError.column),
      );
    }
    for (const invalid of file.invalidOptionWarnings ?? []) {
      errors.push(`${name === "" ? "Stylelint" : name}: ${invalid.text}`);
    }
  }
  return { findings: dedupe(findings), errors: [...new Set(errors)] };
}

/** Both reports as the `lint` check's findings, sorted by file, line and column. */
export function lintFindings(
  reports: { readonly eslint?: readonly EslintFileReport[]; readonly stylelint?: readonly StylelintFileReport[] },
  options: LintReportOptions,
): LintReport {
  const stylelint = stylelintFindings(reports.stylelint ?? [], options);
  const findings = [...eslintFindings(reports.eslint ?? [], options), ...stylelint.findings].sort(
    (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
  );
  return { findings, errors: stylelint.errors };
}

function finding(rule: LintRuleId, file: string, message: string, line?: number, column?: number): LintFinding {
  return {
    check: "lint",
    rule,
    file,
    message,
    blocking: true,
    ...(line === undefined || line < 1 ? {} : { line }),
    ...(column === undefined || column < 1 ? {} : { column }),
  };
}

/** The same rule at the same place once: ESLint's `noInlineConfig` notice and Fazon's rule both report a directive. */
function dedupe(findings: readonly LintFinding[]): LintFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.rule}\0${f.file}\0${String(f.line ?? 0)}\0${String(f.column ?? 0)}`;
    if (f.rule !== "inline-suppression") return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Stylelint ends a rule's message with ` (<rule>)`. */
function withoutRuleSuffix(text: string, rule: string): string {
  const suffix = ` (${rule})`;
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

/** A tool's file path relative to the repository root, with `/` separators. */
function relativeFile(file: string, root: string): string {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  return relative.split(path.sep).join("/");
}
