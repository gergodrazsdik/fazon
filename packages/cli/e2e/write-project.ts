// SPDX-License-Identifier: GPL-3.0-or-later
// Writes the end-to-end test's consumer project (./project.ts) into a directory of the workspace,
// for the reusable workflow's self-test (selftest/setup.sh); `--seed` adds one defect per check.
//
// Usage: node packages/cli/e2e/write-project.ts <directory> <image by digest> [--seed]
import path from "node:path";
import { createProject, seedDefects } from "./project.ts";

const [directory, image, ...rest] = process.argv.slice(2);
const seed = rest.includes("--seed");
if (directory === undefined || image === undefined || !/@sha256:[0-9a-f]{64}$/.test(image)) {
  console.error("Usage: node packages/cli/e2e/write-project.ts <directory> <image by digest> [--seed]");
  process.exit(2);
}
const root = path.resolve(directory);
await createProject({ image, directory: root });
if (seed) {
  const broken = await seedDefects(root);
  console.log(`Seeded defects that break ${broken.join(", ")}.`);
}
console.log(`Wrote the project into ${root}.`);
