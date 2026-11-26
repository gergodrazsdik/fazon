// SPDX-License-Identifier: GPL-3.0-or-later
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../findings.js";
import { validateWithSchema, type PathSegment } from "../validation/validate.js";
import { parseYaml } from "../yaml.js";
import type { Spec } from "./types.js";

/** One spec file, read and checked against SPEC-001. */
export interface SpecFile {
  /** Relative to the repository root, with `/` separators: `specs/button.md`. */
  readonly file: string;
  /** The component name the file name gives: `button` for `specs/button.md`. */
  readonly component: string;
  /** The front matter, typed; present only when it passes SPEC-001. */
  readonly spec?: Spec;
  /** The Markdown after the front matter. */
  readonly body: string;
  /** The 1-based line in the file where `body` starts. */
  readonly bodyLine: number;
  /** The 1-based line in the file of the value at a path in the front matter, or of `key` in it. */
  readonly lineOf: (segments: readonly PathSegment[], key?: string) => number | undefined;
  /** SPEC-001's findings: the front matter is missing, isn't YAML, or breaks the schema. */
  readonly findings: readonly Finding[];
}

const rule = "SPEC-001";

/** Splits a spec into its front matter and body, and checks the front matter against the schema. */
export function parseSpecFile(file: string, text: string): SpecFile {
  const component = path.posix.basename(file, ".md");
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  const isFence = (line: string | undefined) => line?.trimEnd() === "---";
  const noLines = () => undefined;

  if (!isFence(lines[0])) {
    const message = "the file doesn't start with front matter: a '---' line, the YAML fields, and another '---' line";
    return { file, component, body: text, bodyLine: 1, lineOf: noLines, findings: [{ rule, file, line: 1, message }] };
  }
  const end = lines.findIndex((line, index) => index > 0 && isFence(line));
  if (end === -1) {
    const message = "the front matter has no closing '---' line";
    return {
      file,
      component,
      body: "",
      bodyLine: lines.length + 1,
      lineOf: noLines,
      findings: [{ rule, file, line: 1, message }],
    };
  }

  const body = lines.slice(end + 1).join("\n");
  const bodyLine = end + 2;
  // The front matter starts on the file's second line.
  const yaml = parseYaml(lines.slice(1, end).join("\n"));
  const lineOf = (segments: readonly PathSegment[], key?: string) => {
    const line = yaml.lineOf(segments, key);
    return line === undefined ? undefined : line + 1;
  };
  if (yaml.errors.length > 0) {
    const findings = yaml.errors.map((error) => ({
      rule,
      file,
      ...(error.line === undefined ? {} : { line: error.line + 1 }),
      message: `the front matter isn't valid YAML: ${error.message}`,
    }));
    return { file, component, body, bodyLine, lineOf, findings };
  }

  const findings = validateWithSchema("spec", yaml.data).map((finding): Finding => {
    const line = lineOf(finding.segments, finding.key);
    return { rule, file, path: finding.path, ...(line === undefined ? {} : { line }), message: finding.message };
  });
  if (findings.length > 0) {
    return { file, component, body, bodyLine, lineOf, findings };
  }
  return { file, component, spec: yaml.data as Spec, body, bodyLine, lineOf, findings };
}

/**
 * Reads every spec (`*.md`) in a directory, in file name order.
 * @param root the repository root
 * @param directory the specs directory, relative to the root
 */
export async function readSpecFiles(root: string, directory: string): Promise<SpecFile[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(path.join(root, directory, name), "utf8");
      return parseSpecFile(path.posix.join(toPosix(directory), name), text);
    }),
  );
}

function toPosix(directory: string): string {
  return directory.split(path.sep).join("/");
}
