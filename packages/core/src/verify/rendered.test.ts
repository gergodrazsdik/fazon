// SPDX-License-Identifier: GPL-3.0-or-later
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { element, fixtureTokenIndex } from "../checks/test-support.js";
import { baselinePath, formatBaselinesRecord } from "../checks/visual.js";
import type { TokenIndex } from "../tokens/build.js";
import type { VerifyComponent } from "./components.js";
import { runRenderedChecks, storybookIndexProblems, type RenderedStory, type StoryRenderer } from "./rendered.js";
import { exampleButton, image, otherImage, png } from "./test-support.js";

let index: TokenIndex;
let button: VerifyComponent;
let root: string;
let baselines: string;
let runDir: string;

beforeAll(async () => {
  index = await fixtureTokenIndex();
  const spec = { ...(await exampleButton()).spec };
  delete (spec as { tokens?: unknown }).tokens;
  // Without its token rules: the recorded elements have no styles to meet them.
  button = await exampleButton({ spec });
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fazon-rendered-"));
  baselines = path.join(root, "baselines");
  runDir = path.join(root, ".fazon/runs/r");
  await mkdir(runDir, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A rendered Button that passes every rendered check: a labelled button with the spec's ARIA attributes. */
function rendered(capture = png(4, 4)): RenderedStory {
  return {
    inspection: {
      viewport: { width: 1024, height: 768 },
      frame: {
        selector: "[data-fazon-frame]",
        box: { x: 0, y: 0, width: 132, height: 72 },
        contentBox: { x: 16, y: 16, width: 100, height: 40 },
      },
      elements: [
        element({
          role: "button",
          name: "Save changes",
          nameSource: "contents",
          aria: { "aria-busy": "true", "aria-disabled": "true" },
          styles: { matched: [], inherited: [] },
        }),
      ],
    },
    axe: { version: "4.14.1", violations: [], incomplete: [] },
    capture: { png: capture, clip: { x: 0, y: 0, width: 2, height: 2 }, deviceScaleFactor: 2 },
  };
}

function renderer(render: (story: string, theme: string) => RenderedStory = () => rendered()): StoryRenderer {
  return { render: (_component, story, theme) => Promise.resolve(render(story.name, theme)) };
}

const run = (overrides: Partial<Parameters<typeof runRenderedChecks>[0]> = {}) =>
  runRenderedChecks({
    components: [button],
    allComponents: [button],
    named: false,
    renderer: renderer(),
    index,
    baselinesDir: baselines,
    image,
    runDir,
    ...overrides,
  });

const statuses = (result: Awaited<ReturnType<typeof run>>) => result.checks.map((c) => [c.check, c.status]);

describe("the rendered checks", () => {
  it("render every story in every theme, pass, and keep each capture under captures/", async () => {
    const seen: string[] = [];
    const result = await run({
      renderer: renderer((story, theme) => {
        seen.push(`${story} ${theme}`);
        return rendered();
      }),
    });
    expect(seen).toHaveLength(27 * 2);
    expect(statuses(result)).toEqual([
      ["a11y", "pass"],
      ["tokens", "pass"],
      ["layout", "pass"],
      ["visual", "pass"],
    ]);
    expect(result.stories.every((s) => s.status === "new")).toBe(true);
    await access(path.join(runDir, "captures/dark/button/label--variant-primary--size-md--hover.png"));
  });

  it("compare with the baselines: unchanged, changed with a diff image, orphans, and renamed pairs", async () => {
    const story = "button--label--variant-primary--size-md--default";
    const changed = "button--label--variant-secondary--size-md--default";
    const write = async (file: string, bytes: Uint8Array | string) => {
      await mkdir(path.dirname(path.join(baselines, file)), { recursive: true });
      await writeFile(path.join(baselines, file), bytes);
    };
    await write("fazon.json", formatBaselinesRecord(image));
    for (const s of button.manifest?.stories ?? []) {
      if (s.name === "button--with-icon--variant-primary--size-md--default") continue;
      for (const theme of ["light", "dark"]) await write(baselinePath(theme, "button", s.name), png(4, 4));
    }
    await write(baselinePath("light", "button", changed), png(4, 4, { x: 1, y: 1, rgb: [0, 0, 0] }));
    // The with-icon story's old name, in light only, with its pixels.
    await write("light/button/icon--variant-primary--size-md--default.png", png(4, 4, { x: 2, y: 2, rgb: [9, 9, 9] }));
    await write("light/button/notes.txt", "not a baseline");

    const result = await run({
      renderer: renderer((name) =>
        rendered(
          name === "button--with-icon--variant-primary--size-md--default"
            ? png(4, 4, { x: 2, y: 2, rgb: [9, 9, 9] })
            : png(4, 4),
        ),
      ),
    });
    const visual = result.checks.find((c) => c.check === "visual");
    expect(visual?.status).toBe("fail");
    expect(visual?.findings.map((f) => [f.rule, f.story ?? f.file, f.theme])).toEqual([
      ["changed", changed, "light"],
      ["orphan", "light/button/icon--variant-primary--size-md--default.png", undefined],
      ["orphan", "light/button/notes.txt", undefined],
    ]);
    const diff = visual?.findings[0]?.evidence ?? "";
    expect(diff).toBe("captures/light/button/label--variant-secondary--size-md--default.diff.png");
    await access(path.join(runDir, diff));
    expect(result.stories.find((s) => s.story === story && s.theme === "light")?.status).toBe("unchanged");
    expect(result.orphans).toEqual([
      {
        path: "light/button/icon--variant-primary--size-md--default.png",
        renamedTo: "light/button/with-icon--variant-primary--size-md--default.png",
      },
      { path: "light/button/notes.txt" },
    ]);
    expect(
      result.stories.find(
        (s) => s.story === "button--with-icon--variant-primary--size-md--default" && s.theme === "light",
      ),
    ).toMatchObject({ status: "new", renamedFrom: "light/button/icon--variant-primary--size-md--default.png" });
    expect(
      result.stories.find(
        (s) => s.story === "button--with-icon--variant-primary--size-md--default" && s.theme === "dark",
      )?.renamedFrom,
    ).toBeUndefined();
  });

  it("report only the named components' orphans when the run names components", async () => {
    await mkdir(path.join(baselines, "light/tabs"), { recursive: true });
    await writeFile(path.join(baselines, "light/tabs/x.png"), png(2, 2));
    await writeFile(path.join(baselines, "fazon.json"), formatBaselinesRecord(image));
    expect((await run({ named: true })).orphans).toEqual([]);
    expect((await run({ named: false })).orphans).toEqual([{ path: "light/tabs/x.png" }]);
  });

  it("compare nothing when the baselines were made with another image (image)", async () => {
    await mkdir(baselines, { recursive: true });
    await writeFile(path.join(baselines, "fazon.json"), formatBaselinesRecord(otherImage));
    const result = await run();
    expect(result.checks.find((c) => c.check === "visual")?.findings.map((f) => f.rule)).toEqual(["image"]);
    expect(result.stories.every((s) => s.status === undefined)).toBe(true);
  });

  it("end in error when a story can't be rendered, with the other stories' findings kept", async () => {
    const result = await run({
      renderer: renderer((story) => {
        if (story.endsWith("--hover")) throw new Error("the browser crashed");
        return rendered();
      }),
    });
    expect(statuses(result).map(([, status]) => status)).toEqual(["error", "error", "error", "error"]);
    expect(result.checks[0]?.message).toMatch(/the browser crashed/);
    // Four hover stories: one per variant, and the forced ghost one.
    expect(result.stories.length).toBe((27 - 4) * 2);
  });

  it("run the checks on each render: an axe violation, and spec-aria across the stories", async () => {
    const result = await run({
      renderer: renderer(() => {
        const base = rendered();
        return {
          ...base,
          inspection: { ...base.inspection, elements: base.inspection.elements.map((e) => ({ ...e, aria: {} })) },
          axe: {
            version: "4.14.1",
            violations: [
              {
                id: "button-name",
                help: "Buttons must have discernible text",
                helpUrl: "",
                nodes: [{ selector: "button", part: "Button", summary: "" }],
              },
            ],
            incomplete: [],
          },
        };
      }),
    });
    const a11y = result.checks.find((c) => c.check === "a11y");
    const rules = new Set(a11y?.findings.map((f) => f.rule));
    expect([...rules].sort()).toEqual(["button-name", "spec-aria"]);
    expect(a11y?.findings.find((f) => f.rule === "spec-aria")?.file).toBe("specs/button.md");
  });
});

describe("MATRIX-003", () => {
  it("holds when the Storybook build has exactly the manifest's stories", () => {
    const ids = button.manifest?.stories.map((s) => s.storybookId) ?? [];
    expect(storybookIndexProblems(button, new Map([["Button", ids]]))).toEqual([]);
    expect(storybookIndexProblems(button, new Map([["Button", [...ids.slice(1), "button--extra"]]]))).toEqual([
      `MATRIX-003 Button: the Storybook build has no story ${ids[0] ?? ""}`,
      "MATRIX-003 Button: the Storybook build has a story button--extra the manifest doesn't list",
    ]);
  });

  it("stops a component's stories from rendering when it doesn't hold", async () => {
    const result = await run({ storybookIndex: new Map([["Button", []]]) });
    expect(result.stories).toEqual([]);
    expect(result.checks.every((c) => c.status === "error")).toBe(true);
  });
});
