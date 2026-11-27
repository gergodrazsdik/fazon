// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { vueAdapter } from "./index.js";

describe("the Vue adapter's source-check commands", () => {
  const commands = vueAdapter.sourceCommands({
    components: ["src/components/button", "src/components/tabs"],
    storybookDir: "/run/storybook",
    packDir: "/run/package",
    reports: { eslint: "/run/eslint.json", stylelint: "/run/stylelint.json", test: "/run/vitest.json" },
  });

  it("are the adapter boundary's: vite build, vue-tsc, storybook build, ESLint, Stylelint, Vitest and a pack", () => {
    expect(commands.compile).toEqual([{ package: "vite", args: ["build"] }]);
    expect(commands.types).toEqual({ package: "vue-tsc", args: ["--noEmit", "--pretty", "false"] });
    expect(commands.storybook).toEqual({
      package: "storybook",
      args: ["build", "--quiet", "--output-dir", "/run/storybook"],
    });
    expect(commands.eslint.args).toEqual([
      "--format",
      "json",
      "--output-file",
      "/run/eslint.json",
      "--no-warn-ignored",
      "src/components/button",
      "src/components/tabs",
    ]);
    expect(commands.stylelint.args.slice(0, 2)).toEqual([
      "src/components/button/**/*.{vue,css}",
      "src/components/tabs/**/*.{vue,css}",
    ]);
    expect(commands.test).toEqual({
      package: "vitest",
      args: ["run", "--reporter=json", "--outputFile=/run/vitest.json", "src/components/button", "src/components/tabs"],
    });
    expect(commands.pack).toEqual({
      program: "npm",
      args: ["pack", "--ignore-scripts", "--json", "--pack-destination", "/run/package"],
    });
    expect(commands.typesResolutions).toEqual(["bundler"]);
  });

  it("name each test's rule: the generated contract tests, and behaviour tests", () => {
    const contract = "src/components/button/generated/button.contract.test.ts";
    expect(vueAdapter.testRule(contract, "Button: contract-api matches the approved API in api.json")).toBe(
      "contract-api",
    );
    expect(vueAdapter.testRule(contract, "Button: contract-render Default renders without an error or warning")).toBe(
      "contract-render",
    );
    expect(vueAdapter.testRule("src/components/button/Button.test.ts", "contract-api lookalike")).toBe("behaviour");
  });
});

describe("the Vue adapter's self-check commands", () => {
  it("are vue-tsc, ESLint, Stylelint and Vitest, scoped to the component", () => {
    expect(vueAdapter.selfChecks("src/components/button")).toEqual({
      commands: [
        "pnpm exec vue-tsc --noEmit",
        "pnpm exec eslint src/components/button",
        'pnpm exec stylelint "src/components/button/**/*.{vue,css}"',
        "pnpm exec vitest run src/components/button",
      ],
      cacheDirectories: [
        "node_modules/.vite",
        "node_modules/.vite-temp",
        "node_modules/.vitest-cache",
        "node_modules/.cache",
        ".vitest",
      ],
    });
  });
});
