// SpecTaskChain 导出：供宿主 AI 以 SDK 方式接入（prompt 接力协议）
export { resolveConfig, ensureStructure, readState, writeState, TaskQConfig, TaskRunState } from './core/config';
export { scanQueue, buildExecutionSequence, findNextPending, QueueScan, ModuleInfo, ExecutableTask } from './core/queue';
export { TaskSpec, AcceptanceSpec, ArtifactRule, validateRequired, parseFrontmatter, renderSpec } from './core/task-spec';
export { resolveTaskType, TaskTypeDefinition, listBuiltinTypes } from './core/task-type';
export { detectTaskIssues, detectDanglingDeps, detectOutputConflicts, detectModuleIssues, renderClarifyReport, ClarifyIssue } from './core/clarify';
export { extractReferences, resolveReferences, Reference, ResolvedReference } from './core/references';
export { runAcceptance, renderAcceptanceResult, AcceptanceResult } from './core/acceptance';
export { relayNext, buildTaskPrompt, markTaskState, queueSummary, MAX_ATTEMPTS } from './core/runner';
export { generateQueueReport } from './core/report';
export { generatePanelHtml } from './core/panel';
export { recognizeIntent, IntentResult } from './core/intent';
export { splitCommand, SplitOptions } from './commands/split';
export const VERSION = '0.1.0';
