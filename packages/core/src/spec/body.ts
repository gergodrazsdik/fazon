// SPDX-License-Identifier: GPL-3.0-or-later
// The spec body as the SPEC rules read it: its lines outside fenced code blocks, and its
// second-level headings.

/** The body's lines outside fenced code blocks, with their line in the file. */
export function proseLines(body: string, firstLine: number): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fence: string | undefined;
  body.split("\n").forEach((text, index) => {
    const trimmed = text.trimStart();
    const marker = trimmed.startsWith("```") ? "```" : trimmed.startsWith("~~~") ? "~~~" : undefined;
    if (marker !== undefined && (fence === undefined || fence === marker)) {
      fence = fence === undefined ? marker : undefined;
      return;
    }
    if (fence === undefined) lines.push({ line: firstLine + index, text });
  });
  return lines;
}

/**
 * The text of a second-level ATX heading (`## Purpose`), or undefined for any other line. Up to
 * three spaces may come before it, and a closing run of `#` after a space isn't part of the text.
 */
export function levelTwoHeading(line: string): string | undefined {
  const text = line.trimStart();
  if (line.length - text.length > 3 || !text.startsWith("##") || text.charAt(2) === "#") return undefined;
  const rest = text.slice(2);
  if (rest !== "" && !rest.startsWith(" ") && !rest.startsWith("\t")) return undefined;
  const content = rest.trim();
  let end = content.length;
  while (end > 0 && content.charAt(end - 1) === "#") end--;
  if (end === content.length) return content;
  const before = content.slice(0, end);
  return before === "" || before.endsWith(" ") || before.endsWith("\t") ? before.trim() : content;
}

/** The body's second-level headings outside fenced code blocks, by text, with the line of the first. */
export function levelTwoHeadings(body: string, firstLine: number): Map<string, number> {
  const headings = new Map<string, number>();
  for (const { line, text } of proseLines(body, firstLine)) {
    const heading = levelTwoHeading(text);
    if (heading !== undefined && !headings.has(heading)) headings.set(heading, line);
  }
  return headings;
}
