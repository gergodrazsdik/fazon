// SPDX-License-Identifier: GPL-3.0-or-later
// HTML for the report, escaped by construction: the `html` tag escapes every value it interpolates,
// unless the value is markup the tag made itself. Findings, spec text and paths are untrusted.

/** Markup the `html` tag made: inserted as it is. */
export class Html {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text as HTML: safe in element content and in a double- or single-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function interpolate(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  if (value === undefined || value === null || value === false) return "";
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new TypeError("The report's template can only interpolate text, numbers, markup and lists of them.");
}

/**
 * A template tag that escapes each interpolated value. Markup from another `html` call, and lists
 * of it, go in as they are; `undefined`, `null` and `false` add nothing.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += interpolate(value) + (strings[i + 1] ?? "");
  });
  return new Html(out);
}

/** A relative URL from `/`-separated path segments, each percent-encoded: `#` or `?` in a name stays in the path. */
export function relativeUrl(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}
