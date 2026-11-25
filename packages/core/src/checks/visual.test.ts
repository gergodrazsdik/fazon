// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  baselinePath,
  checkBaselineImage,
  checkOrphans,
  checkVisualStory,
  comparePng,
  decodePng,
  encodePng,
  formatBaselinesRecord,
  imageDigest,
  listBaselineFiles,
  parseBaselinesRecord,
  readBaselinesRecord,
  verifyBaselines,
  writeBaselinesRecord,
} from "./visual.js";

const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
const other = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "0123abcd".repeat(8);

/** A solid image, with one pixel changed when `dot` is given. */
function png(width: number, height: number, dot?: { x: number; y: number; rgb: [number, number, number] }) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i);
  if (dot !== undefined) data.set([...dot.rgb, 255], (dot.y * width + dot.x) * 4);
  return encodePng({ width, height, data });
}

describe("comparing captures", () => {
  it("decodes what it encodes", () => {
    const pixels = decodePng(png(3, 2, { x: 1, y: 1, rgb: [1, 2, 3] }));
    expect([pixels.width, pixels.height, ...pixels.data.slice(16, 20)]).toEqual([3, 2, 1, 2, 3, 255]);
  });

  it("finds identical pixels equal, whatever the PNG encoding", () => {
    expect(comparePng(png(4, 4), png(4, 4))).toMatchObject({ equal: true, differentPixels: 0 });
  });

  it("allows no differing pixel beyond the threshold, and makes a diff image", () => {
    const result = comparePng(png(4, 4), png(4, 4, { x: 2, y: 2, rgb: [0, 0, 0] }));
    expect(result).toMatchObject({ equal: false, differentPixels: 1 });
    expect(decodePng(result.diff ?? new Uint8Array()).width).toBe(4);
  });

  it("ignores a colour distance under 0.1", () => {
    expect(comparePng(png(4, 4), png(4, 4, { x: 0, y: 0, rgb: [254, 254, 254] })).equal).toBe(true);
  });

  it("fails captures of another size", () => {
    expect(comparePng(png(4, 4), png(4, 5))).toEqual({
      equal: false,
      baselineSize: { width: 4, height: 4 },
      captureSize: { width: 4, height: 5 },
    });
  });

  it("reports new, unchanged and changed stories", () => {
    const context = { story: "button--label--default", theme: "light" };
    expect(checkVisualStory({ capture: png(4, 4), context })).toEqual({ status: "new" });
    expect(checkVisualStory({ capture: png(4, 4), baseline: png(4, 4), context }).status).toBe("unchanged");
    const changed = checkVisualStory({
      capture: png(4, 4, { x: 0, y: 0, rgb: [0, 0, 0] }),
      baseline: png(4, 4),
      evidence: "runs/1/light/button/label--default.diff.png",
      context,
    });
    expect(changed.finding).toEqual({
      check: "visual",
      rule: "changed",
      message: "1 pixels differ from the baseline.",
      story: "button--label--default",
      theme: "light",
      expected: "0 differing pixels",
      actual: "1 differing pixels",
      evidence: "runs/1/light/button/label--default.diff.png",
      blocking: true,
    });
    expect(checkVisualStory({ capture: png(4, 5), baseline: png(4, 4) }).finding).toMatchObject({
      expected: "4x4",
      actual: "4x5",
    });
  });
});

describe("the baselines directory", () => {
  it("names a story's baseline by theme and component", () => {
    expect(baselinePath("dark", "button", "button--label--variant-primary--size-md--hover")).toBe(
      "dark/button/label--variant-primary--size-md--hover.png",
    );
    expect(() => baselinePath("dark", "tabs", "button--label--default")).toThrow(/doesn't belong/);
  });

  it("finds orphans: files that are no expected baseline (BASELINE-001)", () => {
    const files = [
      "NOTICE.md",
      "dark/button/label--default.png",
      "fazon.json",
      "light/button/label--default.png",
      "light/button/old-name--default.png",
      "light/button/notes.txt",
    ];
    const expected = ["light/button/label--default.png", "dark/button/label--default.png"];
    expect(checkOrphans(files, expected).map((f) => [f.rule, f.file])).toEqual([
      ["orphan", "light/button/old-name--default.png"],
      ["orphan", "light/button/notes.txt"],
    ]);
  });

  it("reads and checks fazon.json (BASELINE-002)", () => {
    expect(parseBaselinesRecord(undefined)).toEqual({ kind: "missing" });
    expect(parseBaselinesRecord("{")).toMatchObject({ kind: "invalid" });
    expect(parseBaselinesRecord(JSON.stringify({ fazon: 0, image: "fazon-verifier:latest" }))).toMatchObject({
      kind: "invalid",
    });
    expect(parseBaselinesRecord(formatBaselinesRecord(image))).toEqual({ kind: "valid", record: { fazon: 0, image } });
    expect(formatBaselinesRecord(image)).toBe(`{\n  "fazon": 0,\n  "image": "${image}"\n}\n`);
    expect(() => formatBaselinesRecord("fazon-verifier:latest")).toThrow();
  });

  it("compares the running image with the recorded one by digest (image)", () => {
    const valid = parseBaselinesRecord(formatBaselinesRecord(image));
    expect(imageDigest(image)).toBe(`sha256:${"4f1c2a9e".repeat(8)}`);
    expect(checkBaselineImage(valid, image, true)).toEqual([]);
    expect(checkBaselineImage(valid, other, true)).toEqual([
      expect.objectContaining({ rule: "image", expected: image, actual: other, blocking: true }),
    ]);
    expect(checkBaselineImage({ kind: "missing" }, image, false)).toEqual([]);
    expect(checkBaselineImage({ kind: "missing" }, image, true)).toEqual([expect.objectContaining({ rule: "image" })]);
  });
});

describe("verifyBaselines", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("compares each capture, writes diffs outside the directory, and finds orphans", async () => {
    dir = await mkdtemp(join(tmpdir(), "fazon-baselines-"));
    const baselines = join(dir, "baselines");
    await writeBaselinesRecord(baselines, image);
    await mkdir(join(baselines, "light/button"), { recursive: true });
    await writeFile(join(baselines, "light/button/label--default.png"), png(4, 4));
    await writeFile(join(baselines, "light/button/icon--default.png"), png(4, 4));
    await writeFile(join(baselines, "light/button/gone--default.png"), png(4, 4));
    expect(await listBaselineFiles(baselines)).toEqual([
      "fazon.json",
      "light/button/gone--default.png",
      "light/button/icon--default.png",
      "light/button/label--default.png",
    ]);
    const captures = [
      { component: "button", story: "button--label--default", theme: "light", png: png(4, 4) },
      {
        component: "button",
        story: "button--icon--default",
        theme: "light",
        png: png(4, 4, { x: 1, y: 1, rgb: [0, 0, 0] }),
      },
      { component: "button", story: "button--new--default", theme: "light", png: png(4, 4) },
    ];
    const out = join(dir, "run");
    const result = await verifyBaselines({ dir: baselines, runningImage: image, captures, outDir: out });
    expect(result.results.map((r) => [r.path, r.status])).toEqual([
      ["light/button/label--default.png", "unchanged"],
      ["light/button/icon--default.png", "changed"],
      ["light/button/new--default.png", "new"],
    ]);
    expect(result.findings.map((f) => [f.rule, f.story ?? f.file])).toEqual([
      ["changed", "button--icon--default"],
      ["orphan", "light/button/gone--default.png"],
    ]);
    expect(decodePng(await readFile(join(out, "light/button/icon--default.diff.png"))).width).toBe(4);
    expect(await listBaselineFiles(baselines)).toHaveLength(4);
  });

  it("compares nothing when the image differs", async () => {
    dir = await mkdtemp(join(tmpdir(), "fazon-baselines-"));
    await writeBaselinesRecord(dir, other);
    const result = await verifyBaselines({ dir, runningImage: image, captures: [], outDir: join(dir, "out") });
    expect(result).toEqual({ findings: [expect.objectContaining({ rule: "image" })], results: [] });
    expect(await readBaselinesRecord(join(dir, "missing"))).toEqual({ kind: "missing" });
  });
});
