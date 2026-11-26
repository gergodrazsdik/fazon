// SPDX-License-Identifier: GPL-3.0-or-later
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { format } from "prettier";
import { configFiles, themesFile, themesFilePath, vueAdapter } from "./index.js";
import { golden } from "./test-support.js";

/** The example library's configuration: the defaults of fazon.yaml's paths and Lucide. */
const example = {
  components: "src/components",
  tokensCss: "src/tokens.css",
  icons: "lucide",
} as const;

/** The example library's themes. */
const exampleThemes = { themes: ["light", "dark"], defaultTheme: "light" };

describe("the configuration files", () => {
  it("are the golden files for the example library", async () => {
    const files = await configFiles(example);
    expect(files.map((file) => file.path)).toEqual([
      "vitest.config.ts",
      ".storybook/main.ts",
      ".storybook/preview.ts",
      ".storybook/vitest.setup.ts",
    ]);
    for (const { path, content } of files) {
      await expect(content).toMatchFileSnapshot(new URL(`${path}.golden`, golden).pathname);
    }
  });

  it("import the library's own stylesheets after the token CSS, and name an own icon set", async () => {
    const files = await configFiles({
      ...example,
      components: "lib/components",
      styles: ["lib/styles/fonts.css"],
      icons: { path: "icons" },
    });
    const text = (path: string) => files.find((file) => file.path === path)?.content;
    expect(text(".storybook/preview.ts")).toContain('import "../src/tokens.css";\nimport "../lib/styles/fonts.css";\n');
    expect(text(".storybook/main.ts")).toContain('components: "lib/components",\n  icons: { path: "icons" },');
    expect(text("vitest.config.ts")).toContain('test: fazonVitest({ components: "lib/components" }),');
  });

  it("have the preview pass the themes module's exports to fazonPreview, with no list of its own", async () => {
    const preview = (await configFiles(example)).find((file) => file.path === ".storybook/preview.ts")?.content;
    const specifier = /^import \{ defaultTheme, themes \} from "(\.[^"]+)";$/m.exec(preview ?? "")?.[1];
    expect(specifier).toBeDefined();
    expect(posix.join(".storybook", `${specifier ?? ""}.ts`)).toBe(themesFilePath);
    expect(preview).toContain("export default fazonPreview({ themes, defaultTheme });");
    expect(preview).not.toContain('"light"');
  });

  it("carry no license header or copyright line (LICENSE-002)", async () => {
    for (const { content } of await configFiles(example)) {
      expect(content).not.toMatch(/SPDX-License-Identifier|copyright|\(c\)/i);
    }
  });
});

describe("the themes module", () => {
  it("is the golden file for the example library, at .storybook/generated/themes.ts", async () => {
    const file = await vueAdapter.themesFile(exampleThemes);
    expect(file.path).toBe(".storybook/generated/themes.ts");
    await expect(file.content).toMatchFileSnapshot(new URL(`${file.path}.golden`, golden).pathname);
  });

  it("exports the themes in the order given and the default theme, and is the same every time", async () => {
    const { content } = await themesFile({ themes: ["dark", "light", "high-contrast"], defaultTheme: "dark" });
    expect(content).toContain('export const themes = ["dark", "light", "high-contrast"] as const;\n');
    expect(content).toContain('export const defaultTheme = "dark";\n');
    expect((await themesFile({ themes: ["dark", "light", "high-contrast"], defaultTheme: "dark" })).content).toBe(
      content,
    );
  });

  it("passes Prettier's defaults and carries no license header or copyright line (LICENSE-002)", async () => {
    const { content } = await themesFile(exampleThemes);
    expect(await format(content, { parser: "typescript" })).toBe(content);
    expect(content).not.toMatch(/SPDX-License-Identifier|copyright|\(c\)/i);
  });
});
