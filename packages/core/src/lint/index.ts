// SPDX-License-Identifier: GPL-3.0-or-later
// The `lint` check's rules that don't need Stylelint at run time (docs/spec/check-catalogue.md#lint).
// The Stylelint plugin itself is the subpath `@fazon/core/stylelint`, so the core's main entry
// doesn't load Stylelint.
export { analyzeTokens, type TokenLintRule, type TokenProblem } from "./analyze.js";
export { normalizeLiteral, tokenCatalog, type TokenCatalog } from "./catalog.js";
export { tokenBoundProperty, type TokenBoundProperty, type ValuePart } from "./properties.js";
export {
  eslintFindings,
  lintFindings,
  stylelintFindings,
  type EslintFileReport,
  type LintFinding,
  type LintReport,
  type LintReportOptions,
  type LintRuleId,
  type StylelintFileReport,
} from "./report.js";
export { inlineSuppression, inlineSuppressionMessage } from "./suppressions.js";
export { loadTokenIndex, type TokenLintOptions } from "./tokens.js";
