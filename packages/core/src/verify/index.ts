// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon verify` and `fazon baseline update`: the verify run inside the verifier image, its run
// record and details, and the baselines written from it.
export {
  listRunIds,
  newRunId,
  readRunRecord,
  runDirectory,
  runRecordFile,
  runRecordProblems,
  runsDirectory,
  writeRunRecord,
  type CheckResult,
  type CheckStatus,
  type RunKind,
  type RunReason,
  type RunRecord,
  type RunStatus,
} from "./run-record.js";
export { loadComponents, storyProps, type ComponentProblem, type VerifyComponent } from "./components.js";
export { applyExemptions, findingComponent, type ExemptionsResult, type UnusedExemption } from "./exemptions.js";
export {
  generatedFindings,
  outputTail,
  runSourceChecks,
  testFindings,
  typeFindings,
  type CommandResult,
  type CommandRunner,
  type SourceChecksInput,
  type SourceChecksResult,
  type VitestFileReport,
} from "./source-checks.js";
export {
  exportFindings,
  manifestFindings,
  readPackedPackage,
  stylesFindings,
  typesFindings,
  type EntryImport,
  type PackageComponent,
  type PackedPackage,
  type UnpackedPackage,
} from "./package-check.js";
export {
  capturesDirectory,
  runRenderedChecks,
  skippedRenderedChecks,
  storybookIndexProblems,
  type Orphan,
  type RenderedChecksInput,
  type RenderedChecksResult,
  type RenderedStory,
  type StoryRenderer,
  type StoryVisual,
} from "./rendered.js";
export {
  reflectedStateProblems,
  setByProps,
  type ReflectingElement,
  type RenderedElements,
} from "./reflected-states.js";
export { readStorybookIndex, serveDirectory, storybookRenderer } from "./storybook.js";
export {
  compareWithBase,
  componentCheckStatuses,
  componentInputsHash,
  gitBlobId,
  ociPlatform,
  optimizePng,
  readVerifyDetails,
  verifyDetailsFile,
  writeVerifyDetails,
  type BaseChange,
  type BaseMark,
  type ComponentDetails,
  type VerifyDetails,
} from "./details.js";
export {
  defaultBrowsersPath,
  findPackage,
  finishRecord,
  makeWorkingCopy,
  playwrightProblems,
  processRunner,
  runImageChecks,
  verifyInImage,
  type ImageChecksOptions,
  type ImageChecksOutcome,
  type InImageOptions,
  type InImageOutcome,
} from "./in-image.js";
export {
  capturePlatform,
  lucideNotice,
  updateBaselines,
  type BaselineUpdateInput,
  type BaselineUpdateOutcome,
  type Qualification,
} from "./baseline-update.js";
