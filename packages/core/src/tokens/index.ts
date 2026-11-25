// SPDX-License-Identifier: GPL-3.0-or-later
// The tokens pipeline (docs/spec/tokens.md): resolve a token set, check the TOKEN rules, build its
// CSS with Style Dictionary, hash it, and index its custom properties for the checks.
export {
  buildTokenCss,
  buildTokens,
  indexTokens,
  tokenCssHeader,
  TokenSetError,
  type BuildTokensOptions,
  type IndexedToken,
  type TokenBuild,
  type TokenIndex,
} from "./build.js";
export { hashText, hashTokenSet } from "./hash.js";
export { customPropertyName, referencedPath, tokenKind } from "./reference.js";
export {
  readTextFile,
  resolveTokenSet,
  tokensOfTheme,
  type ReadTextFile,
  type ResolveTokenSetOptions,
  type ResolveTokenSetResult,
  type TokenSchemaName,
  type ValidateTokenData,
} from "./resolve.js";
export {
  baseStyleRoles,
  checkBaseStyles,
  checkCustomPropertyNames,
  checkPlacement,
  checkRawAndRole,
  checkReferences,
  checkTokenSet,
} from "./rules.js";
export type {
  TokenDefinition,
  TokenFile,
  TokenFileSource,
  TokenFinding,
  TokenRuleId,
  TokenSet,
  TokenType,
} from "./types.js";
