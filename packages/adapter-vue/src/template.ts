// SPDX-License-Identifier: GPL-3.0-or-later
// The MIT-0 template text the adapter writes into a consumer's repository (docs/spec/licensing.md,
// LICENSE-001). A template file starts with its `SPDX-License-Identifier: MIT-0` line, which isn't
// written out (LICENSE-002), and holds named sections: a `#: <name>` line, then the section's text.
// A section's `{{placeholder}}`s are filled with the adopter's own data, or with other sections.
import { readFileSync } from "node:fs";
import { withoutTrailingNewlines } from "./text.js";

const licenseLine = "SPDX-License-Identifier: MIT-0";
const sectionLine = /^#: ([a-z][a-z-]*)$/;
const placeholder = /\{\{([a-zA-Z]+)\}\}/g;

/** One template file's sections. */
export interface Template {
  /** A section's text with its placeholders filled; every placeholder needs a value, and every value a placeholder. */
  fill(section: string, values?: Readonly<Record<string, string>>): string;
}

const cache = new Map<string, Template>();

/** Loads `templates/<name>` of the package: from `src/` in the tests, from `dist/` once built. */
export function template(name: string): Template {
  let loaded = cache.get(name);
  if (loaded === undefined) {
    const text = readFileSync(new URL(`../templates/${name}`, import.meta.url), "utf8");
    loaded = parseTemplate(name, text);
    cache.set(name, loaded);
  }
  return loaded;
}

/** Parses a template file's text into its sections. */
export function parseTemplate(name: string, text: string): Template {
  const lines = text.split("\n");
  if (lines[0] !== licenseLine) {
    throw new Error(`The template ${name} must start with the line '${licenseLine}'.`);
  }
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(1)) {
    const header = sectionLine.exec(line);
    if (header !== null) {
      current = [];
      sections.set(header[1] ?? "", current);
    } else if (current !== undefined) {
      current.push(line);
    } else if (line !== "") {
      throw new Error(`The template ${name} has text before its first section.`);
    }
  }
  const texts = new Map([...sections].map(([section, body]) => [section, withoutTrailingNewlines(body.join("\n"))]));

  return {
    fill(section, values = {}) {
      const body = texts.get(section);
      if (body === undefined) throw new Error(`The template ${name} has no section ${section}.`);
      const used = new Set<string>();
      const filled = body.replace(placeholder, (_, key: string) => {
        const value = values[key];
        if (value === undefined)
          throw new Error(`The template ${name}, section ${section}, needs a value for {{${key}}}.`);
        used.add(key);
        return value;
      });
      const unused = Object.keys(values).filter((key) => !used.has(key));
      if (unused.length > 0) {
        throw new Error(`The template ${name}, section ${section}, has no placeholder for ${unused.join(", ")}.`);
      }
      return filled;
    },
  };
}
