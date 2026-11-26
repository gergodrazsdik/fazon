// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue adapter's ESLint configuration (docs/spec/adapter-boundary.md#commands): ESLint's and
// typescript-eslint's recommended rules, eslint-plugin-vue's for single-file components, and the
// `lint` check's `inline-suppression` rule (docs/spec/check-catalogue.md#no-inline-suppressions).
import js from "@eslint/js";
import { inlineSuppression, inlineSuppressionMessage } from "@fazon/core";
import type { AST, ESLint, Linter, Rule } from "eslint";
import { defineConfig } from "eslint/config";
import vue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

/**
 * Vue's own suppressions: vue-tsc's directives in a template, which switch type errors off like
 * `@ts-ignore` does.
 */
export const vueSuppressionDirectives: readonly string[] = ["@vue-ignore", "@vue-expect-error", "@vue-skip"];

interface CommentLike {
  readonly value: string;
  readonly loc?: AST.SourceLocation | null;
}

/** The comments of a single-file component's template, as vue-eslint-parser gives them. */
function templateComments(ast: unknown): readonly CommentLike[] {
  const body = (ast as { templateBody?: { comments?: readonly CommentLike[] } }).templateBody;
  return body?.comments ?? [];
}

/**
 * `fazon/inline-suppression`: every inline suppression in a script, a template or a plain module:
 * `eslint-disable*`, `eslint-enable`, `/* eslint <rule>: … *\/`, `stylelint-disable*`, `@ts-ignore`,
 * `@ts-expect-error`, `@ts-nocheck`, and vue-tsc's `@vue-ignore`, `@vue-expect-error`, `@vue-skip`.
 */
export const inlineSuppressionRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow inline suppressions in a component's files; only an exemption in the spec waives a check.",
      url: "https://github.com/gergodrazsdik/fazon/blob/main/docs/spec/check-catalogue.md#no-inline-suppressions",
    },
    schema: [],
    messages: { rejected: "{{message}}" },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        for (const comment of [...sourceCode.getAllComments(), ...templateComments(sourceCode.ast)]) {
          const directive = inlineSuppression(comment.value, vueSuppressionDirectives);
          if (directive === undefined || comment.loc == null) continue;
          context.report({
            loc: comment.loc,
            messageId: "rejected",
            data: { message: inlineSuppressionMessage(directive) },
          });
        }
      },
    };
  },
};

/** Fazon's ESLint plugin: its rules are `fazon/<the check catalogue's rule ID>`. */
export const fazonEslintPlugin: ESLint.Plugin = {
  meta: { name: "fazon" },
  rules: { "inline-suppression": inlineSuppressionRule },
};

/**
 * eslint-plugin-vue's layout rules that `flat/recommended` switches on: formatting, which is the
 * formatter's business (Prettier), so the configuration switches them off.
 */
function vueLayoutRulesOff(): Linter.RulesRecord {
  const rules = vue.rules as Record<string, Rule.RuleModule | undefined>;
  const on = vue.configs["flat/recommended"].flatMap((config) => Object.keys(config.rules ?? {}));
  return Object.fromEntries(
    on.filter((name) => rules[name.replace(/^vue\//, "")]?.meta?.type === "layout").map((name) => [name, "off"]),
  );
}

/**
 * The ESLint configuration for a Vue component library, for the consumer's `eslint.config.js`.
 * Inline configuration is off (`noInlineConfig`), so a directive comment changes nothing, and the
 * `fazon/inline-suppression` rule reports it. eslint-plugin-vue's `comment-directive` rule is off
 * too: it would honour `<!-- eslint-disable -->` in a template even under `noInlineConfig`.
 * typescript-eslint's `ban-ts-comment` is off, as `fazon/inline-suppression` reports the same
 * comments. eslint-plugin-vue's layout rules are off: formatting is the formatter's.
 */
export function fazonVueEslint(): Linter.Config[] {
  return defineConfig(
    { name: "fazon/ignores", ignores: ["**/dist/", "**/storybook-static/", "**/coverage/"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    vue.configs["flat/recommended"],
    {
      name: "fazon/vue-typescript",
      files: ["**/*.vue"],
      languageOptions: {
        parser: vueParser,
        parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"], sourceType: "module" },
      },
      // typescript-eslint's adjustments of ESLint's rules for TypeScript, which it applies to .ts files only.
      rules: { ...tseslint.configs.eslintRecommended.rules, ...vueLayoutRulesOff() },
    },
    {
      name: "fazon/inline-suppression",
      plugins: { fazon: fazonEslintPlugin },
      linterOptions: { noInlineConfig: true },
      rules: {
        "fazon/inline-suppression": "error",
        "vue/comment-directive": "off",
        "@typescript-eslint/ban-ts-comment": "off",
      },
    },
  );
}
