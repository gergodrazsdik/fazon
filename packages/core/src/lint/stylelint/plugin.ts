// SPDX-License-Identifier: GPL-3.0-or-later
// Fazon's Stylelint plugin (`@fazon/core/stylelint`): the `lint` check's token rules and its
// inline-suppression rule for stylesheets (docs/spec/check-catalogue.md#lint). Plain CSS, so it
// lives in the core; an adapter's Stylelint configuration adds the syntax for its file types.
import type { Container, Root } from "postcss";
import stylelint, { type Plugin, type PostcssResult, type Rule } from "stylelint";
import type { TokenIndex } from "../../tokens/build.js";
import { analyzeTokens, type TokenLintRule, type TokenProblem } from "../analyze.js";
import { tokenCatalog } from "../catalog.js";
import { inlineSuppression, inlineSuppressionMessage } from "../suppressions.js";
import { loadTokenIndex, type TokenLintOptions } from "../tokens.js";

export type { TokenLintOptions } from "../tokens.js";

/** The plugin's namespace: its rules are `fazon/<the check catalogue's rule ID>`. */
export const namespace = "fazon";

/** The rule names, by the `lint` check's rule ID. */
export const stylelintRuleNames = {
  "raw-value": `${namespace}/raw-value`,
  "raw-token": `${namespace}/raw-token`,
  "unknown-token": `${namespace}/unknown-token`,
  "inline-suppression": `${namespace}/inline-suppression`,
} as const;

const meta = { url: "https://github.com/gergodrazsdik/fazon/blob/main/docs/spec/check-catalogue.md#lint" };

const isString = (value: unknown) => typeof value === "string";
const isIndex = (value: unknown) => typeof value === "object" && value !== null && "byTheme" in value;

/**
 * The topmost container of a stylesheet: the document of several `<style>` blocks, or the
 * stylesheet. A custom syntax such as postcss-html links each root to its document through
 * `root.document`; PostCSS's own documents through `root.parent`.
 */
function topOf(root: Root): Container {
  const document = (root as Root & { document?: Container }).document ?? root.parent;
  return document?.type === "document" ? (document as Container) : root;
}

const analyses = new WeakMap<Container, Map<TokenIndex, Promise<TokenProblem[]>>>();

/** The token problems of the root's whole document, analysed once for all three rules. */
function problemsOf(root: Root, index: TokenIndex): Promise<TokenProblem[]> {
  const top = topOf(root);
  let byIndex = analyses.get(top);
  if (byIndex === undefined) {
    byIndex = new Map();
    analyses.set(top, byIndex);
  }
  let problems = byIndex.get(index);
  if (problems === undefined) {
    problems = Promise.resolve(analyzeTokens(top, tokenCatalog(index)));
    byIndex.set(index, problems);
  }
  return problems;
}

function validOptions(result: PostcssResult, ruleName: string, primary: unknown, secondary: unknown): boolean {
  return stylelint.utils.validateOptions(
    result,
    ruleName,
    { actual: primary, possible: [true] },
    {
      actual: secondary,
      possible: { root: [isString], tokens: [isString], prefix: [isString], index: [isIndex] },
      optional: true,
    },
  );
}

function tokenRule(id: TokenLintRule): Rule<true, TokenLintOptions | undefined> {
  const ruleName = stylelintRuleNames[id];
  const messages = stylelint.utils.ruleMessages(ruleName, { rejected: (text: string) => text });
  const rule: Rule<true, TokenLintOptions | undefined> = (primary, secondary) => async (root, result) => {
    if (!validOptions(result, ruleName, primary, secondary)) return;
    const index = await loadTokenIndex(secondary ?? {});
    for (const problem of await problemsOf(root, index)) {
      if (problem.rule !== id || problem.declaration.root() !== root) continue;
      stylelint.utils.report({
        ruleName,
        result,
        node: problem.declaration,
        index: problem.index,
        endIndex: problem.endIndex,
        message: messages.rejected,
        messageArgs: [problem.message],
      });
    }
  };
  rule.ruleName = ruleName;
  rule.messages = messages;
  rule.meta = meta;
  return rule;
}

function inlineSuppressionRule(): Rule<true> {
  const ruleName = stylelintRuleNames["inline-suppression"];
  const messages = stylelint.utils.ruleMessages(ruleName, { rejected: inlineSuppressionMessage });
  const rule: Rule<true> = (primary) => (root, result) => {
    if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;
    root.walkComments((comment) => {
      const directive = inlineSuppression(comment.text);
      if (directive === undefined) return;
      stylelint.utils.report({ ruleName, result, node: comment, message: messages.rejected, messageArgs: [directive] });
    });
  };
  rule.ruleName = ruleName;
  rule.messages = messages;
  rule.meta = meta;
  return rule;
}

/** The plugin's rules, for a Stylelint configuration's `plugins`. */
export const fazonStylelintPlugins: readonly Plugin[] = [
  stylelint.createPlugin(stylelintRuleNames["raw-value"], tokenRule("raw-value")),
  stylelint.createPlugin(stylelintRuleNames["raw-token"], tokenRule("raw-token")),
  stylelint.createPlugin(stylelintRuleNames["unknown-token"], tokenRule("unknown-token")),
  stylelint.createPlugin(stylelintRuleNames["inline-suppression"], inlineSuppressionRule()),
];

/**
 * The plugin's rules switched on, for a Stylelint configuration's `rules`. The token rules share
 * `options`; set the configuration's `ignoreDisables` too, so a `stylelint-disable` comment can't
 * switch them off.
 */
export function fazonStylelintRules(options: TokenLintOptions = {}): Record<string, unknown> {
  const tokenOptions = Object.keys(options).length === 0 ? true : [true, options];
  return {
    [stylelintRuleNames["raw-value"]]: tokenOptions,
    [stylelintRuleNames["raw-token"]]: tokenOptions,
    [stylelintRuleNames["unknown-token"]]: tokenOptions,
    [stylelintRuleNames["inline-suppression"]]: true,
  };
}

export default fazonStylelintPlugins;
