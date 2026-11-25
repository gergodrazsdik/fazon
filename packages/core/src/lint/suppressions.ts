// SPDX-License-Identifier: GPL-3.0-or-later
// Inline suppressions (docs/spec/check-catalogue.md#no-inline-suppressions): the comments that
// would switch a lint rule or a type error off in one file. The `lint` rule `inline-suppression`
// fails every one in a component's files; only an exemption in the spec waives a check.

/** The directives the rule looks for, each at the start of a comment's text. */
const directives: readonly string[] = [
  "eslint-disable-next-line",
  "eslint-disable-line",
  "eslint-disable",
  "eslint-enable",
  "stylelint-disable-next-line",
  "stylelint-disable-line",
  "stylelint-disable",
  "stylelint-enable",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
];

/** `/* eslint no-console: off *\/`: inline configuration, which can switch a rule off too. */
const eslintConfig = "eslint";

/**
 * The inline suppression a comment carries, such as `eslint-disable-next-line` or `@ts-ignore`, or
 * undefined. `text` is the comment's content without its delimiters (`//`, `/*`, `<!--`); leading
 * whitespace and the `*`s of a block comment are skipped. `extra` adds an adapter's own
 * directives, such as Vue's `@vue-ignore`.
 */
export function inlineSuppression(text: string, extra: readonly string[] = []): string | undefined {
  let start = 0;
  while (start < text.length && (text[start] === "*" || text[start] === "/" || isSpace(text.charCodeAt(start)))) {
    start++;
  }
  const rest = text.slice(start);
  for (const directive of [...directives, ...extra]) {
    if (rest.startsWith(directive) && endsWord(rest, directive.length)) return directive;
  }
  // `eslint <rule>: <severity>` sets a rule's severity for the file.
  if (
    rest.startsWith(eslintConfig) &&
    rest.length > eslintConfig.length &&
    isSpace(rest.charCodeAt(eslintConfig.length))
  ) {
    return eslintConfig;
  }
  return undefined;
}

/** The message of an `inline-suppression` finding for a directive. */
export function inlineSuppressionMessage(directive: string): string {
  return (
    `The inline suppression \`${directive}\` isn't allowed in a component's files. ` +
    "Fix the problem it hides; if a check must be waived, the component's spec needs an exemption, which the reviewer sees."
  );
}

/** Whether the word ends at `at`: the text ends there, or the next character can't continue a name. */
function endsWord(text: string, at: number): boolean {
  const next = text[at];
  return next === undefined || !/[\w-]/.test(next);
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}
