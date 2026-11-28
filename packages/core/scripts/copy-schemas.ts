// SPDX-License-Identifier: GPL-3.0-or-later
// docs/spec/schemas/ is the single source of truth for the JSON Schemas, plugin/skills/generate/
// for the generation skill, and calibration/ for the judge's calibration records. This copies them
// into packages/core/dist/schemas/, dist/skills/generate/ and dist/calibration-records/, where
// @fazon/core reads them at runtime and the package carries them, wherever it's installed. The root build runs it with Node; Vitest runs it as its
// global setup, so the tests always see the current files without a build.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../docs/spec/schemas/", import.meta.url));
const target = fileURLToPath(new URL("../dist/schemas/", import.meta.url));
const skillSource = fileURLToPath(new URL("../../../plugin/skills/generate/SKILL.md", import.meta.url));
const skillTarget = fileURLToPath(new URL("../dist/skills/generate/", import.meta.url));
const calibrationSource = fileURLToPath(new URL("../../../calibration/", import.meta.url));
const calibrationTarget = fileURLToPath(new URL("../dist/calibration-records/", import.meta.url));

export function copySchemas(): void {
  // Start empty, so a schema removed from docs/ doesn't linger in the package.
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(source)) {
    if (file.endsWith(".schema.json")) {
      copyFileSync(source + file, target + file);
    }
  }
  // The generate run's prompt carries the generation skill (docs/spec/agent-permissions.md).
  rmSync(skillTarget, { recursive: true, force: true });
  mkdirSync(skillTarget, { recursive: true });
  copyFileSync(skillSource, `${skillTarget}SKILL.md`);
  // The calibration records a release ships (docs/spec/records.md#calibration-records).
  rmSync(calibrationTarget, { recursive: true, force: true });
  mkdirSync(calibrationTarget, { recursive: true });
  if (existsSync(calibrationSource)) cpSync(calibrationSource, calibrationTarget, { recursive: true });
}

/** Vitest's global setup hook. */
export function setup(): void {
  copySchemas();
}

if (import.meta.main) {
  copySchemas();
}
