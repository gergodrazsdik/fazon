// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  eslintFindings,
  lintFindings,
  stylelintFindings,
  type EslintFileReport,
  type StylelintFileReport,
} from "../index.js";

const root = "/repo";

const eslint: EslintFileReport[] = [
  {
    filePath: "/repo/src/components/button/Button.vue",
    messages: [
      {
        ruleId: null,
        severity: 1,
        message:
          "'// eslint-disable-next-line' has no effect because you have 'noInlineConfig' setting in your config.",
        line: 3,
        column: 1,
      },
      {
        ruleId: "fazon/inline-suppression",
        severity: 2,
        message: "The inline suppression `eslint-disable-next-line` isn't allowed.",
        line: 3,
        column: 1,
      },
      {
        ruleId: "@typescript-eslint/ban-ts-comment",
        severity: 2,
        message: 'Do not use "@ts-nocheck".',
        line: 1,
        column: 1,
      },
      {
        ruleId: "vue/require-v-for-key",
        severity: 1,
        message: "Elements in iteration expect to have 'v-bind:key' directives.",
        line: 12,
        column: 5,
      },
      { ruleId: null, severity: 2, message: "Parsing error: Unexpected token", line: 20, column: 2, fatal: true },
      {
        ruleId: null,
        severity: 1,
        message:
          "'/* eslint no-console: off */' has no effect because you have 'noInlineConfig' setting in your config.",
        line: 7,
        column: 1,
      },
    ],
  },
];

const stylelint: StylelintFileReport[] = [
  {
    source: "/repo/src/components/button/Button.vue",
    warnings: [
      {
        rule: "fazon/raw-value",
        severity: "error",
        text: "`#2050d0` in `background-color` is a raw value. (fazon/raw-value)",
        line: 30,
        column: 21,
      },
      { rule: "fazon/raw-token", severity: "error", text: "raw token (fazon/raw-token)", line: 31, column: 9 },
      { rule: "fazon/unknown-token", severity: "error", text: "unknown (fazon/unknown-token)", line: 32, column: 9 },
      {
        rule: "fazon/inline-suppression",
        severity: "error",
        text: "suppressed (fazon/inline-suppression)",
        line: 29,
        column: 1,
      },
      {
        rule: "color-no-invalid-hex",
        severity: "warning",
        text: 'Unexpected invalid hex color "#ggg" (color-no-invalid-hex)',
        line: 33,
        column: 10,
      },
    ],
    parseErrors: [],
    invalidOptionWarnings: [{ text: 'Invalid option "x" for rule "fazon/raw-value"' }],
  },
];

describe("eslintFindings", () => {
  it("maps Fazon's rule, the noInlineConfig notice and ban-ts-comment to inline-suppression, once per comment", () => {
    const findings = eslintFindings(eslint, { root });
    expect(findings.filter((f) => f.rule === "inline-suppression").map((f) => [f.line, f.message])).toEqual([
      [3, "The inline suppression `eslint-disable-next-line` isn't allowed."],
      [1, 'Do not use "@ts-nocheck".'],
      [7, expect.stringContaining("'/* eslint no-console: off */' has no effect") as unknown],
    ]);
  });

  it("maps any other rule to eslint, naming the rule", () => {
    const findings = eslintFindings(eslint, { root }).filter((f) => f.rule === "eslint");
    expect(findings).toEqual([
      {
        check: "lint",
        rule: "eslint",
        file: "src/components/button/Button.vue",
        message: "ESLint vue/require-v-for-key: Elements in iteration expect to have 'v-bind:key' directives.",
        line: 12,
        column: 5,
        blocking: true,
      },
      {
        check: "lint",
        rule: "eslint",
        file: "src/components/button/Button.vue",
        message: "ESLint (parsing): Parsing error: Unexpected token",
        line: 20,
        column: 2,
        blocking: true,
      },
    ]);
  });
});

describe("stylelintFindings", () => {
  it("keeps Fazon's rule IDs, maps the rest to stylelint, and reports invalid options as errors", () => {
    const { findings, errors } = stylelintFindings(stylelint, { root });
    expect(findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["raw-value", 30, "`#2050d0` in `background-color` is a raw value."],
      ["raw-token", 31, "raw token"],
      ["unknown-token", 32, "unknown"],
      ["inline-suppression", 29, "suppressed"],
      ["stylelint", 33, 'Stylelint color-no-invalid-hex: Unexpected invalid hex color "#ggg"'],
    ]);
    expect(findings[0]).toMatchObject({ check: "lint", file: "src/components/button/Button.vue", column: 21 });
    expect(errors).toEqual(['src/components/button/Button.vue: Invalid option "x" for rule "fazon/raw-value"']);
  });

  it("reports a parse error as a stylelint finding", () => {
    const { findings } = stylelintFindings(
      [{ source: "src/a.css", warnings: [], parseErrors: [{ text: "Unclosed block", line: 2, column: 1 }] }],
      { root },
    );
    expect(findings).toEqual([
      {
        check: "lint",
        rule: "stylelint",
        file: "src/a.css",
        message: "Stylelint (parsing): Unclosed block",
        line: 2,
        column: 1,
        blocking: true,
      },
    ]);
  });
});

describe("lintFindings", () => {
  it("merges both reports, sorted by file, line and column", () => {
    const { findings, errors } = lintFindings({ eslint, stylelint }, { root });
    expect(findings.map((f) => f.line)).toEqual([1, 3, 7, 12, 20, 29, 30, 31, 32, 33]);
    expect(errors).toHaveLength(1);
  });

  it("is empty for clean reports", () => {
    expect(lintFindings({ eslint: [{ filePath: "/repo/a.ts", messages: [] }], stylelint: [] }, { root })).toEqual({
      findings: [],
      errors: [],
    });
  });
});
