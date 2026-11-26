// SPDX-License-Identifier: GPL-3.0-or-later
// The internal interface between the core and a framework adapter (docs/spec/adapter-boundary.md).
// It grows with the steps that need its capabilities; it may change freely until a second adapter
// exists. The core never imports an adapter (ADAPTER-001): the CLI picks one and passes it in.
import type { IconSet } from "./config/types.js";
import type { StoryManifest } from "./matrix/types.js";
import type { ComponentName, Spec } from "./spec/types.js";
import type { BaseStyle } from "./tokens/base-styles.js";

/** A component's own file, or one of its parts' files, as the adapter names it. */
export interface ComponentFile {
  /** The component's name, or the part's. */
  readonly name: ComponentName;
  /** The part, for a part's file; absent for the component's own. */
  readonly part?: ComponentName;
  /** The framework's name for it, such as `TabsTrigger`. */
  readonly exportName: string;
  /** The file name in the component's directory, such as `TabsTrigger.vue`. */
  readonly file: string;
}

/** The **component files** capability: file names, and what the agent may write in the directory. */
export interface ComponentFiles {
  /** The component's file first, then each part's, in the order the spec declares the parts. */
  readonly files: readonly ComponentFile[];
  /** Glob patterns, relative to the component's directory, of the files the agent may write outside `generated/` (PERM-003). */
  readonly patterns: readonly string[];
}

/** One spec, and everything the adapter needs to write its generated files. */
export interface GenerateInput {
  readonly spec: Spec;
  /** The spec's path, relative to the repository root, with `/` separators. */
  readonly specFile: string;
  /** The specs of the components the spec `uses`, by name; a name without a spec is left out. */
  readonly uses: Readonly<Record<ComponentName, Spec>>;
  /** The component's story manifest; the core writes it as `generated/stories.json`. */
  readonly manifest: StoryManifest;
  /** The component's directory, relative to the repository root: `<paths.components>/<name>`. */
  readonly directory: string;
  /** The fixture icon set (`icons` in fazon.yaml). */
  readonly icons: IconSet;
  /** The story frame's base styles, with the token set's prefix applied (docs/spec/tokens.md#base-styles). */
  readonly baseStyles: readonly BaseStyle[];
}

/** A file the adapter writes in a component's `generated/` directory. */
export interface GeneratedFile {
  /** A file name, without directories: `Button.stories.ts`. */
  readonly name: string;
  readonly content: string;
  /**
   * The file imports the component's own files, as a story file or a contract test does: sync
   * writes it only once the component's root file exists. Data files, such as an API, are always written.
   */
  readonly importsComponent: boolean;
}

/** A component the entry file exports, with its parts. */
export interface EntryComponent {
  readonly spec: Spec;
  /** The component's directory, relative to the repository root. */
  readonly directory: string;
}

/** What the entry exports capability works from. */
export interface EntryInput {
  /** The entry file's path, relative to the repository root (`paths.entry`). */
  readonly file: string;
  /** Its current text; undefined when it doesn't exist yet. */
  readonly text: string | undefined;
  /** Every component with a spec, in name order. */
  readonly components: readonly EntryComponent[];
}

/** What the generated themes module works from: the token set's theme modifier. */
export interface ThemesInput {
  /** The themes, the default first, then the others in the order of the theme modifier's contexts. */
  readonly themes: readonly string[];
  /** The theme modifier's `default`. */
  readonly defaultTheme: string;
}

/** A file the adapter writes outside the components' directories. */
export interface SetupFile {
  /** Relative to the repository root, with `/` separators, such as `.storybook/generated/themes.ts`. */
  readonly path: string;
  readonly content: string;
}

/** A JSON Schema fragment, as plain data. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * The **extension schema** capability: what the adapter's `extensions` block may hold beyond what
 * the core checks. `spec check` applies it with SPEC-013 (M2).
 */
export interface ExtensionSchema {
  /** The schema of `options`; absent when the adapter takes no options. */
  readonly options?: JsonSchema;
  /** The schema of each `map` value. */
  readonly map: JsonSchema;
}

/** What a framework adapter supplies to the core (docs/spec/adapter-boundary.md#core-and-adapter). */
export interface Adapter {
  /** The adapter's ID, as `adapter` in fazon.yaml names it. */
  readonly id: string;
  /** The framework the adapter targets, for messages. */
  readonly framework: string;
  readonly extensionSchema: ExtensionSchema;
  /** **Component files:** the component's and its parts' file names, and the patterns the agent may write. */
  componentFiles(spec: Spec): ComponentFiles;
  /**
   * **Story files** and **contract tests:** every file the adapter writes in the component's
   * `generated/` directory, from the spec, its approved API and its manifest. The same input always
   * gives the same files, byte for byte.
   * @throws AdapterError when the spec can't be written in the framework
   */
  generate(input: GenerateInput): Promise<readonly GeneratedFile[]>;
  /**
   * **Entry exports:** the entry file's text with its generated exports brought up to date,
   * keeping everything a person wrote outside them.
   * @throws AdapterError when the entry file's generated block can't be found unambiguously
   */
  entryFile(input: EntryInput): Promise<string>;
  /**
   * **Storybook setup:** the generated module the Storybook preview imports the token set's themes
   * and default theme from, so a theme added to the token set reaches the theme switch. The same
   * input always gives the same file, byte for byte.
   */
  themesFile(input: ThemesInput): Promise<SetupFile>;
}

/** The adapter can't write a file from its input: a person has to change the spec or a file. */
export class AdapterError extends Error {
  /** The file the problem is in, relative to the repository root, when there is one. */
  readonly file: string | undefined;
  /** How to fix it. */
  readonly hint: string | undefined;

  constructor(message: string, options: { file?: string; hint?: string } = {}) {
    super(message);
    this.name = "AdapterError";
    this.file = options.file;
    this.hint = options.hint;
  }
}
