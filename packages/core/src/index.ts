// SPDX-License-Identifier: GPL-3.0-or-later
export {
  AdapterError,
  type Adapter,
  type ComponentFile,
  type ComponentFiles,
  type EntryComponent,
  type EntryInput,
  type ExtensionSchema,
  type GeneratedFile,
  type GenerateInput,
  type JsonSchema,
} from "./adapter.js";
export { formatVersions } from "./versions.js";

export type { Finding } from "./findings.js";
export { schemaNames, readSchema, type SchemaName } from "./validation/schemas.js";
export {
  jsonPath,
  validateFile,
  validateWithSchema,
  type FileSchemaFinding,
  type PathSegment,
  type SchemaFinding,
} from "./validation/validate.js";
export { parseYaml, type YamlSource } from "./yaml.js";

export type * from "./spec/types.js";
export { parseSpecFile, readSpecFiles, type SpecFile } from "./spec/load.js";
export { checkSpec, checkedSpecRules, specRules, type SpecRule, type ValidSpecFile } from "./spec/rules.js";
export { isKebabCase, kebabCase } from "./spec/names.js";

export type * from "./config/types.js";
export {
  configDefaults,
  configFileName,
  loadConfig,
  localConfigFileName,
  resolveConfig,
  type ConfigLoad,
  type LoadConfigOptions,
  type ResolvedConfig,
} from "./config/load.js";

export type * from "./matrix/types.js";
export {
  buildManifest,
  emptyFixtureName,
  pseudoStates,
  storyViewport,
  type BuildManifestOptions,
} from "./matrix/build.js";
export { MatrixError } from "./matrix/error.js";
export { resolveFixture } from "./matrix/fixtures.js";
export {
  storybookId,
  storybookSanitize,
  storybookStoryNameFromExport,
  storybookToId,
  storyExportName,
  storyName,
} from "./matrix/names.js";
export {
  checkManifest,
  manifestRules,
  matrixRuleStages,
  type ManifestCheckInput,
  type MatrixRule,
  type MatrixRuleId,
  type MatrixRuleStage,
} from "./matrix/rules.js";

export * from "./tokens/index.js";

export {
  generatedDirectory,
  manifestFileName,
  provenanceFileName,
  syncRepository,
  type FileChange,
  type FileChangeKind,
  type PendingComponent,
  type SyncOptions,
  type SyncProblem,
  type SyncResult,
} from "./sync/sync.js";

export * from "./checks/index.js";
