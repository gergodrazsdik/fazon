// SPDX-License-Identifier: GPL-3.0-or-later
// The components a verify run covers: each spec, its directory, and its committed story manifest.
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { Adapter } from "../adapter.js";
import type { Config } from "../config/types.js";
import type { StoryManifest } from "../matrix/types.js";
import { readSpecFiles } from "../spec/load.js";
import { checkSpec } from "../spec/rules.js";
import type { PropValues, Spec } from "../spec/types.js";
import { generatedDirectory, manifestFileName } from "../sync/sync.js";
import { validateWithSchema } from "../validation/validate.js";

/** One component of the repository, as a verify run sees it. */
export interface VerifyComponent {
  /** The kebab-case name: `button`, as in `specs/button.md`. */
  readonly name: string;
  readonly spec: Spec;
  /** The spec's path, relative to the repository root. */
  readonly specFile: string;
  /** The component's directory, relative to the repository root: `<paths.components>/<name>`. */
  readonly directory: string;
  /** Its root file exists, such as `Button.vue`: `fazon sync` has written its stories and tests. */
  readonly generated: boolean;
  /** The committed story manifest; undefined when it's missing or invalid (`build` rule `generated` says so). */
  readonly manifest?: StoryManifest;
}

/** What stops a verify run before it starts: a spec that doesn't pass `spec check`. */
export interface ComponentProblem {
  readonly file: string;
  readonly message: string;
}

/** Every component with a spec, in name order, or the problems that stop the run. */
export async function loadComponents(
  root: string,
  config: Config,
  adapter: Adapter,
): Promise<{ components: VerifyComponent[]; problems: ComponentProblem[] }> {
  let files;
  try {
    files = await readSpecFiles(root, config.paths.specs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      components: [],
      problems: [{ file: "fazon.yaml", message: `the specs directory '${config.paths.specs}' doesn't exist` }],
    };
  }
  const components: VerifyComponent[] = [];
  const problems: ComponentProblem[] = [];
  for (const file of files) {
    const findings = checkSpec(file, files);
    if (findings.length > 0 || file.spec === undefined) {
      problems.push(
        ...findings.map((finding) => ({ file: finding.file, message: `${finding.rule} ${finding.message}` })),
      );
      continue;
    }
    const directory = path.posix.join(config.paths.components.split(path.sep).join("/"), file.component);
    const rootFile = adapter.componentFiles(file.spec).files[0]?.file;
    const generated = rootFile !== undefined && (await exists(path.join(root, directory, rootFile)));
    const manifest = await readManifest(path.join(root, directory, generatedDirectory, manifestFileName));
    components.push({
      name: file.component,
      spec: file.spec,
      specFile: file.file,
      directory,
      generated,
      ...(manifest === undefined ? {} : { manifest }),
    });
  }
  components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { components, problems };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(file: string): Promise<StoryManifest | undefined> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  return validateWithSchema("story-manifest", data).length === 0 ? (data as StoryManifest) : undefined;
}

/**
 * The prop values of each element in a story (docs/spec/story-matrix.md#producing-states): the
 * defaults, then the fixture's values, then the story's `set` entries, for the component's root
 * (`part` = the component's name) and for each instance of a part.
 */
export function storyProps(
  spec: Spec,
  manifest: StoryManifest,
  story: StoryManifest["stories"][number],
): (part: string, instance: number) => PropValues {
  const fixture = manifest.fixtures[story.fixture] ?? {};
  const defaults = (props: Spec["props"]): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(props ?? {})
        .filter(([, prop]) => prop.default !== undefined)
        .map(([name, prop]) => [name, prop.default]),
    );
  return (part, instance) => {
    const isRoot = part === spec.name;
    const values: Record<string, unknown> = isRoot
      ? { ...defaults(spec.props), ...fixture.props }
      : { ...defaults(spec.parts?.[part]?.props), ...fixture.parts?.[part]?.[instance]?.props };
    for (const entry of story.set ?? []) {
      if (targetsElement(entry.target, spec.name, part, instance)) Object.assign(values, entry.props);
    }
    return values as PropValues;
  };
}

/** Whether a manifest target names this element. `<Part>[default]` counts as the first instance here. */
function targetsElement(target: string, component: string, part: string, instance: number): boolean {
  if (target === "root") return part === component;
  const match = /^([A-Z][A-Za-z0-9]*)\[(\d+|\*|default)\]$/.exec(target);
  if (match?.[1] !== part) return false;
  const which = match[2] ?? "";
  if (which === "*") return true;
  if (which === "default") return instance === 0;
  return Number(which) === instance;
}
