// SPDX-License-Identifier: GPL-3.0-or-later
// Renders the smoke test's pages in the verifier image under the rendering conditions of the
// rendered checks (docs/spec/story-matrix.md#rendering) and checks that:
//   - each page renders to the same bytes in two separate browser launches;
//   - a full-viewport capture is 2048 by 1536 pixels (1024 by 768 at a device scale factor of 2);
//   - the visual check's fixtures behave as documented: pass renders the pixels of base, and fail
//     doesn't (docs/spec/check-catalogue.md#visual);
//   - each generic font family, and a button's default font, is rendered with the expected font.
// Usage: node render.mjs <root> <out-dir>; <root> holds verifier/smoke/ and the fixtures.
// Writes each capture and results.json (SHA-256 of each capture, fonts used) to <out-dir>.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [root, outDir] = process.argv.slice(2);
if (!root || !outDir) {
  console.error("usage: node render.mjs <root> <out-dir>");
  process.exit(2);
}

const fixtures = join(root, "docs/spec/examples/checks/visual");
const pages = {
  base: join(fixtures, "base.html"),
  pass: join(fixtures, "pass.html"),
  fail: join(fixtures, "fail.html"),
  fonts: join(root, "verifier/smoke/fonts.html"),
};

// The font each element of fonts.html must be rendered with.
const expectedFonts = {
  "#system-ui": "DejaVu Sans",
  "#sans-serif": "DejaVu Sans",
  "#serif": "DejaVu Serif",
  "#monospace": "DejaVu Sans Mono",
  "#button": "DejaVu Sans",
};

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Width and height from a PNG's IHDR chunk.
function pngSize(png) {
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG file");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// One browser launch: captures every page, and reads the fonts used in fonts.html.
async function renderAll() {
  const browser = await chromium.launch();
  try {
    const captures = {};
    let fonts = {};
    for (const [name, file] of Object.entries(pages)) {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
        colorScheme: "light",
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      captures[name] = await page.screenshot({ animations: "disabled", caret: "hide", scale: "device" });
      if (name === "fonts") {
        fonts = await platformFonts(page, Object.keys(expectedFonts));
      }
      await context.close();
    }
    return { version: browser.version(), captures, fonts };
  } finally {
    await browser.close();
  }
}

// The fonts Chromium used to render each element's text, from the DevTools protocol.
async function platformFonts(page, selectors) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root: documentNode } = await cdp.send("DOM.getDocument");
  const result = {};
  for (const selector of selectors) {
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: documentNode.nodeId, selector });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    result[selector] = fonts.map((font) => font.familyName);
  }
  await cdp.detach();
  return result;
}

const first = await renderAll();
const second = await renderAll();
console.error(`browser: Chromium ${first.version}`);

const results = { browser: first.version, captures: {}, fonts: first.fonts };
for (const [name, png] of Object.entries(first.captures)) {
  const { width, height } = pngSize(png);
  const hash = sha256(png);
  results.captures[name] = { width, height, sha256: hash };
  writeFileSync(join(outDir, `${name}.png`), png);
  console.error(`${name}: ${width}x${height} sha256:${hash}`);
  if (width !== 2048 || height !== 1536) {
    fail(`${name}: the capture is ${width}x${height}, not 2048x1536`);
  }
  if (!png.equals(second.captures[name])) {
    fail(`${name}: two launches rendered different bytes (sha256:${sha256(second.captures[name])} the second time)`);
  }
}

if (!first.captures.pass.equals(first.captures.base)) {
  fail("pass.html didn't render the same bytes as base.html");
}
if (first.captures.fail.equals(first.captures.base)) {
  fail("fail.html rendered the same bytes as base.html");
}

for (const [selector, expected] of Object.entries(expectedFonts)) {
  const used = first.fonts[selector] ?? [];
  console.error(`font ${selector}: ${used.join(", ") || "(none)"}`);
  if (used.length !== 1 || used[0] !== expected) {
    fail(`${selector}: rendered with ${used.join(", ") || "no font"}, expected only ${expected}`);
  }
  if (JSON.stringify(second.fonts[selector]) !== JSON.stringify(used)) {
    fail(`${selector}: the second launch used ${second.fonts[selector]}`);
  }
}

writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.error("render checks passed");
