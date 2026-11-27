// SPDX-License-Identifier: GPL-3.0-or-later
// Rendering stories from the static Storybook build (docs/spec/story-matrix.md#rendering): the
// build served on the loopback interface, each story opened by its ID with the theme as the
// `theme` global, its input steps performed, then captured and inspected.
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import type { Page } from "playwright-core";
import type { Renderer } from "../checks/render.js";
import { CheckError } from "../checks/types.js";
import type { Story } from "../matrix/types.js";
import type { InputStep } from "../spec/types.js";
import type { VerifyComponent } from "./components.js";
import type { RenderedStory, StoryRenderer } from "./rendered.js";

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** A static file server for a directory, on 127.0.0.1 at a free port. Close it when done. */
export async function serveDirectory(directory: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(directory);
  const server: Server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      let file = path.resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
        const body = await readFile(file);
        response.writeHead(200, { "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream" });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The Storybook server has no port.");
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The story IDs of a static Storybook build's `index.json`, by title. */
export async function readStorybookIndex(directory: string): Promise<Map<string, string[]>> {
  const index = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")) as {
    entries?: Record<string, { id: string; title: string; type?: string }>;
  };
  const byTitle = new Map<string, string[]>();
  for (const entry of Object.values(index.entries ?? {})) {
    if (entry.type !== undefined && entry.type !== "story") continue;
    byTitle.set(entry.title, [...(byTitle.get(entry.title) ?? []), entry.id]);
  }
  return byTitle;
}

/** Waits until Storybook has rendered the story's frame, or shows its error. */
async function storyReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const doc = (
        globalThis as unknown as {
          document: { querySelector(s: string): unknown; body: { classList: { contains(c: string): boolean } } };
        }
      ).document;
      return doc.querySelector("[data-fazon-frame]") !== null || doc.body.classList.contains("sb-show-errordisplay");
    },
    undefined,
    { timeout: 30_000 },
  );
  const error = await page.evaluate(() => {
    const doc = (
      globalThis as unknown as {
        document: {
          body: { classList: { contains(c: string): boolean } };
          querySelector(s: string): { textContent: string | null } | null;
        };
      }
    ).document;
    if (!doc.body.classList.contains("sb-show-errordisplay")) return undefined;
    return doc.querySelector("#error-message")?.textContent ?? "an error";
  });
  if (error !== undefined) throw new CheckError(`Storybook couldn't render the story: ${error.trim()}`);
}

/** The element a manifest target names in the rendered story (MATRIX-004 when there's none). */
async function target(page: Page, component: VerifyComponent, spec: string) {
  const match = /^([A-Z][A-Za-z0-9]*)(?:\[(\d+|\*|default)\])?$/.exec(spec);
  const part = spec === "root" ? component.spec.name : match?.[1];
  if (part === undefined) throw new CheckError(`MATRIX-004: the target ${spec} isn't a part or an instance.`);
  const which = spec === "root" ? "0" : (match?.[2] ?? "0");
  const all = page.locator(`[data-part="${part}"]`);
  let index = which === "*" ? 0 : Number(which);
  if (which === "default") {
    const reflected = (component.spec.parts?.[part]?.states ?? []).map((state) => `data-${state}`);
    index = await all.evaluateAll(
      (elements, attributes) =>
        elements.findIndex(
          (element) =>
            !attributes.some((attribute) =>
              (element as unknown as { hasAttribute(name: string): boolean }).hasAttribute(attribute),
            ),
        ),
      reflected,
    );
  }
  const element = all.nth(index);
  if (index < 0 || (await element.count()) === 0) {
    throw new CheckError(`MATRIX-004: the target ${spec} resolves to no element with data-part="${part}".`);
  }
  return element;
}

/** Performs one input step (docs/spec/story-matrix.md#input-actions). */
async function perform(page: Page, component: VerifyComponent, step: InputStep): Promise<void> {
  if (step.action === "press") {
    await page.keyboard.press(step.key);
    return;
  }
  const element = await target(page, component, step.target);
  if (step.action === "scroll") {
    await element.evaluate((node, to) => {
      const el = node as unknown as { scrollTo(x: number, y: number): void; scrollWidth: number; scrollHeight: number };
      if (to === "start") el.scrollTo(0, 0);
      else el.scrollTo(el.scrollWidth, el.scrollHeight);
    }, step.to);
    return;
  }
  if (step.action === "focus") {
    await page.keyboard.press("Tab");
    await element.focus();
    return;
  }
  const box = await element.boundingBox();
  if (box === null) throw new CheckError(`The target ${step.target} has no box to move the pointer to.`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  if (step.action === "pointer-down") await page.mouse.down();
  if (step.action === "click") {
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(0, 0);
  }
}

/** Renders stories from a served static Storybook build. */
export function storybookRenderer(renderer: Renderer, url: string): StoryRenderer {
  return {
    async render(component: VerifyComponent, story: Story, theme: string, css?: string): Promise<RenderedStory> {
      const query = new URLSearchParams({ id: story.storybookId, viewMode: "story", globals: `theme:${theme}` });
      const page = await renderer.open({ url: `${url}/iframe.html?${query.toString()}` }, { theme, ready: storyReady });
      try {
        for (const step of story.input ?? []) await perform(page.page, component, step);
        await page.settle();
        if (css !== undefined) await page.inject(css);
        const capture = await page.capture();
        const inspection = await page.inspect();
        const axe = await page.axe();
        return { inspection, axe, capture };
      } catch (error) {
        if (error instanceof CheckError) throw error;
        throw new CheckError(error instanceof Error ? error.message : String(error), { cause: error });
      } finally {
        await page.close();
      }
    },
  };
}
