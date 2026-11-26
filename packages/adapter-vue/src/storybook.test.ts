// SPDX-License-Identifier: GPL-3.0-or-later
// The Storybook setup without a browser. integration/browser.test.ts builds a Storybook with it.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryContext } from "@storybook/vue3-vite";
import { fazonStorybook } from "./storybook.js";
import { fazonPreview, withTheme } from "./storybook-preview.js";

describe("fazonStorybook", () => {
  it("is the Vue and Vite framework, without docgen or telemetry, with every generated story file", () => {
    const config = fazonStorybook();
    expect(config.framework).toEqual({ name: "@storybook/vue3-vite", options: { docgen: false } });
    expect(config.stories).toEqual([
      { directory: "../src/components", files: "*/generated/*.stories.ts", titlePrefix: "" },
    ]);
    expect(config.core).toEqual({ disableTelemetry: true });
  });

  it("finds the components from the configuration directory", () => {
    const config = fazonStorybook({ components: "lib/ui", configDir: "config/storybook" });
    expect(config.stories).toMatchObject([{ directory: "../../lib/ui" }]);
  });

  it("adds the Lucide license plugin, and nothing for an own icon set", async () => {
    const plugins = async (icons?: "lucide" | { path: string }) => {
      const { viteFinal } = fazonStorybook(icons === undefined ? {} : { icons });
      const config = await viteFinal?.({ plugins: [] }, {} as never);
      return (config?.plugins ?? []).map((plugin) => (plugin as { name: string }).name);
    };
    expect(await plugins()).toEqual(["fazon:lucide-license"]);
    expect(await plugins("lucide")).toEqual(["fazon:lucide-license"]);
    expect(await plugins({ path: "icons" })).toEqual([]);
  });
});

describe("fazonPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes the themes a global, the default first, with a toolbar switch", () => {
    const preview = fazonPreview({ themes: ["light", "dark"] });
    expect(preview.initialGlobals).toEqual({ theme: "light" });
    expect(preview.globalTypes?.theme?.toolbar).toMatchObject({ items: ["light", "dark"] });
    expect(fazonPreview({ themes: ["light", "dark"], defaultTheme: "dark" }).initialGlobals).toEqual({ theme: "dark" });
  });

  it("refuses a default theme that isn't one of the themes", () => {
    expect(() => fazonPreview({ themes: [] })).toThrow("the default theme among them");
    expect(() => fazonPreview({ themes: ["light"], defaultTheme: "dark" })).toThrow("the default theme among them");
  });

  it("sets data-theme on the document's root element from the theme global, before the story renders", () => {
    const root = { setAttribute: vi.fn() };
    vi.stubGlobal("document", { documentElement: root });
    const story = vi.fn(() => ({}));
    const decorate = withTheme("light");
    decorate(story, { globals: { theme: "dark" } } as unknown as StoryContext);
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", "dark");
    decorate(story, { globals: {} } as unknown as StoryContext);
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", "light");
    expect(story).toHaveBeenCalledTimes(2);
  });
});
