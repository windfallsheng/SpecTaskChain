// 接力执行引擎：无人值守的核心——做完一个接下一个，断点续跑，直到队列清空
// prompt 接力协议：CLI 输出 [TASKQ_PROMPT] 块 + 退出码 10，宿主 AI 执行后调 taskq done
import { TaskQConfig, readState, writeState } from './config';
import { scanQueue, buildExecutionSequence, findNextPending, ExecutableTask } from './queue';
import { resolveTaskType } from './task-type';
import { TaskSpec } from './task-spec';

/** 每任务尝试上限（失败重试，超过标记 failed 不再接力） */
export const MAX_ATTEMPTS = 3;

export interface NextTaskInfo {
  task: ExecutableTask;
  prompt: string;      // 交给宿主 AI 的完整 prompt
  exitCode: number;    // 10 = 有下一任务（宿主 AI 接力），0 = 队列已空
  summary: string;     // 状态摘要
}

/** 构建任务执行 prompt：规格全文 + 模块公共约束（每次重读）+ 类型默认约束 + 验收标准 + 输出协议 */
export function buildTaskPrompt(exec: ExecutableTask, metaDir: string): string {
  const spec = exec.spec;
  const typeDef = resolveTaskType(metaDir, spec.type);
  const lines: string[] = [];
  lines.push('你正在执行 SpecTaskChain 队列中的一个任务（接力推进：干完这个，下个接着来）。');
  lines.push('');
  lines.push('## 任务规格（SPEC.md 全文，用户自由表达，请完整理解）');
  lines.push('');
  lines.push(`### 目标\n${spec.goal}`);
  lines.push('');
  lines.push(`### 任务类型\n${spec.type}（${typeDef.code ? '代码任务，可写代码' : '非代码任务，与代码世界绝缘'})`);
  lines.push('');
  lines.push(`### 产出位置\n${spec.output}`);
  lines.push('');
  if (spec.body.trim()) {
    lines.push(`### 规格正文\n${spec.body.trim()}`);
    lines.push('');
  }
  if (exec.module && exec.module.constraints.trim()) {
    lines.push('## 模块公共约束（共享 spec，每次执行前重新读取，必须遵守）');
    lines.push('');
    lines.push(exec.module.constraints.trim());
    lines.push('');
  }
  if (typeDef.defaultConstraints.length) {
    lines.push('## 类型默认约束');
    lines.push('');
    typeDef.defaultConstraints.forEach((c) => lines.push(`- ${c}`));
    lines.push('');
  }
  lines.push('## 验收标准（怎么算做完）');
  lines.push('');
  if (spec.acceptance.artifacts.length) {
    lines.push('产物门禁（机器自动检查，缺了不算完）：');
    spec.acceptance.artifacts.forEach((a) => lines.push(`- ${a.path}${a.min ? `（至少 ${a.min} 个）` : ''}`));
  }
  if (spec.acceptance.checks.length) {
    lines.push('断言门禁（机器自动执行，退出码非 0 不算完）：');
    spec.acceptance.checks.forEach((c) => lines.push(`- ${c}`));
  }
  if (spec.acceptance.review.trim()) {
    lines.push(`评审门禁（完成后自我审查）：${spec.acceptance.review}`);
  }
  lines.push('');
  lines.push('## 输出协议');
  lines.push('');
  lines.push('完成产出后，运行以下命令登记验收（机器会跑产物与断言门禁）：');
  lines.push(`\`taskq done ${spec.id} --verdict "pass|fail + 评审结论"\``);
  return lines.join('\n');
}

/**
 * 接力推进：找第一个未完成任务，输出其 prompt
 * - 队列空 → exitCode 0
 * - 有下一任务 → 输出 [TASKQ_PROMPT] 块，exitCode 10（宿主 AI 接力）
 * - draft 任务 → 提示先 clarify（可 --skip-draft 强跑）
 */
export function relayNext(cfg: TaskQConfig, opts: { skipDraft?: boolean } = {}): NextTaskInfo {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const sequence = buildExecutionSequence(queue);
  const state = readState(cfg);
  const next = findNextPending(sequence, state);
  if (!next) {
    return { task: null as any, prompt: '', exitCode: 0, summary: `✅ 队列已清空：${sequence.length} 个任务全部完成` };
  }
  const st = state[next.spec.id] || { status: 'todo', attempts: 0 };
  if (next.spec.draft && !opts.skipDraft) {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⏸ 任务「${next.spec.id}」规格标记为 draft（未澄清），建议先 \`taskq clarify --task ${next.spec.id}\` 补全；或 \`taskq run --skip-draft\` 强跑`,
    };
  }
  const prompt = buildTaskPrompt(next, cfg.metaDir);
  return {
    task: next,
    prompt,
    exitCode: 10,
    summary: `▶ 接力推进：下个任务「${next.spec.id}」（第 ${st.attempts + 1} 次尝试）`,
  };
}

/** 登记任务状态（done 命令写入；attempts 达上限标记 failed 停止接力） */
export function markTaskState(cfg: TaskQConfig, taskId: string, status: 'doing' | 'done' | 'failed', verdict?: string): void {
  const state = readState(cfg);
  const prev = state[taskId] || { status: 'todo', attempts: 0 };
  state[taskId] = {
    status,
    attempts: prev.attempts + (status === 'failed' || status === 'doing' ? 1 : 0),
    doneAt: status === 'done' ? new Date().toISOString() : prev.doneAt,
    verdict: verdict || prev.verdict,
  };
  writeState(cfg, state);
}

/** 队列进度摘要（status 命令） */
export function queueSummary(cfg: TaskQConfig): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const sequence = buildExecutionSequence(queue);
  const state = readState(cfg);
  const done = sequence.filter((e) => state[e.spec.id]?.status === 'done').length;
  const failed = sequence.filter((e) => state[e.spec.id]?.status === 'failed').length;
  const doing = sequence.filter((e) => state[e.spec.id]?.status === 'doing').length;
  const todo = sequence.length - done - failed - doing;
  const lines: string[] = [];
  lines.push(`队列总览：共 ${sequence.length} 个任务`);
  lines.push(`  ✅ done: ${done}   ⛔ failed: ${failed}   ▶ doing: ${doing}   ⏳ todo: ${todo}`);
  if (queue.modules.length) {
    lines.push(`任务模块 ${queue.modules.length} 个：${queue.modules.map((m) => `${m.id}（${m.subtasks.length} 个子任务）`).join('、')}`);
  }
  const next = findNextPending(sequence, state);
  lines.push(next ? `下一个接力任务：「${next.spec.id}」` : '队列已清空或全部完成');
  return lines.join('\n');
}
