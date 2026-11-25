// SPDX-License-Identifier: GPL-3.0-or-later
// Text helpers that run in linear time on any input, such as a consumer's own files. A regular
// expression like /\n*$/ retries from every newline of a long run that isn't at the end, which
// takes quadratic time.

/** The text without the newlines at its end. */
export function withoutTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end--;
  return text.slice(0, end);
}

/** The text with exactly one newline at its end. */
export function withOneTrailingNewline(text: string): string {
  return `${withoutTrailingNewlines(text)}\n`;
}
