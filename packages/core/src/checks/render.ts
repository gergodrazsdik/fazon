// SPDX-License-Identifier: GPL-3.0-or-later
// The page runner: opens a page in headless Chromium with playwright-core under the rendering
// conditions of the rendered checks (docs/spec/story-matrix.md#rendering), and reads what the
// checks need. It runs in the verifier image, whose browsers match playwright-core's version.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { axeRunOptions } from "./a11y.js";
import { stripImportant } from "./cascade.js";
import { captureArea, inspectLayout, runAxe, setTheme, settle } from "./page-scripts.js";
import type {
  AxeOutcome,
  Capture,
  ElementStyles,
  InspectedElement,
  NameSourceKind,
  PageInspection,
  StyleOrigin,
  StyleSource,
} from "./snapshot.js";
import { CheckError } from "./types.js";

/** The rendering conditions every rendered check uses. */
export const renderDefaults = {
  viewport: { width: 1024, height: 768 },
  deviceScaleFactor: 2,
  frameSelector: "[data-fazon-frame]",
  timeoutMs: 30_000,
  /** Animation frames to wait at most for a stable layout. */
  maxSettleFrames: 120,
} as const;

/** A page to render: a URL, or an HTML file. */
export type PageSource = { readonly url: string } | { readonly file: string };

export interface RenderOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor?: number;
  /** Set as `data-theme` on the root element; none when absent, so the default theme applies. */
  readonly theme?: string;
  readonly frameSelector?: string;
  /** `prefers-reduced-motion: reduce`; true by default. */
  readonly reducedMotion?: boolean;
  readonly timeoutMs?: number;
  /**
   * Waits until the page has rendered what is to be checked, after it has loaded and before the
   * theme is set; for pages that render asynchronously, such as a Storybook story.
   */
  readonly ready?: (page: Page) => Promise<void>;
}

export interface LaunchRendererOptions {
  /** A Chromium executable; by default Playwright's own, which the verifier image carries. */
  readonly executablePath?: string;
}

/** What `RenderedPage.inspect` reads besides the boxes. */
export interface InspectOptions {
  /** The matched styles of every element, for `tokens`. Default true. */
  readonly styles?: boolean;
  /** Roles, names and descriptions from the accessibility tree. Default true. */
  readonly accessibility?: boolean;
}

/** Launches headless Chromium. Close the renderer when done. */
export async function launchRenderer(options: LaunchRendererOptions = {}): Promise<Renderer> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
  });
  return new Renderer(browser);
}

/** A browser that renders pages, each in its own context. */
export class Renderer {
  readonly #browser: Browser;

  constructor(browser: Browser) {
    this.#browser = browser;
  }

  /** The browser's version, such as `159.0.8154.6`. */
  get version(): string {
    return this.#browser.version();
  }

  /**
   * Opens a page under the rendering conditions: the viewport at the device scale factor, reduced
   * motion, the theme on the root element; then waits until it has loaded, its fonts are ready and
   * its layout is stable.
   */
  async open(source: PageSource, options: RenderOptions = {}): Promise<RenderedPage> {
    const viewport = options.viewport ?? renderDefaults.viewport;
    const deviceScaleFactor = options.deviceScaleFactor ?? renderDefaults.deviceScaleFactor;
    const context = await this.#browser.newContext({
      viewport,
      deviceScaleFactor,
      reducedMotion: options.reducedMotion === false ? "no-preference" : "reduce",
      colorScheme: "light",
      locale: "en-US",
      timezoneId: "UTC",
    });
    context.setDefaultTimeout(options.timeoutMs ?? renderDefaults.timeoutMs);
    try {
      const page = await context.newPage();
      const url = "url" in source ? source.url : pathToFileURL(source.file).href;
      await page.goto(url, { waitUntil: "load" });
      await options.ready?.(page);
      await page.evaluate(setTheme, options.theme ?? null);
      const rendered = new RenderedPage(page, context, {
        frameSelector: options.frameSelector ?? renderDefaults.frameSelector,
        deviceScaleFactor,
        ...(options.theme === undefined ? {} : { theme: options.theme }),
      });
      await rendered.settle();
      return rendered;
    } catch (error) {
      await context.close();
      throw new CheckError(`The page ${describe(source)} couldn't be rendered: ${message(error)}`, { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }
}

/** One rendered page. Perform a story's input on `page`, then call `settle` before reading it. */
export class RenderedPage {
  readonly page: Page;
  readonly frameSelector: string;
  readonly deviceScaleFactor: number;
  readonly theme?: string;
  readonly #context: BrowserContext;

  constructor(
    page: Page,
    context: BrowserContext,
    options: { frameSelector: string; deviceScaleFactor: number; theme?: string },
  ) {
    this.page = page;
    this.#context = context;
    this.frameSelector = options.frameSelector;
    this.deviceScaleFactor = options.deviceScaleFactor;
    if (options.theme !== undefined) this.theme = options.theme;
  }

  /** Waits for fonts, finishes animations and waits until the layout is stable. */
  async settle(): Promise<void> {
    await this.page.evaluate(settle, { frameSelector: this.frameSelector, maxFrames: renderDefaults.maxSettleFrames });
  }

  /** The frame and the component's elements, with their styles and accessibility as asked. */
  async inspect(options: InspectOptions = {}): Promise<PageInspection> {
    const layout = await this.page.evaluate(inspectLayout, this.frameSelector);
    const cdp = await this.#context.newCDPSession(this.page);
    try {
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const elements: InspectedElement[] = [];
      for (const element of layout.elements) {
        const { path, ...rest } = element;
        const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: path });
        if (nodeId === 0) throw new CheckError(`The element ${element.selector} disappeared while it was inspected.`);
        const accessibility =
          options.accessibility === false ? undefined : await accessibilityOf(cdp, nodeId, element.tag);
        const styles = options.styles === false ? undefined : await stylesOf(cdp, nodeId);
        elements.push({
          ...rest,
          role: accessibility?.role ?? "",
          name: accessibility?.name ?? "",
          nameSource: accessibility?.nameSource ?? "none",
          description: accessibility?.description ?? "",
          ...(styles === undefined ? {} : { styles }),
        });
      }
      return { viewport: layout.viewport, frame: layout.frame, elements };
    } finally {
      await cdp.detach();
    }
  }

  /** Runs axe-core on the component's roots with the check's rule set. */
  async axe(): Promise<AxeOutcome> {
    await this.page.addScriptTag({ content: await axeSource() });
    const layout = await this.page.evaluate(inspectLayout, this.frameSelector);
    if (layout.roots.length === 0) throw new CheckError("The frame holds no element with data-part.");
    return await this.page.evaluate(runAxe, { roots: layout.roots.map((r) => r.selector), options: axeRunOptions() });
  }

  /** Captures the frame's box joined with the portal parts' boxes, as PNG at the device scale factor. */
  async capture(): Promise<Capture> {
    const clip = await this.page.evaluate(captureArea, this.frameSelector);
    if (clip.width === 0 || clip.height === 0) throw new CheckError("The capture area is empty.");
    const png = await this.page.screenshot({
      clip,
      animations: "disabled",
      caret: "hide",
      scale: "device",
      type: "png",
    });
    return { png: new Uint8Array(png), clip, deviceScaleFactor: this.deviceScaleFactor };
  }

  async close(): Promise<void> {
    await this.#context.close();
  }
}

let axeSourceText: string | undefined;

async function axeSource(): Promise<string> {
  axeSourceText ??= await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  return axeSourceText;
}

// The parts of the DevTools protocol's answers that are read here.
interface CdpProperty {
  readonly name: string;
  readonly value: string;
  readonly important?: boolean;
  readonly implicit?: boolean;
  readonly disabled?: boolean;
  readonly parsedOk?: boolean;
  readonly range?: unknown;
}
interface CdpStyle {
  readonly cssProperties: readonly CdpProperty[];
  readonly shorthandEntries: readonly { readonly name: string; readonly value: string; readonly important?: boolean }[];
}
interface CdpRuleMatch {
  readonly rule: {
    readonly origin: string;
    readonly selectorList: { readonly text: string };
    readonly style: CdpStyle;
    readonly layers?: readonly { readonly text: string }[];
  };
}
interface CdpMatched {
  readonly inlineStyle?: CdpStyle;
  readonly attributesStyle?: CdpStyle;
  readonly matchedCSSRules?: readonly CdpRuleMatch[];
  readonly inherited?: readonly {
    readonly inlineStyle?: CdpStyle;
    readonly matchedCSSRules: readonly CdpRuleMatch[];
  }[];
}

function source(
  style: CdpStyle,
  origin: StyleOrigin,
  extra: { selector?: string; layer?: string },
  customOnly = false,
) {
  return {
    origin,
    ...extra,
    // The entries without a source range are the longhands the browser parsed, after duplicates.
    properties: style.cssProperties
      .filter((p) => p.range === undefined && p.disabled !== true && p.parsedOk !== false)
      .filter((p) => !customOnly || p.name.startsWith("--"))
      .map((p) => ({
        name: p.name,
        value: stripImportant(p.value),
        important: p.important === true,
        implicit: p.implicit === true,
      })),
    shorthands: customOnly
      ? []
      : style.shorthandEntries.map((s) => ({
          name: s.name,
          value: stripImportant(s.value),
          important: s.important === true,
        })),
  } satisfies StyleSource;
}

function sources(
  matched: { inlineStyle?: CdpStyle; attributesStyle?: CdpStyle; matchedCSSRules?: readonly CdpRuleMatch[] },
  customOnly: boolean,
): StyleSource[] {
  const list: StyleSource[] = [];
  if (matched.attributesStyle !== undefined) list.push(source(matched.attributesStyle, "attribute", {}, customOnly));
  for (const { rule } of matched.matchedCSSRules ?? []) {
    const layer = (rule.layers ?? []).map((l) => l.text).join(".");
    list.push(
      source(
        rule.style,
        rule.origin === "user-agent" ? "user-agent" : "author",
        { selector: rule.selectorList.text, ...(layer === "" ? {} : { layer }) },
        customOnly,
      ),
    );
  }
  if (matched.inlineStyle !== undefined) list.push(source(matched.inlineStyle, "inline", {}, customOnly));
  return list.filter((s) => s.properties.length > 0 || s.shorthands.length > 0);
}

async function stylesOf(cdp: CDPSession, nodeId: number): Promise<ElementStyles> {
  const matched: CdpMatched = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
  return {
    matched: sources(matched, false),
    inherited: (matched.inherited ?? []).map((entry) => sources(entry, true)),
  };
}

interface CdpAxValue {
  readonly value?: unknown;
}
interface CdpAxSource {
  readonly type: string;
  readonly attribute?: string;
  readonly value?: CdpAxValue;
  readonly superseded?: boolean;
}
interface CdpAxNode {
  readonly ignored: boolean;
  readonly role?: CdpAxValue;
  readonly name?: CdpAxValue & { readonly sources?: readonly CdpAxSource[] };
  readonly description?: CdpAxValue;
}

async function accessibilityOf(
  cdp: CDPSession,
  nodeId: number,
  tag: string,
): Promise<{ role: string; name: string; nameSource: NameSourceKind; description: string }> {
  const { nodes } = (await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false })) as {
    nodes: readonly CdpAxNode[];
  };
  const node = nodes[0];
  if (node === undefined) throw new CheckError(`The accessibility tree has no node for a ${tag} element.`);
  const text = (v: CdpAxValue | undefined) => (typeof v?.value === "string" ? v.value : "");
  const name = text(node.name);
  const used = node.name?.sources?.find((s) => s.value !== undefined && s.superseded !== true);
  let nameSource: NameSourceKind = "none";
  if (name !== "") {
    if (used?.type === "contents") nameSource = "contents";
    else if (used?.attribute === "aria-labelledby") nameSource = "aria-labelledby";
    else if (used?.attribute === "aria-label") nameSource = "aria-label";
    else if (used?.attribute === "title") nameSource = "title";
    else nameSource = "other";
  }
  return { role: node.ignored ? "" : text(node.role), name, nameSource, description: text(node.description) };
}

function describe(source: PageSource): string {
  return "url" in source ? source.url : source.file;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
