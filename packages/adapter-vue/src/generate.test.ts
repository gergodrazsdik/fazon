// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { format } from "prettier";
import { vueAdapter } from "./index.js";
import { exampleInput, exampleNames, exampleSpec, golden } from "./test-support.js";

describe("the generated files of the example specs", () => {
  it.each(exampleNames)("%s gives the golden files", async (name) => {
    const files = await vueAdapter.generate(exampleInput(name));
    expect(files.map((file) => file.name)).toEqual([
      expect.stringMatching(/^[A-Z][A-Za-z]+\.stories\.ts$/),
      `${name}.contract.test.ts`,
      "api.json",
    ]);
    for (const { name: file, content } of files) {
      await expect(content).toMatchFileSnapshot(
        new URL(`src/components/${name}/generated/${file}.golden`, golden).pathname,
      );
    }
  });

  it.each(exampleNames)("%s is the same every time", async (name) => {
    const first = await vueAdapter.generate(exampleInput(name));
    const second = await vueAdapter.generate(exampleInput(name));
    expect(second).toEqual(first);
  });

  it.each(exampleNames)("%s passes Prettier's defaults", async (name) => {
    for (const { name: file, content } of await vueAdapter.generate(exampleInput(name))) {
      if (file.endsWith(".ts")) {
        expect(await format(content, { parser: "typescript" })).toBe(content);
      }
    }
  });

  it.each(exampleNames)("%s carries no license header or copyright line (LICENSE-002)", async (name) => {
    for (const { content } of await vueAdapter.generate(exampleInput(name))) {
      expect(content).not.toMatch(/SPDX-License-Identifier|copyright|\(c\)/i);
    }
  });
});

describe("the entry file's exports", () => {
  const components = exampleNames.map((name) => ({ spec: exampleSpec(name), directory: `src/components/${name}` }));
  const entry = (text: string | undefined, file = "src/index.ts") => vueAdapter.entryFile({ file, text, components });
  const begin =
    "// fazon:exports:begin `fazon sync` writes the exports up to fazon:exports:end from the specs; edit outside them.";
  const end = "// fazon:exports:end";

  it("export each component and part, in a block of their own", async () => {
    const text = await entry(undefined);
    await expect(text).toMatchFileSnapshot(new URL("src/index.ts.golden", golden).pathname);
    expect(text.startsWith(`${begin}\n`)).toBe(true);
    expect(text.endsWith(`${end}\n`)).toBe(true);
    expect(text).toContain('export { default as TabsTrigger } from "./components/tabs/TabsTrigger.vue";');
    expect(await format(text, { parser: "typescript" })).toBe(text);
  });

  it("are added after what a person wrote", async () => {
    const written = 'import "./tokens.css";\n\nexport const version = "1.0.0";\n';
    const text = await entry(written);
    expect(text.startsWith(`${written}\n${begin}\n`)).toBe(true);
    expect(await entry(text)).toBe(text);
  });

  it("replace only the block, keeping everything around it", async () => {
    const before = 'import "./tokens.css";\n\n';
    const after = '\nexport type { Theme } from "./theme";\n';
    const text = await entry(`${before}${begin}\nexport { default as Old } from "./old.vue";\n${end}\n${after}`);
    expect(text).toBe(`${before}${await entry(undefined)}${after}`);
    expect(text).not.toContain("Old");
  });

  it("are relative to the entry file", async () => {
    const text = await entry(undefined, "lib/entry/index.ts");
    expect(text).toContain('export { default as Button } from "../../src/components/button/Button.vue";');
  });

  it("refuse a file whose markers aren't one begin line followed by one end line", async () => {
    await expect(entry(`${end}\n${begin}\n`)).rejects.toThrow(/exactly one/);
    await expect(entry(`${begin}\n${begin}\n${end}\n`)).rejects.toThrow(/exactly one/);
    await expect(entry(`${begin}\n`)).rejects.toThrow(/exactly one/);
  });

  it("are an empty block without components", async () => {
    expect(await vueAdapter.entryFile({ file: "src/index.ts", text: undefined, components: [] })).toBe(
      `${begin}\n${end}\n`,
    );
  });
});
