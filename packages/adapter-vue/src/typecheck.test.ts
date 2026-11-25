// SPDX-License-Identifier: GPL-3.0-or-later
// The generated story files and contract tests type-check, with vue-tsc in strict mode, against the
// real types of Vue, Storybook and Vitest (the adapter's devDependencies, at the versions it pins)
// and hand-written components for the example specs (test-fixtures/vue-project/).
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";
import { exampleInput, exampleNames, exampleSpec, fixtures } from "./test-support.js";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/** What `vite/client` declares for the icons' `?raw` imports; the scaffold's TypeScript configuration includes it. */
const viteClient = `declare module "*?raw" {\n  const content: string;\n  export default content;\n}\n`;

describe("the generated TypeScript", () => {
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(path.join(tmpdir(), "fazon-vue-"));
    await cp(fileURLToPath(new URL("vue-project/", fixtures)), project, { recursive: true });
    await writeFile(path.join(project, "env.d.ts"), viteClient);
    // The adapter's own node_modules resolve the packages the generated files import.
    await symlink(path.join(packageRoot, "node_modules"), path.join(project, "node_modules"), "dir");
    for (const name of exampleNames) {
      const input = exampleInput(name);
      const generated = path.join(project, input.directory, "generated");
      await mkdir(generated, { recursive: true });
      for (const file of await vueAdapter.generate(input)) {
        await writeFile(path.join(generated, file.name), file.content);
      }
    }
    const entry = await vueAdapter.entryFile({
      file: "src/index.ts",
      text: undefined,
      components: exampleNames.map((name) => ({ spec: exampleSpec(name), directory: `src/components/${name}` })),
    });
    await writeFile(path.join(project, "src/index.ts"), entry);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("type-checks with vue-tsc in strict mode", { timeout: 120_000 }, async () => {
    const vueTsc = path.join(packageRoot, "node_modules/vue-tsc/bin/vue-tsc.js");
    const result = await run(process.execPath, [vueTsc, "--noEmit", "-p", project]).then(
      () => "",
      (error: unknown) => {
        const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
        return `${stdout}${stderr}`;
      },
    );
    expect(result).toBe("");
  });
});
