// SPDX-License-Identifier: GPL-3.0-or-later
// `fazon report`'s HTML page of one run (docs/spec/cli.md#fazon-report).
export {
  buildReport,
  defaultStorybookUrl,
  reportDirectory,
  reportFile,
  storybookStoryUrl,
  type ReportInput,
  type ReportOutcome,
} from "./build.js";
export { escapeHtml, html, Html, relativeUrl } from "./html.js";
export { nextSteps, renderReport, type NextStep, type ReportModel } from "./render.js";
export {
  galleryVerification,
  type ReportCall,
  type ReportCapture,
  type ReportIteration,
  type ReportJudge,
  type ReportJudgeFinding,
  type ReportRecord,
  type ReportTokens,
  type ReportVerification,
  type ReportVisualStatus,
} from "./types.js";
