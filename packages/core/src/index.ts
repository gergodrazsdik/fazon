// SPDX-License-Identifier: GPL-3.0-or-later
export type { Adapter } from "./adapter.js";
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

export * from "./tokens/index.js";
