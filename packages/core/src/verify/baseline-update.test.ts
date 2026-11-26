// SPDX-License-Identifier: GPL-3.0-or-later
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baselinePath, decodePng, formatBaselinesRecord, listBaselineFiles } from "../checks/visual.js";
import { resolveConfig } from "../config/load.js";
import type { Config } from "../config/types.js";
import { updateBaselines } from "./baseline-update.js";
import type { VerifyComponent } from "./components.js";
import { componentInputsHash, writeVerifyDetails, type VerifyDetails } from "./details.js";
import { runDirectory, writeRunRecord } from "./run-record.js";
import { exampleButton, exampleRepository, image, otherImage, png, runningRecord } from "./test-support.js";

let root: string;
let button: VerifyComponent;
let config: Config;

beforeEach(async () => {
  root = await exampleRepository();
  button = await exampleButton();
  config = resolveConfig({ fazon: 0, adapter: "vue", image, judge: { policy: "off" } }).config;
  const lucide = path.join(root, "node_modules/lucide-static");
  await mkdir(lucide, { recursive: true });
  await writeFile(path.join(lucide, "package.json"), '{ "name": "lucide-static", "version": "1.2.3" }\n');
  await writeFile(path.join(lucide, "LICENSE"), "ISC License\n\nCopyright (c) Lucide Contributors\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const allPass = {
  build: "pass",
  lint: "pass",
  test: "pass",
  package: "pass",
  a11y: "pass",
  tokens: "pass",
  layout: "pass",
  visual: "fail",
} as const;

/** A finished verify run of the Button, with a capture of every story; `pixel` changes them all. */
async function verifyRun(
  id: string,
  options: {
    image?: string;
    checks?: VerifyDetails["components"][number]["checks"];
    inputs?: string;
    platform?: string;
    dot?: boolean;
  } = {},
): Promise<void> {
  const dir = runDirectory(root, id);
  await writeRunRecord(dir, {
    ...runningRecord(id, { status: "failed", ended: "2026-11-26T10:05:00Z" }),
    versions: { framework: "0.0.0", image: options.image ?? image },
  });
  const stories = (button.manifest?.stories ?? []).flatMap((story) =>
    ["light", "dark"].map((theme) => ({
      component: "button",
      story: story.name,
      theme,
      path: baselinePath(theme, "button", story.name),
      status: "new" as const,
    })),
  );
  for (const story of stories) {
    await mkdir(path.dirname(path.join(dir, "captures", story.path)), { recursive: true });
    await writeFile(
      path.join(dir, "captures", story.path),
      options.dot === true ? png(4, 4, { x: 0, y: 0, rgb: [0, 0, 0] }) : png(4, 4),
    );
  }
  await writeVerifyDetails(dir, {
    fazon: 0,
    platform: options.platform ?? "linux/amd64",
    components: [
      {
        name: "button",
        inputs: options.inputs ?? (await componentInputsHash(root, button, config.paths.tokens)),
        checks: options.checks ?? allPass,
      },
    ],
    stories,
    orphans: [],
    incomplete: [],
    unusedExemptions: [],
  });
}

const update = (targets: readonly string[] | "all", stories?: string[]) =>
  updateBaselines({ root, config, components: [button], targets, ...(stories === undefined ? {} : { stories }) });

describe("fazon baseline update", () => {
  it("writes every story's baseline from the latest run, fazon.json and NOTICE.md, and nothing the second time", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    const first = await update(["button"]);
    expect(first).toMatchObject({ kind: "done", image, unchanged: [], removed: [] });
    if (first.kind !== "done") return;
    expect(first.written).toHaveLength(54);
    const dir = path.join(root, "baselines");
    expect(await readFile(path.join(dir, "fazon.json"), "utf8")).toBe(formatBaselinesRecord(image));
    const notice = await readFile(path.join(dir, "NOTICE.md"), "utf8");
    expect(notice).toContain("version 1.2.3");
    expect(notice).toContain("Copyright (c) Lucide Contributors");
    expect(decodePng(new Uint8Array(await readFile(path.join(dir, first.written[0] ?? ""))))).toEqual(
      decodePng(png(4, 4)),
    );

    const second = await update(["button"]);
    expect(second).toMatchObject({ kind: "done", written: [], removed: [] });
    expect(second.kind === "done" ? second.unchanged : []).toHaveLength(54);
  });

  it("takes the latest run, writes only the stories --story names, and keeps orphans then", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await update(["button"]);
    await writeFile(path.join(root, "baselines/light/button/old--default.png"), png(2, 2));
    await verifyRun("20261126T110000Z-verify-bbbb", { dot: true });
    const story = "button--label--variant-primary--size-md--hover";
    const result = await update(["button"], [story]);
    expect(result).toMatchObject({
      kind: "done",
      written: [
        "dark/button/label--variant-primary--size-md--hover.png",
        "light/button/label--variant-primary--size-md--hover.png",
      ],
      removed: [],
    });
    expect(await listBaselineFiles(path.join(root, "baselines"))).toContain("light/button/old--default.png");
  });

  it("removes the component's orphans, and with --all every file that isn't a baseline", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await mkdir(path.join(root, "baselines/light/button"), { recursive: true });
    await mkdir(path.join(root, "baselines/light/gone"), { recursive: true });
    await writeFile(path.join(root, "baselines/light/button/old--default.png"), png(2, 2));
    await writeFile(path.join(root, "baselines/light/gone/x--default.png"), png(2, 2));
    expect(await update(["button"])).toMatchObject({ removed: ["light/button/old--default.png"] });
    expect(await update("all")).toMatchObject({ removed: ["light/gone/x--default.png"] });
    await expect(access(path.join(root, "baselines/light/gone"))).rejects.toThrow();
  });

  it("refuses, saying which condition failed, and writes nothing", async () => {
    expect(await update(["button"])).toMatchObject({
      kind: "refused",
      qualifications: [{ failed: [expect.stringContaining("has no finished run") as string] }],
    });

    await verifyRun("20261126T100000Z-verify-aaaa", { checks: { ...allPass, tokens: "fail", test: "error" } });
    const failing = await update(["button"]);
    expect(failing.kind === "refused" ? failing.qualifications[0]?.failed : []).toEqual([
      expect.stringContaining(
        "didn't pass every check other than visual: test ended in error, tokens failed",
      ) as string,
    ]);

    await verifyRun("20261126T110000Z-verify-bbbb", { inputs: "sha256:" + "0".repeat(64) });
    expect(JSON.stringify(await update(["button"]))).toContain("changed since the run");

    await verifyRun("20261126T120000Z-verify-cccc", { image: otherImage, platform: "linux/arm64" });
    const elsewhere = JSON.stringify(await update(["button"]));
    expect(elsewhere).toContain("not in the image fazon.yaml pins");
    expect(elsewhere).toContain("baselines are made on linux/amd64 only");
    expect(await listBaselineFiles(path.join(root, "baselines"))).toEqual([]);
  });

  it("records another image only with --all", async () => {
    await mkdir(path.join(root, "baselines"), { recursive: true });
    await writeFile(path.join(root, "baselines/fazon.json"), formatBaselinesRecord(otherImage));
    await verifyRun("20261126T100000Z-verify-aaaa");
    expect(JSON.stringify(await update(["button"]))).toContain(
      "only `fazon baseline update --all` records another image",
    );
    expect(await update("all")).toMatchObject({ kind: "done" });
    expect(await readFile(path.join(root, "baselines/fazon.json"), "utf8")).toBe(formatBaselinesRecord(image));
  });

  it("writes no NOTICE.md for an icon set of the repository's own, and removes one", async () => {
    await verifyRun("20261126T100000Z-verify-aaaa");
    await update(["button"]);
    config = { ...config, icons: { path: "icons" } };
    await update(["button"]);
    await expect(access(path.join(root, "baselines/NOTICE.md"))).rejects.toThrow();
  });
});
