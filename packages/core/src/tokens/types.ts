// SPDX-License-Identifier: GPL-3.0-or-later

/** The token set's rules (docs/spec/tokens.md#rules). */
export type TokenRule = "TOKEN-001" | "TOKEN-002" | "TOKEN-003" | "TOKEN-004" | "TOKEN-005" | "TOKEN-006";

/** A broken TOKEN rule. */
export interface TokenFinding {
  readonly rule: TokenRule;
  /** The token's dotted path, or `""` when the finding is about a file as a whole. */
  readonly path: string;
  readonly message: string;
  /** The file the finding is in, as it was read (the resolver's directory joined with the `$ref`). */
  readonly file?: string;
}

/** The `$type`s of the format subset (docs/spec/tokens.md#the-format). */
export type TokenType =
  "color" | "dimension" | "duration" | "cubicBezier" | "fontFamily" | "fontWeight" | "number" | "shadow";

/** A token as one file defines it. */
export interface TokenDefinition {
  /** The dotted path, such as `color.text.primary`. */
  readonly path: string;
  /** The `$type`; a string the schema doesn't know when the file isn't valid. */
  readonly type: string;
  readonly value: unknown;
  /** The file it is defined in, as read. */
  readonly file: string;
}

/** Where a token file sits in the resolver document. */
export type TokenFileSource =
  { readonly kind: "set"; readonly set: string } | { readonly kind: "theme"; readonly theme: string };

/** One token file of a resolved token set. */
export interface TokenFile {
  /** The path relative to the resolver document, as its `$ref` gives it. */
  readonly ref: string;
  /** The path it was read from: the resolver's directory joined with `ref`. */
  readonly file: string;
  /** The file's text, as read. */
  readonly text: string;
  readonly source: TokenFileSource;
  /** Its tokens, in document order. */
  readonly tokens: readonly TokenDefinition[];
}

/** A resolver document and its token files, read and resolved (docs/spec/tokens.md#files). */
export interface TokenSet {
  /** The resolver document's path, as given. */
  readonly resolverFile: string;
  /** The resolver document's text, as read. */
  readonly resolverText: string;
  /**
   * The token files in resolution order: each set's sources in `resolutionOrder`, then each theme
   * context's sources, the contexts in document order. A file named twice appears at each place.
   */
  readonly files: readonly TokenFile[];
  /** The theme modifier's contexts, in document order. */
  readonly themes: readonly string[];
  /** The theme modifier's `default`. */
  readonly defaultTheme: string;
}
