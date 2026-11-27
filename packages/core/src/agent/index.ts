// SPDX-License-Identifier: GPL-3.0-or-later
// The headless agent call (docs/spec/agent-permissions.md): its settings, the `claude -p` process,
// the snapshots around it, and the minimum Claude Code version.
export {
  callFiles,
  claudeArguments,
  initProblems,
  runAgentCall,
  type AgentCall,
  type AgentCallEnd,
  type AgentCallOptions,
  type AgentCallResult,
} from "./call.js";
export { StreamJsonReader, tokenCost, type InitEvent, type ResultEvent, type TokenCounts } from "./output.js";
export {
  agentSettings,
  agentTools,
  deniedTools,
  findSecretFiles,
  findWriteDenied,
  readOnlyTools,
  unreadableDirectories,
  unreadableFiles,
  writableDirectories,
  type AgentAccess,
  type AgentSettings,
  type AgentSettingsInput,
} from "./settings.js";
export {
  changedFiles,
  handEdits,
  isAllowedPath,
  takeSnapshot,
  violations,
  type AgentScope,
  type Snapshot,
} from "./snapshot.js";
export {
  ClaudeCodeVersionError,
  claudeCodeCommand,
  claudeCodeProblem,
  claudeCodeStatus,
  compareVersions,
  minimumClaudeCodeVersion,
  parseClaudeCodeVersion,
  readClaudeCodeVersion,
  requireClaudeCode,
  type ClaudeCodeStatus,
} from "./version.js";
