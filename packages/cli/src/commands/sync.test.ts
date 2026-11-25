// SPDX-License-Identifier: GPL-3.0-or-later
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capture, captureJson, copyExample, minimalConfig, removeRepository, repository } from "../test-support.js";

const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
/** The expected output for the example specs, each file with `.golden` added (shared with the adapter's tests). */
const golden = fileURLToPath(new URL("../../../adapter-vue/test-fixtures/golden/", import.meta.url));
const examples = ["button", "dialog", "tabs"] as const;
/** Each example's root file, which the entry file waits for before it exports the component. */
const rootFiles = {
  button: "src/components/button/Button.vue",
  dialog: "src/components/dialog/Dialog.vue",
  tabs: "src/components/tabs/Tabs.vue",
} as const;
const sfc = "<template><div /></template>\n";

/**
 * A repository with the minimal config, the three example specs, the example library's token set,
 * and the root file of each example component (as if each had been generated), so the entry file
 * exports all three, as the golden files have it.
 */
async function exampleRepository(config = minimalConfig): Promise<string> {
  const files = Object.fromEntries(Object.values(rootFiles).map((file) => [file, sfc]));
  const root = await repository({ "fazon.yaml": config, ...files });
  for (const name of examples) await copyExample(root, `valid/${name}.md`, `specs/${name}.md`);
  await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  return root;
}

/** Every file under a directory, relative to it, with `/` separators. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

interface Change {
  path: string;
  change: string;
}

describe("fazon sync", () => {
  let root: string;
  const machine = () => ({ cwd: root });
  const read = (file: string) => readFile(path.join(root, file), "utf8");

  beforeEach(async () => {
    root = await exampleRepository();
  });

  afterEach(async () => {
    await removeRepository(root);
  });

  it("writes the golden files for the example specs", async () => {
    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(0);
    expect(json).toMatchObject({ command: "sync", status: "ok", exitCode: 0 });
    const written = (await filesUnder(path.join(root, "src"))).filter((file) => !file.endsWith(".vue"));
    for (const file of written) {
      await expect(await read(`src/${file}`)).toMatchFileSnapshot(path.join(golden, `src/${file}.golden`));
    }
    const expected = (await filesUnder(path.join(golden, "src"))).map((file) => file.replace(/\.golden$/, ""));
    expect(written).toEqual(expected);
    const result = json.result as {
      check: boolean;
      files: Change[];
      unchanged: number;
      components: string[];
      pending: string[];
    };
    expect(result.check).toBe(false);
    expect(result.files).toEqual(written.map((file) => ({ path: `src/${file}`, change: "added" })));
    expect(result.unchanged).toBe(0);
    expect(result.components).toEqual(["button", "dialog", "tabs"]);
    expect(result.pending).toEqual([]);
  });

  it("writes the manifests the M0 examples hold", async () => {
    await captureJson(["sync"], machine());
    for (const name of examples) {
      expect(await read(`src/components/${name}/generated/stories.json`)).toBe(
        await readFile(path.join(docs, `examples/manifests/${name}.json`), "utf8"),
      );
    }
  });

  it("is clean under --check right after a sync, and rewrites nothing the second time", async () => {
    await captureJson(["sync"], machine());
    const before = await stat(path.join(root, "src/components/button/generated/Button.stories.ts"));
    const again = await captureJson(["sync"], machine());
    expect(again.code).toBe(0);
    expect((again.json.result as { files: Change[] }).files).toEqual([]);
    expect(again.json.messages).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/^Everything is up to date: 14 files\.$/) as string }),
    );
    const after = await stat(path.join(root, "src/components/button/generated/Button.stories.ts"));
    expect(after.mtimeMs).toBe(before.mtimeMs);

    const check = await captureJson(["sync", "--check"], machine());
    expect(check.code).toBe(0);
    expect(check.json.result).toMatchObject({ check: true, files: [], unchanged: 14 });
  });

  it("fails --check on an edited, a missing or an extra generated file, and writes nothing", async () => {
    await captureJson(["sync"], machine());
    const stories = "src/components/button/generated/Button.stories.ts";
    await writeFile(path.join(root, stories), `${await read(stories)}// a hand edit\n`);
    await rm(path.join(root, "src/tokens.css"));
    await writeFile(path.join(root, "src/components/tabs/generated/Old.stories.ts"), "export {};\n");
    await writeFile(path.join(root, "src/components/tabs/generated/provenance.json"), "{}\n");

    const check = await captureJson(["sync", "--check"], machine());
    expect(check.code).toBe(1);
    expect(check.json).toMatchObject({ status: "failed", exitCode: 1 });
    expect((check.json.result as { files: Change[] }).files).toEqual([
      { path: stories, change: "modified" },
      { path: "src/components/tabs/generated/Old.stories.ts", change: "removed" },
      { path: "src/tokens.css", change: "added" },
    ]);
    expect(check.json.messages).toContainEqual({
      level: "error",
      text: "3 files differ from what the specs and the token set give (build rule generated).",
      hint: "fazon sync",
    });
    expect(await read(stories)).toContain("// a hand edit");

    const text = await capture(["sync", "--check"], machine());
    expect(text.stdout).toContain(`modified ${stories}\n`);

    await captureJson(["sync"], machine());
    expect(await read(stories)).not.toContain("// a hand edit");
    expect(await read("src/tokens.css")).toContain("--color-surface-base");
    await expect(stat(path.join(root, "src/components/tabs/generated/Old.stories.ts"))).rejects.toThrow();
    expect(await read("src/components/tabs/generated/provenance.json")).toBe("{}\n");
    expect((await captureJson(["sync", "--check"], machine())).code).toBe(0);
  });

  it("removes the generated directory of a component whose spec is gone, and reports it under --check", async () => {
    await captureJson(["sync"], machine());
    await rm(path.join(root, "specs/tabs.md"));

    const check = await captureJson(["sync", "--check"], machine());
    expect(check.code).toBe(1);
    const differences = (check.json.result as { files: Change[] }).files;
    expect(differences).toEqual(
      expect.arrayContaining([
        { path: "src/components/tabs/generated/Tabs.stories.ts", change: "removed" },
        { path: "src/components/tabs/generated/stories.json", change: "removed" },
        { path: "src/index.ts", change: "modified" },
      ]),
    );
    expect(differences).toHaveLength(5);
    expect(check.json.messages).toContainEqual(
      expect.objectContaining({
        level: "warning",
        text: expect.stringContaining("src/components/tabs/ has no spec, so its generated files are orphans") as string,
      }),
    );

    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(0);
    expect(json.messages).toContainEqual(
      expect.objectContaining({ level: "warning", text: expect.stringContaining("were removed") as string }),
    );
    await expect(stat(path.join(root, "src/components/tabs/generated"))).rejects.toThrow();
    expect(await read("src/components/tabs/Tabs.vue")).toBe(sfc);
    expect(await read("src/index.ts")).not.toContain("Tabs");
    expect((await captureJson(["sync", "--check"], machine())).code).toBe(0);
  });

  it("exports a component only once its root file exists, and lists it as pending until then", async () => {
    await rm(path.join(root, rootFiles.tabs));
    const first = await captureJson(["sync"], machine());
    expect(first.code).toBe(0);
    expect(first.json.result).toMatchObject({ components: ["button", "dialog", "tabs"], pending: ["tabs"] });
    expect(first.json.messages).toContainEqual({
      level: "info",
      text: "Not generated yet, so not exported from the entry file until the root file exists: tabs (src/components/tabs/Tabs.vue).",
    });
    const entry = await read("src/index.ts");
    expect(entry).not.toContain("Tabs");
    expect(entry).toContain('export { default as DialogClose } from "./components/dialog/DialogClose.vue";');
    // It gets only its data files: no story file or contract test, which import it.
    expect(await filesUnder(path.join(root, "src/components/tabs"))).toEqual([
      "generated/api.json",
      "generated/stories.json",
    ]);
    expect((await capture(["sync"], machine())).stdout).toContain("Not generated yet");

    // A pending component's missing export, story file and contract test are what --check expects.
    const check = await captureJson(["sync", "--check"], machine());
    expect(check.code).toBe(0);
    expect(check.json.result).toMatchObject({ files: [], pending: ["tabs"] });

    // Once the root file exists, --check misses them, and the next sync writes them.
    await writeFile(path.join(root, rootFiles.tabs), sfc);
    const expected = [
      { path: "src/components/tabs/generated/Tabs.stories.ts", change: "added" },
      { path: "src/components/tabs/generated/tabs.contract.test.ts", change: "added" },
      { path: "src/index.ts", change: "modified" },
    ];
    const missing = await captureJson(["sync", "--check"], machine());
    expect(missing.code).toBe(1);
    expect(missing.json.result).toMatchObject({ files: expected, pending: [] });
    const second = await captureJson(["sync"], machine());
    expect(second.json.result).toMatchObject({ files: expected, pending: [] });
    for (const file of ["src/index.ts", ...expected.slice(0, 2).map((change) => change.path)]) {
      expect(await read(file)).toBe(await readFile(path.join(golden, `${file}.golden`), "utf8"));
    }
    expect((await captureJson(["sync", "--check"], machine())).code).toBe(0);
  });

  it("writes only data files and exports nothing before any component is generated", async () => {
    for (const file of Object.values(rootFiles)) await rm(path.join(root, file));
    const { json } = await captureJson(["sync"], machine());
    expect(json.result).toMatchObject({ pending: ["button", "dialog", "tabs"] });
    expect(await filesUnder(path.join(root, "src"))).toEqual([
      ...examples.flatMap((name) => [
        `components/${name}/generated/api.json`,
        `components/${name}/generated/stories.json`,
      ]),
      "index.ts",
      "tokens.css",
    ]);
    expect((await captureJson(["sync", "--check"], machine())).code).toBe(0);
    expect(await read("src/index.ts")).toBe(
      "// fazon:exports:begin `fazon sync` writes the exports up to fazon:exports:end from the specs; edit outside them.\n// fazon:exports:end\n",
    );
  });

  it("keeps what a person wrote in the entry file", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    const written = 'import "./tokens.css";\n\nexport const version = "1.0.0";\n';
    await writeFile(path.join(root, "src/index.ts"), written);
    await captureJson(["sync"], machine());
    const entry = await read("src/index.ts");
    expect(entry.startsWith(`${written}\n// fazon:exports:begin`)).toBe(true);
    expect(entry.endsWith(await readFile(path.join(golden, "src/index.ts.golden"), "utf8"))).toBe(true);

    await writeFile(path.join(root, "src/index.ts"), `${entry}\nexport * from "./extra";\n`);
    await captureJson(["sync"], machine());
    expect(await read("src/index.ts")).toBe(`${entry}\nexport * from "./extra";\n`);
  });

  it("refuses an entry file with a broken block, and writes nothing", async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/index.ts"), "// fazon:exports:end\n");
    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(2);
    expect(json.messages).toContainEqual(
      expect.objectContaining({
        text: expect.stringMatching(/^src\/index\.ts: src\/index\.ts must have exactly one/) as string,
      }),
    );
    expect((await filesUnder(path.join(root, "src"))).filter((file) => !file.endsWith(".vue"))).toEqual(["index.ts"]);
  });

  it("builds the token CSS and the story frame with the token prefix", async () => {
    await removeRepository(root);
    root = await exampleRepository(`${minimalConfig}tokens:\n  prefix: fz\n`);
    await captureJson(["sync"], machine());
    const css = await read("src/tokens.css");
    expect(css).toMatch(/^\/\*\n \* Generated by `fazon sync`/);
    expect(css).toContain("--fz-color-surface-base:");
    expect(css).not.toMatch(/--color-surface-base:/);
    expect(await read("src/components/button/generated/Button.stories.ts")).toContain(
      'backgroundColor: "var(--fz-color-surface-base)"',
    );
  });

  it("writes to the paths fazon.yaml sets", async () => {
    await removeRepository(root);
    root = await exampleRepository(
      `${minimalConfig}paths:\n  components: lib/ui\n  entry: lib/main.ts\n  tokensCss: lib/theme/tokens.css\n`,
    );
    await mkdir(path.join(root, "lib/ui/button"), { recursive: true });
    await writeFile(path.join(root, "lib/ui/button/Button.vue"), sfc);
    const { json } = await captureJson(["sync"], machine());
    expect(json.result).toMatchObject({ pending: ["dialog", "tabs"] });
    expect(await filesUnder(path.join(root, "lib"))).toEqual(
      expect.arrayContaining(["main.ts", "theme/tokens.css", "ui/button/generated/Button.stories.ts"]),
    );
    expect(await read("lib/main.ts")).toContain('export { default as Button } from "./ui/button/Button.vue";');
  });

  it("refuses specs that break a rule spec check checks, and writes nothing", async () => {
    await rm(path.join(root, "specs/tabs.md"));
    await copyExample(root, "valid/tabs.md", "specs/tab-bar.md");
    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(2);
    expect(json).toMatchObject({ status: "refused" });
    expect(json.messages).toContainEqual(
      expect.objectContaining({
        text: expect.stringMatching(/^specs\/tab-bar\.md:\d+: SPEC-002 \$\.name: /) as string,
      }),
    );
    expect(json.messages).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining("it wrote nothing") as string,
        hint: "fazon spec check",
      }),
    );
    expect(await filesUnder(path.join(root, "src"))).toEqual(Object.values(rootFiles).map((file) => file.slice(4)));
  });

  it("refuses a token set that breaks a TOKEN rule", async () => {
    const roles = path.join(root, "tokens/roles.json");
    await writeFile(roles, (await readFile(roles, "utf8")).replace(/"\{font-size\.[^"]+\}"/, '"{font-size.missing}"'));
    const { code, json } = await captureJson(["sync", "--check"], machine());
    expect(code).toBe(2);
    expect(json.messages).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/^tokens\/roles\.json: TOKEN-002 /) as string }),
    );
  });

  it("refuses a token file that breaks its schema (TOKEN-001)", async () => {
    await writeFile(
      path.join(root, "tokens/raw.json"),
      '{ "color": { "x": { "$type": "color", "$value": "red" } } }\n',
    );
    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(2);
    expect(json.messages).toContainEqual(
      expect.objectContaining({
        text: expect.stringMatching(/^tokens\/raw\.json: TOKEN-001 \$\.color\.x\.\$value: /) as string,
      }),
    );
  });

  it("refuses without the specs directory", async () => {
    await rm(path.join(root, "specs"), { recursive: true });
    const { code, json } = await captureJson(["sync"], machine());
    expect(code).toBe(2);
    expect(json.messages).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("the specs directory 'specs' doesn't exist") as string }),
    );
  });

  it("takes no component names", async () => {
    expect((await captureJson(["sync", "button"], machine())).code).toBe(2);
  });
});
