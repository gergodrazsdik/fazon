// SPDX-License-Identifier: GPL-3.0-or-later
// Everything the Vue adapter writes in a component's `generated/` directory, and the entry file's
// exports (docs/spec/adapter-boundary.md#component-files).
import path from "node:path";
import { AdapterError, kebabCase, type EntryInput, type GeneratedFile, type GenerateInput } from "@fazon/core";
import { format } from "prettier";
import { apiFile, mapComponent } from "./api.js";
import { relativeImport, storyFileName, storyFileText } from "./stories.js";
import { template } from "./template.js";
import { withOneTrailingNewline } from "./text.js";

/** The API file's name in `generated/`. */
export const apiFileName = "api.json";

/**
 * The story file, the contract tests and api.json. TypeScript is formatted with Prettier's
 * defaults; JSON is written as `JSON.stringify` writes it with two spaces, as the manifest is.
 */
export async function generateFiles(input: GenerateInput): Promise<GeneratedFile[]> {
  const component = mapComponent(input.spec, input.specFile, input.prefix);
  const api = apiFile(component, input.specFile);
  const stories = storyFileName(input.spec);
  const contract = template("contract.test.ts.tmpl").fill("file", {
    spec: input.specFile,
    component: input.spec.name,
    stories: stories.replace(/\.ts$/, ""),
  });
  return [
    { name: stories, content: await formatTypeScript(storyFileText(input, component)), importsComponent: true },
    {
      name: `${kebabCase(input.spec.name)}.contract.test.ts`,
      content: await formatTypeScript(contract),
      importsComponent: true,
    },
    {
      name: apiFileName,
      content: `${JSON.stringify(api, null, 2)}\n`,
      importsComponent: false,
    },
  ];
}

const entry = template("entry.ts.tmpl");

/**
 * The entry file with its generated block of exports, one per component and part, in component
 * name order. The block replaces the one there, or is added at the end; the rest of the file stays
 * as it is.
 */
export async function entryFileText({ file, text, components }: EntryInput): Promise<string> {
  const begin = entry.fill("begin");
  const end = entry.fill("end");
  const lines = components.flatMap(({ spec, directory }) =>
    mapComponent(spec, "").scopes.map((scope) =>
      entry.fill("export", {
        name: scope.exportName,
        path: relativeImport(path.posix.dirname(file), path.posix.join(directory, scope.file)),
      }),
    ),
  );
  const exports = lines.length === 0 ? "" : await formatTypeScript(lines.join("\n"));
  const block = `${begin}\n${exports}${end}\n`;

  if (text === undefined || text.trim() === "") return block;
  const all = text.split("\n");
  const at = (marker: string) => all.flatMap((line, index) => (line.trim() === marker ? [index] : []));
  const begins = at(begin);
  const ends = at(end);
  if (begins.length === 0 && ends.length === 0) {
    return `${withOneTrailingNewline(text)}\n${block}`;
  }
  const [first] = begins;
  const [last] = ends;
  if (begins.length !== 1 || ends.length !== 1 || first === undefined || last === undefined || last < first) {
    throw new AdapterError(`${file} must have exactly one '${begin}' line, followed by one '${end}' line.`, {
      file,
      hint: "Remove the extra or misplaced marker lines; fazon sync then rewrites the exports between them.",
    });
  }
  const after = all.slice(last + 1).join("\n");
  return [...all.slice(0, first), block.replace(/\n$/, ""), ...(after === "" ? [""] : [after])].join("\n");
}

/** TypeScript as Prettier's defaults format it. */
export function formatTypeScript(text: string): Promise<string> {
  return format(text, { parser: "typescript" });
}
