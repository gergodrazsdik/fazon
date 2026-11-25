// SPDX-License-Identifier: GPL-3.0-or-later
// The lint configuration files `fazon init` writes into a Vue component library
// (docs/spec/adapter-boundary.md#what-fazon-init-writes-for-vue), from the MIT-0 templates in
// templates/lint/. Each calls the factory `@fazon/adapter-vue/lint` exports.
import { template } from "../template.js";

/** The lint configuration files, by their path in the consumer's repository, each ending with a newline. */
export function lintConfigFiles(): Readonly<Record<"eslint.config.js" | "stylelint.config.js", string>> {
  return {
    "eslint.config.js": `${template("lint/eslint.config.js.tmpl").fill("file")}\n`,
    "stylelint.config.js": `${template("lint/stylelint.config.js.tmpl").fill("file")}\n`,
  };
}
