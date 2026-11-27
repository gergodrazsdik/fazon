// SPDX-License-Identifier: GPL-3.0-or-later
// A calibration round's renders inside the verifier image: the stories of a passing verify run's
// Storybook build, unmodified and with each case, into the run's `calibration/` directory.
import path from "node:path";
import type { Adapter } from "../adapter.js";
import { launchRenderer, type Renderer } from "../checks/render.js";
import type { Config } from "../config/types.js";
import { loadTokenIndex } from "../lint/tokens.js";
import { loadComponents } from "../verify/components.js";
import { playwrightProblems, defaultBrowsersPath } from "../verify/in-image.js";
import { serveDirectory, storybookRenderer } from "../verify/storybook.js";
import { calibrationRenders, type CalibrationRenders } from "./renders.js";

/** The directory a round's renders go to, in the verify run's directory. */
export const calibrationDirectory = "calibration";

export interface CalibrateInImageOptions {
  readonly repo: string;
  /** The passing verify run whose Storybook build is rendered; the renders go into it. */
  readonly runDir: string;
  readonly config: Config;
  readonly adapter: Adapter;
  /** The round's components, by kebab-case name. */
  readonly names: readonly string[];
  readonly log: (text: string) => void;
  readonly browsersPath?: string;
}

export type CalibrateInImageOutcome =
  | { readonly kind: "done"; readonly renders: CalibrationRenders }
  | { readonly kind: "environment"; readonly problems: readonly string[] };

export async function calibrateInImage(options: CalibrateInImageOptions): Promise<CalibrateInImageOutcome> {
  const { repo, config, adapter } = options;
  const problems = await playwrightProblems(
    repo,
    options.browsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? defaultBrowsersPath,
  );
  if (problems.length > 0) return { kind: "environment", problems };
  const loaded = await loadComponents(repo, config, adapter);
  if (loaded.problems.length > 0) {
    return { kind: "environment", problems: loaded.problems.map((p) => `${p.file}: ${p.message}`) };
  }
  const components = loaded.components.filter((component) => options.names.includes(component.name));
  const index = await loadTokenIndex({ root: repo, tokens: config.paths.tokens, prefix: config.tokens.prefix ?? "" });
  const server = await serveDirectory(path.join(options.runDir, "storybook"));
  let renderer: Renderer | undefined;
  try {
    renderer = await launchRenderer();
    const renders = await calibrationRenders({
      components,
      renderer: storybookRenderer(renderer, server.url),
      index,
      baselinesDir: path.join(repo, config.paths.baselines),
      outDir: path.join(options.runDir, calibrationDirectory),
      progress: options.log,
    });
    return { kind: "done", renders };
  } finally {
    await renderer?.close();
    await server.close();
  }
}
