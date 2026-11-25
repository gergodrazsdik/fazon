// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The kebab-case form of a PascalCase component name, which names its spec file:
 * `Button` is `button`, `RadioGroup` is `radio-group`. A run of capitals is one word that ends
 * before the capital that starts the next one: `HTMLEditor` is `html-editor`.
 */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Whether a name is kebab-case, as component names on the command line and spec file names are. */
export function isKebabCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}
