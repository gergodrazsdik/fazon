// SPDX-License-Identifier: GPL-3.0-or-later
// `@fazon/adapter-vue/lint`: the lint configuration a Vue component library's eslint.config.js and
// stylelint.config.js call (docs/spec/adapter-boundary.md#what-fazon-init-writes-for-vue). A
// subpath of its own, so the adapter's main entry doesn't load ESLint or Stylelint.
export { fazonEslintPlugin, fazonVueEslint, inlineSuppressionRule, vueSuppressionDirectives } from "./eslint.js";
export { fazonStylelint, stylelintCorrectnessRules } from "./stylelint.js";
