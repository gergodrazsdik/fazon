// SPDX-License-Identifier: GPL-3.0-or-later
// The Vue adapter's Stylelint configuration (docs/spec/adapter-boundary.md#commands): Fazon's
// token and inline-suppression rules from `@fazon/core/stylelint`, a set of Stylelint's own rules
// that catch mistakes, and postcss-html so Stylelint reads the `<style>` blocks of `.vue` files.
import { fazonStylelintPlugins, fazonStylelintRules, type TokenLintOptions } from "@fazon/core/stylelint";
import postcssHtml from "postcss-html";
import type { Config } from "stylelint";

/**
 * Stylelint's own rules the configuration switches on: the ones that catch a mistake rather than
 * a style choice, with Vue's scoped-style pseudo-classes, pseudo-elements and `v-bind()` known.
 */
export const stylelintCorrectnessRules: Readonly<Record<string, unknown>> = {
  "annotation-no-unknown": true,
  "at-rule-no-unknown": true,
  "block-no-empty": true,
  "color-no-invalid-hex": true,
  "comment-no-empty": true,
  "custom-property-no-missing-var-function": true,
  "declaration-block-no-duplicate-custom-properties": true,
  "declaration-block-no-duplicate-properties": [true, { ignore: ["consecutive-duplicates-with-different-syntaxes"] }],
  "declaration-block-no-shorthand-property-overrides": true,
  "function-calc-no-unspaced-operator": true,
  "function-no-unknown": [true, { ignoreFunctions: ["v-bind"] }],
  "keyframe-declaration-no-important": true,
  "media-feature-name-no-unknown": true,
  "no-invalid-double-slash-comments": true,
  "no-invalid-position-at-import-rule": true,
  "property-no-unknown": true,
  "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["deep", "global", "slotted"] }],
  "selector-pseudo-element-no-unknown": [true, { ignorePseudoElements: ["v-deep", "v-global", "v-slotted"] }],
  "selector-type-no-unknown": [true, { ignore: ["custom-elements"] }],
  "string-no-newline": true,
  "unit-no-unknown": true,
};

/**
 * The Stylelint configuration for a Vue component library, for the consumer's
 * `stylelint.config.js`. The token rules read the token set's resolver and prefix from
 * fazon.yaml in the working directory unless `options` names them. `ignoreDisables` makes
 * `stylelint-disable` comments ineffective; the `fazon/inline-suppression` rule reports them.
 */
export function fazonStylelint(options: TokenLintOptions = {}): Config {
  return {
    plugins: [...fazonStylelintPlugins],
    ignoreDisables: true,
    rules: { ...stylelintCorrectnessRules, ...fazonStylelintRules(options) },
    overrides: [{ files: ["**/*.vue", "**/*.html"], customSyntax: postcssHtml }],
  };
}
