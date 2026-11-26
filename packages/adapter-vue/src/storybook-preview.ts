// SPDX-License-Identifier: GPL-3.0-or-later
// `@fazon/adapter-vue/storybook/preview`: the browser half of the Storybook setup, for a consumer's
// .storybook/preview.ts. The token set's themes are the `theme` global, which the verifier sets;
// a decorator puts it on the document's root element as `data-theme` (docs/spec/tokens.md#the-build,
// docs/spec/story-matrix.md#rendering). The story files' own decorator renders the frame.
import type { Decorator, Preview } from "@storybook/vue3-vite";

export interface FazonPreviewOptions {
  /** The token set's themes, the default first: the `theme` modifier's contexts. */
  readonly themes: readonly string[];
  /** The default theme, the one without a `data-theme` attribute; the first theme by default. */
  readonly defaultTheme?: string;
}

/** The global the theme is set with: `globals: { theme: "dark" }`, or `?globals=theme:dark` in a story's URL. */
export const themeGlobal = "theme";

/** The document's root element; the package compiles without the DOM's types, so only what's used is typed. */
function root(): { setAttribute(name: string, value: string): void } | undefined {
  return (globalThis as { document?: { documentElement: { setAttribute(name: string, value: string): void } } })
    .document?.documentElement;
}

/** A decorator that sets `data-theme` on the document's root element from the `theme` global. */
export function withTheme(defaultTheme: string): Decorator {
  return (story, context) => {
    const theme: unknown = context.globals[themeGlobal];
    root()?.setAttribute("data-theme", typeof theme === "string" ? theme : defaultTheme);
    return story();
  };
}

/** The preview annotations: the `theme` global, with a toolbar switch, and the decorator that applies it. */
export function fazonPreview(options: FazonPreviewOptions): Preview {
  const [first] = options.themes;
  const defaultTheme = options.defaultTheme ?? first;
  if (defaultTheme === undefined || !options.themes.includes(defaultTheme)) {
    throw new Error("fazonPreview needs the token set's themes, with the default theme among them.");
  }
  return {
    globalTypes: {
      [themeGlobal]: {
        description: "The token set's theme",
        toolbar: { title: "Theme", icon: "paintbrush", items: [...options.themes], dynamicTitle: true },
      },
    },
    initialGlobals: { [themeGlobal]: defaultTheme },
    decorators: [withTheme(defaultTheme)],
  };
}
