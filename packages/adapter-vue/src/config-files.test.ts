// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { configFiles } from "./index.js";
import { golden } from "./test-support.js";

/** The example library's configuration: the defaults of fazon.yaml's paths, two themes and Lucide. */
const example = {
  components: "src/components",
  tokensCss: "src/tokens.css",
  themes: ["light", "dark"],
  icons: "lucide",
} as const;

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

  it("carry no license header or copyright line (LICENSE-002)", async () => {
    for (const { content } of await configFiles(example)) {
      expect(content).not.toMatch(/SPDX-License-Identifier|copyright|\(c\)/i);
    }
  });
});
