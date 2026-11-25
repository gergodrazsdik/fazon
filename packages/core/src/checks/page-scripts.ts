// SPDX-License-Identifier: GPL-3.0-or-later
// Functions the page runner evaluates inside the page. Playwright sends each one's source text to
// the browser, so each is self-contained: it uses no imports and nothing else of this module. Core
// compiles without the DOM library, so the few browser APIs they use are typed here.
import type { Box } from "./types.js";

interface DomRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DomNode {
  readonly nodeType: number;
  readonly textContent: string | null;
}

interface DomElement extends DomNode {
  readonly tagName: string;
  readonly parentElement: DomElement | null;
  readonly children: ArrayLike<DomElement>;
  readonly childNodes: ArrayLike<DomNode>;
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly tabIndex?: number;
  getAttribute(name: string): string | null;
  closest(selector: string): DomElement | null;
  matches(selector: string): boolean;
  contains(other: DomElement): boolean;
  getBoundingClientRect(): DomRect;
}

interface DomStyle {
  getPropertyValue(name: string): string;
}

interface DomAnimation {
  readonly effect: { getComputedTiming(): { readonly endTime?: number | string } } | null;
  finish(): void;
  cancel(): void;
}

interface DomGlobals {
  readonly document: {
    readonly documentElement: DomElement;
    readonly fonts: { readonly ready: Promise<unknown> };
    querySelector(selector: string): DomElement | null;
    querySelectorAll(selector: string): ArrayLike<DomElement>;
    getElementById(id: string): DomElement | null;
    createRange(): { selectNodeContents(node: DomNode): void; getBoundingClientRect(): DomRect };
    getAnimations(): DomAnimation[];
  };
  getComputedStyle(element: DomElement): DomStyle;
  requestAnimationFrame(callback: () => void): number;
  readonly CSS: { escape(text: string): string };
  readonly innerWidth: number;
  readonly innerHeight: number;
}

/** One element as the page reports it, before the protocol adds styles and accessibility. */
export interface PageElement {
  /** A unique selector from the root element, for the DevTools protocol. */
  readonly path: string;
  readonly selector: string;
  readonly tag: string;
  readonly part?: string;
  readonly partRoot: boolean;
  readonly instance?: number;
  readonly parent?: number;
  readonly inFrame: boolean;
  readonly box: Box;
  readonly display: string;
  readonly visibility: string;
  readonly position: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly textOverflow: string;
  readonly lineClamp: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly textBoxes: Box[];
  readonly inlineInText: boolean;
  readonly tabbable: boolean;
  readonly labelledBy: string[];
  readonly describedBy: string[];
  readonly aria: Record<string, string>;
  readonly states: string[];
}

export interface PageLayout {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly frame: { readonly selector: string; readonly box: Box; readonly contentBox: Box };
  readonly elements: PageElement[];
  /** The selectors of the component's roots: the root in the frame, then the portal parts outside it. */
  readonly roots: { readonly selector: string; readonly inFrame: boolean }[];
}

/**
 * Reads the frame and every element of the component: the topmost `[data-part]` element in the
 * frame and its descendants, then each `[data-part]` element outside the frame (a portal part) and
 * its descendants. Elements under `display: none` are left out.
 */
export function inspectLayout(frameSelector: string): PageLayout {
  const win = globalThis as unknown as DomGlobals;
  const doc = win.document;
  const frame = doc.querySelector(frameSelector);
  if (frame === null) throw new Error(`The page has no frame element ${frameSelector}.`);
  const box = (r: DomRect): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const px = (style: DomStyle, name: string) => parseFloat(style.getPropertyValue(name)) || 0;

  const pathOf = (element: DomElement): string => {
    const steps: string[] = [];
    let at: DomElement | null = element;
    while (at !== null && at !== doc.documentElement) {
      const parent: DomElement | null = at.parentElement;
      const index = parent === null ? 1 : Array.prototype.indexOf.call(parent.children, at) + 1;
      steps.unshift(`${at.tagName.toLowerCase()}:nth-child(${String(index)})`);
      at = parent;
    }
    return [":root", ...steps].join(" > ");
  };
  const partSelector = (name: string) => `[data-part="${win.CSS.escape(name)}"]`;
  // Anchored on the nearest ancestor-or-self whose part has one element only.
  const readable = (element: DomElement): string => {
    let anchor = element.closest("[data-part]");
    let name = anchor?.getAttribute("data-part") ?? null;
    while (anchor !== null && name !== null && doc.querySelectorAll(partSelector(name)).length !== 1) {
      anchor = anchor.parentElement?.closest("[data-part]") ?? null;
      name = anchor?.getAttribute("data-part") ?? null;
    }
    if (anchor === null || name === null) return pathOf(element);
    const steps: string[] = [];
    let at: DomElement | null = element;
    while (at !== null && at !== anchor) {
      const parent: DomElement | null = at.parentElement;
      const index = parent === null ? 1 : Array.prototype.indexOf.call(parent.children, at) + 1;
      steps.unshift(`${at.tagName.toLowerCase()}:nth-child(${String(index)})`);
      at = parent;
    }
    return [partSelector(name), ...steps].join(" > ");
  };
  const partsOf = (ids: string | null): string[] =>
    (ids ?? "")
      .split(/\s+/)
      .filter((id) => id !== "")
      .map((id) => doc.getElementById(id)?.closest("[data-part]")?.getAttribute("data-part") ?? "")
      .filter((p) => p !== "");
  const blank = (node: DomNode) => node.nodeType !== 3 || (node.textContent ?? "").trim() === "";

  const allParts = Array.from(doc.querySelectorAll("[data-part]"));
  const topmost = allParts.filter((e) => e.parentElement?.closest("[data-part]") == null);
  const inFrameRoots = topmost.filter((e) => frame.contains(e));
  const portalRoots = topmost.filter((e) => !frame.contains(e));
  const roots = [...inFrameRoots.slice(0, 1), ...portalRoots];

  const elements: PageElement[] = [];
  const visit = (element: DomElement, parent: number | undefined, inFrame: boolean): void => {
    const style = win.getComputedStyle(element);
    if (style.getPropertyValue("display") === "none") return;
    const ownPart = element.getAttribute("data-part");
    const part = element.closest("[data-part]")?.getAttribute("data-part") ?? undefined;
    const textBoxes: Box[] = [];
    for (const node of Array.from(element.childNodes)) {
      if (blank(node)) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      textBoxes.push(box(range.getBoundingClientRect()));
    }
    const display = style.getPropertyValue("display");
    const siblings = element.parentElement === null ? [] : Array.from(element.parentElement.childNodes);
    const aria: Record<string, string> = {};
    const states: string[] = [];
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("aria-")) aria[attribute.name] = attribute.value;
      if (
        attribute.name.startsWith("data-") &&
        attribute.name !== "data-part" &&
        attribute.name !== "data-fazon-frame"
      ) {
        states.push(attribute.name.slice("data-".length));
      }
    }
    for (const pseudo of ["hover", "focus-visible", "active"]) if (element.matches(`:${pseudo}`)) states.push(pseudo);
    const lineClamp = style.getPropertyValue("-webkit-line-clamp") || style.getPropertyValue("line-clamp") || "none";
    const index = elements.length;
    elements.push({
      path: pathOf(element),
      selector: readable(element),
      tag: element.tagName.toLowerCase(),
      ...(part === undefined ? {} : { part }),
      partRoot: ownPart !== null,
      ...(ownPart === null
        ? {}
        : { instance: Array.from(doc.querySelectorAll(partSelector(ownPart))).indexOf(element) }),
      ...(parent === undefined ? {} : { parent }),
      inFrame,
      box: box(element.getBoundingClientRect()),
      display,
      visibility: style.getPropertyValue("visibility"),
      position: style.getPropertyValue("position"),
      overflowX: style.getPropertyValue("overflow-x"),
      overflowY: style.getPropertyValue("overflow-y"),
      textOverflow: style.getPropertyValue("text-overflow"),
      lineClamp,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      textBoxes,
      inlineInText: display === "inline" && siblings.some((s) => !blank(s)),
      tabbable: (element.tabIndex ?? -1) >= 0 && !element.matches(":disabled"),
      labelledBy: partsOf(element.getAttribute("aria-labelledby")),
      describedBy: partsOf(element.getAttribute("aria-describedby")),
      aria,
      states,
    });
    for (const child of Array.from(element.children)) visit(child, index, inFrame);
  };
  for (const root of roots) visit(root, undefined, frame.contains(root));

  const frameStyle = win.getComputedStyle(frame);
  const frameBox = box(frame.getBoundingClientRect());
  const left = px(frameStyle, "padding-left") + px(frameStyle, "border-left-width");
  const top = px(frameStyle, "padding-top") + px(frameStyle, "border-top-width");
  const right = px(frameStyle, "padding-right") + px(frameStyle, "border-right-width");
  const bottom = px(frameStyle, "padding-bottom") + px(frameStyle, "border-bottom-width");
  return {
    viewport: { width: win.innerWidth, height: win.innerHeight },
    frame: {
      selector: frameSelector,
      box: frameBox,
      contentBox: {
        x: frameBox.x + left,
        y: frameBox.y + top,
        width: Math.max(0, frameBox.width - left - right),
        height: Math.max(0, frameBox.height - top - bottom),
      },
    },
    elements,
    roots: roots.map((r) => ({ selector: pathOf(r), inFrame: frame.contains(r) })),
  };
}

interface AxeNodeResult {
  readonly target: readonly unknown[];
  readonly failureSummary?: string;
}

interface AxeResult {
  readonly id: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly impact?: string | null;
  readonly nodes: readonly AxeNodeResult[];
}

/** The page's axe results, as `AxeOutcome` (snapshot.ts) without importing it. */
export interface PageAxeOutcome {
  readonly version: string;
  readonly violations: {
    id: string;
    help: string;
    helpUrl: string;
    impact?: string;
    nodes: { selector: string; part?: string; summary: string }[];
  }[];
  readonly incomplete: PageAxeOutcome["violations"];
}

/**
 * Runs axe-core, injected into the page before, on the component's roots (the root in the frame
 * and the portal parts), and maps each result's elements to their parts.
 */
export async function runAxe(args: { roots: string[]; options: Record<string, unknown> }): Promise<PageAxeOutcome> {
  const win = globalThis as unknown as DomGlobals & {
    axe: {
      version: string;
      run(
        context: unknown,
        options: unknown,
      ): Promise<{ violations: readonly AxeResult[]; incomplete: readonly AxeResult[] }>;
    };
  };
  const results = await win.axe.run({ include: args.roots.map((r) => [r]) }, args.options);
  const map = (list: readonly AxeResult[]) =>
    list.map((result) => ({
      id: result.id,
      help: result.help,
      helpUrl: result.helpUrl,
      ...(result.impact === undefined || result.impact === null ? {} : { impact: result.impact }),
      nodes: result.nodes.map((node) => {
        const selector = node.target.map(String).join(" ");
        const last = node.target[node.target.length - 1];
        const element = typeof last === "string" ? win.document.querySelector(last) : null;
        const part = element?.closest("[data-part]")?.getAttribute("data-part") ?? undefined;
        return { selector, ...(part === undefined ? {} : { part }), summary: node.failureSummary ?? "" };
      }),
    }));
  return { version: win.axe.version, violations: map(results.violations), incomplete: map(results.incomplete) };
}

/** Sets or removes `data-theme` on the root element. */
export function setTheme(theme: string | null): void {
  const root = (globalThis as unknown as DomGlobals).document.documentElement as unknown as {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  if (theme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * Waits until the page is ready to check: fonts loaded, finite animations and transitions
 * finished, infinite ones cancelled, and the boxes of the frame and every `[data-part]` element
 * unchanged over two animation frames. Rejects when the layout doesn't settle within `maxFrames`.
 */
export async function settle(args: { frameSelector: string; maxFrames: number }): Promise<void> {
  const { frameSelector, maxFrames } = args;
  const win = globalThis as unknown as DomGlobals;
  const doc = win.document;
  await doc.fonts.ready;
  const frame = () =>
    new Promise<void>((resolve) =>
      win.requestAnimationFrame(() => {
        resolve();
      }),
    );
  const layout = () =>
    JSON.stringify(
      [doc.querySelector(frameSelector), ...Array.from(doc.querySelectorAll("[data-part]"))].map((e) => {
        const r = e?.getBoundingClientRect();
        return r === undefined ? null : [r.x, r.y, r.width, r.height];
      }),
    );
  let previous = "";
  let stable = 0;
  for (let i = 0; i < maxFrames; i += 1) {
    for (const animation of doc.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === "number" && Number.isFinite(end)) animation.finish();
      else animation.cancel();
    }
    await frame();
    const current = layout();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    if (stable >= 2) return;
  }
  throw new Error(`The layout didn't settle within ${String(maxFrames)} animation frames.`);
}

/** The union of the frame's box and the portal parts' boxes, clipped to the viewport, in CSS pixels. */
export function captureArea(frameSelector: string): Box {
  const win = globalThis as unknown as DomGlobals;
  const doc = win.document;
  const frame = doc.querySelector(frameSelector);
  if (frame === null) throw new Error(`The page has no frame element ${frameSelector}.`);
  const boxes = [frame.getBoundingClientRect()];
  for (const part of Array.from(doc.querySelectorAll("[data-part]"))) {
    const outside = !frame.contains(part) && part.parentElement?.closest("[data-part]") == null;
    const display = win.getComputedStyle(part).getPropertyValue("display");
    if (outside && display !== "none") boxes.push(part.getBoundingClientRect());
  }
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  // A portal part covering the whole viewport, such as an overlay, makes the capture the viewport.
  if (boxes.some((b) => b.x <= 0 && b.y <= 0 && b.x + b.width >= vw && b.y + b.height >= vh)) {
    return { x: 0, y: 0, width: vw, height: vh };
  }
  const x1 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x))));
  const y1 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y))));
  const x2 = Math.min(vw, Math.ceil(Math.max(...boxes.map((b) => b.x + b.width))));
  const y2 = Math.min(vh, Math.ceil(Math.max(...boxes.map((b) => b.y + b.height))));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}
