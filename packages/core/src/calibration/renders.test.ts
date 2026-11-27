// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's renders with a fake renderer: the unmodified stories, then each case on
// the stories it gives CSS for; affected stories by their pixels; the checks with and without
// baselines; the captures and renders.json in the round's directory.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { element, style } from "../checks/test-support.js";
import { buildManifest } from "../matrix/build.js";
import type { Story } from "../matrix/types.js";
import { parseSpecFile } from "../spec/load.js";
import { indexTokens, type TokenIndex } from "../tokens/build.js";
import { resolveTokenSet } from "../tokens/resolve.js";
import type { VerifyComponent } from "../verify/components.js";
import type { RenderedStory, StoryRenderer } from "../verify/rendered.js";
import { calibrationRenders, capturePath, rendersFile, type CalibrationRenders } from "./renders.js";

const docs = new URL("../../../../docs/spec/", import.meta.url);
const file = parseSpecFile("specs/button.md", readFileSync(new URL("examples/specs/valid/button.md", docs), "utf8"));
if (file.spec === undefined) throw new Error("the Button example doesn't pass SPEC-001");
const manifest = buildManifest(file.spec, { file: file.file, themes: ["light", "dark"] });
const button: VerifyComponent = {
  name: "button",
  spec: file.spec,
  specFile: "specs/button.md",
  directory: "src/components/button",
  generated: true,
  manifest,
};
let index: TokenIndex;

beforeAll(async () => {
  const { tokenSet } = await resolveTokenSet(
    fileURLToPath(new URL("example-library/tokens/tokens.resolver.json", docs)),
  );
  if (tokenSet === undefined) throw new Error("the draft token set doesn't resolve");
  index = await indexTokens(tokenSet, { prefix: "fz" });
});

/** A 2x2 PNG whose shade is a hash of the text: different texts give different pixels. */
function png(text: string): Uint8Array {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(createHash("sha256").update(text).digest()[0] ?? 0);
  return new Uint8Array(PNG.sync.write(image));
}

/**
 * Renders a story as a root with a primary button's colours and a padding token. A case's CSS
 * changes the capture, except an outline change, which this fake can't show.
 */
function fake(): StoryRenderer & { calls: number } {
  const renderer = {
    calls: 0,
    render: (_: VerifyComponent, story: Story, theme: string, css?: string): Promise<RenderedStory> => {
      renderer.calls += 1;
      const visible = css !== undefined && !css.includes("outline-style");
      return Promise.resolve({
        inspection: {
          viewport: { width: 1024, height: 768 },
          frame: {
            selector: "[data-fazon-frame]",
            box: { x: 0, y: 0, width: 1, height: 1 },
            contentBox: { x: 0, y: 0, width: 1, height: 1 },
          },
          elements: [
            element({
              styles: {
                matched: [
                  style("author", {
                    "background-color": "var(--fz-color-action-primary)",
                    color: "var(--fz-color-text-on-action)",
                    "padding-top": "var(--fz-space-inset-sm)",
                  }),
                ],
                inherited: [],
              },
            }),
          ],
        },
        axe: { version: "4", violations: [], incomplete: [] },
        capture: {
          png: png(`${story.name} ${theme} ${visible ? css : ""}`),
          clip: { x: 0, y: 0, width: 1, height: 1 },
          deviceScaleFactor: 2,
        },
      });
    },
  };
  return renderer;
}

describe("calibrationRenders", () => {
  let renders: CalibrationRenders;
  let outDir: string;
  let calls: number;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "fazon-calibration-"));
    const renderer = fake();
    renders = await calibrationRenders({
      components: [button],
      renderer,
      index,
      baselinesDir: path.join(outDir, "no-baselines"),
      outDir,
    });
    calls = renderer.calls;
  });

  it("renders every story unmodified, and keeps the captures", async () => {
    const pairs = manifest.stories.length * manifest.themes.length;
    const story = manifest.stories[0]?.name ?? "";
    await expect(readFile(path.join(outDir, capturePath("button", story, "light")))).resolves.toBeDefined();
    expect(calls).toBeGreaterThan(pairs);
  });

  it("keeps the cases that change a capture, with their affected stories, and lists the others", () => {
    const component = renders.components[0];
    const ids = component?.cases.map((entry) => entry.id) ?? [];
    expect(ids).toContain("raw-color");
    expect(ids).toContain("padding-step");
    // The fake shows no outline change, and its stories have no icon.
    expect(component?.unchanged).toContain("focus-ring-removed");
    expect(component?.unchanged).toContain("icon-misaligned");
    const raw = component?.cases.find((entry) => entry.id === "raw-color");
    expect(raw?.affected).toHaveLength(manifest.stories.length);
    expect(raw?.affected[0]?.themes).toEqual(["light", "dark"]);
  });

  it("counts a case caught with baselines when an affected capture differs from its baseline", () => {
    for (const entry of renders.components[0]?.cases ?? []) {
      // No committed baselines here: every affected capture differs from its (missing) baseline.
      expect(entry.checks.withBaselines).toBe(true);
    }
  });

  it("writes the affected captures by case, and renders.json", async () => {
    const story = manifest.stories[0]?.name ?? "";
    await expect(
      readFile(path.join(outDir, capturePath("button", story, "light", "raw-color"))),
    ).resolves.toBeDefined();
    expect(await readdir(path.join(outDir, "cases", "button"))).not.toContain("focus-ring-removed");
    const written = JSON.parse(await readFile(path.join(outDir, rendersFile), "utf8")) as CalibrationRenders;
    expect(written).toEqual(renders);
  });
});
