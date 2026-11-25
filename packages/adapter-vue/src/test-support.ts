// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the adapter's tests: the M0 example specs as generator input. Not exported from the package.
import { readFileSync } from "node:fs";
import { baseStyles, buildManifest, parseSpecFile, type GenerateInput, type Spec } from "@fazon/core";

export const docs = new URL("../../../docs/spec/", import.meta.url);
export const fixtures = new URL("../test-fixtures/", import.meta.url);
/** The expected output for the example specs, as `fazon sync` writes it into a repository, each file with `.golden` added. */
export const golden = new URL("golden/", fixtures);

export const exampleNames = ["button", "dialog", "tabs"] as const;

export function exampleSpec(name: string): Spec {
  const file = parseSpecFile(
    `specs/${name}.md`,
    readFileSync(new URL(`examples/specs/valid/${name}.md`, docs), "utf8"),
  );
  if (file.spec === undefined) throw new Error(`the example ${name} doesn't pass SPEC-001`);
  return file.spec;
}

/** The generator's input for an example spec, with the default config and the example library's themes. */
export function exampleInput(name: string, overrides: Partial<GenerateInput> = {}): GenerateInput {
  const spec = exampleSpec(name);
  const specFile = `specs/${name}.md`;
  return {
    spec,
    specFile,
    uses: Object.fromEntries((spec.uses ?? []).map((used) => [used, exampleSpec(used.toLowerCase())])),
    manifest: buildManifest(spec, { file: specFile, themes: ["light", "dark"] }),
    directory: `src/components/${name}`,
    icons: "lucide",
    baseStyles: baseStyles(),
    ...overrides,
  };
}
