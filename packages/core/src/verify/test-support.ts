// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for the verify run's tests: images, the example Button as a component of a temporary
// repository, and a run record. Not exported from the package.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../checks/visual.js";
import { buildManifest } from "../matrix/build.js";
import { parseSpecFile } from "../spec/load.js";
import type { VerifyComponent } from "./components.js";
import type { RunRecord } from "./run-record.js";

export const docs = fileURLToPath(new URL("../../../../docs/spec/", import.meta.url));
export const image = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "4f1c2a9e".repeat(8);
export const otherImage = "ghcr.io/gergodrazsdik/fazon-verifier@sha256:" + "0123abcd".repeat(8);

/** A solid white image, with one pixel changed when `dot` is given. */
export function png(width: number, height: number, dot?: { x: number; y: number; rgb: [number, number, number] }) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i);
  if (dot !== undefined) data.set([...dot.rgb, 255], (dot.y * width + dot.x) * 4);
  return encodePng({ width, height, data });
}

/** An example spec (`button`, `dialog` or `tabs`), as a component in `src/components/<name>`, with its manifest. */
export async function exampleComponent(
  name: "button" | "dialog" | "tabs",
  overrides: Partial<VerifyComponent> = {},
): Promise<VerifyComponent> {
  const specFile = `specs/${name}.md`;
  const file = parseSpecFile(specFile, await readFile(path.join(docs, `examples/specs/valid/${name}.md`), "utf8"));
  if (file.spec === undefined) throw new Error(`the example ${name} doesn't parse`);
  return {
    name,
    spec: file.spec,
    specFile,
    directory: `src/components/${name}`,
    generated: true,
    manifest: buildManifest(file.spec, { file: specFile, themes: ["light", "dark"] }),
    ...overrides,
  };
}

/** The example Button spec, as a component in `src/components/button`, with its manifest. */
export async function exampleButton(overrides: Partial<VerifyComponent> = {}): Promise<VerifyComponent> {
  return exampleComponent("button", overrides);
}

/** A temporary repository with the example Button's spec, a component file and the example token set. */
export async function exampleRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fazon-verify-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
  await cp(path.join(docs, "examples/specs/valid/button.md"), path.join(root, "specs/button.md"));
  await cp(path.join(docs, "example-library/tokens"), path.join(root, "tokens"), { recursive: true });
  await mkdir(path.join(root, "src/components/button"), { recursive: true });
  await writeFile(path.join(root, "src/components/button/Button.vue"), "<template><button /></template>\n");
  return root;
}

/** A verify run's record as the host writes it at the start. */
export function runningRecord(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    fazon: 0,
    id,
    kind: "verify",
    status: "running",
    started: "2026-11-26T10:00:00Z",
    versions: { framework: "0.0.0", adapter: "0.0.0", image },
    config: {
      caps: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20 },
      models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
      escalateAfter: 2,
      judgePolicy: "off",
      judgeCalibrated: false,
    },
    iterations: [],
    handEdits: [],
    totals: { iterations: 0, agentCostUsd: 0, judgeCostUsd: 0, costUsd: 0, escalated: false },
    ...overrides,
  };
}
