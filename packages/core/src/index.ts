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
  type SourceCommand,
  type SourceCommands,
  type SourceCommandsInput,
  type TestRule,
  type TypesResolution,
  type SetupFile,
  type ThemesInput,
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

export * from "./lint/index.js";

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

export * from "./verify/index.js";

// The headless agent call and the minimum Claude Code version (T-0050 step 2, T-0094).
export type { SelfChecks } from "./adapter.js";
export * from "./agent/index.js";
// Agent runs: the loop, its caps and run ends, and the records it writes (T-0050, step 3). The run
// record's base names (writeRunRecord, RunRecord, …) are exported with verify above.
export {
  linkedRuns,
  roundUsd,
  type AgentRunKind,
  type CallEnd,
  type CallRecord,
  type HandEdit,
  type InputName,
  type IterationOutcome,
  type IterationRecord,
  type JudgeSummary,
  type RunConfig,
  type RunInputs,
  type RunTotals,
  type RunVersions,
  type TokenUsage,
  type Verification,
} from "./records/run-record.js";
export { recordDate, recordTimestamp, writeJsonAtomically } from "./records/json-file.js";
export { approvedApi, canonicalJson, hashApi, hashFile } from "./records/hash.js";
export {
  acceptGeneration,
  apiApproved,
  approveApi,
  provenanceFile,
  provenancePath,
  provenanceProblems,
  readProvenance,
  writeProvenance,
  type Acceptance,
  type Approval,
  type Provenance,
  type ProvenanceGeneration,
  type ProvenanceRead,
  type ProvenanceRun,
} from "./records/provenance.js";
export {
  generateContext,
  isOwnVisualDiff,
  needMarker,
  parseAgentNeed,
  phaseVerdict,
  type PhaseVerdict,
} from "./loop/blocking.js";
export { loopSettings, modelFor, runConfig, type LoopSettings } from "./loop/settings.js";
export { lastFindings, runAgent, type AgentRunOptions, type AgentRunOutcome, type FeedbackInput } from "./loop/run.js";
export {
  noJudge,
  type LoopCall,
  type LoopCallInput,
  type LoopCallResult,
  type AgentNeed,
  type ChecksInput,
  type ChecksOutcome,
  type ChecksPhase,
  type JudgeHook,
  type JudgeInput,
  type LoopDependencies,
} from "./loop/types.js";
