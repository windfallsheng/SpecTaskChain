// 接力执行引擎：无人值守的核心——做完一个接下一个，断点续跑，直到队列清空
// prompt 接力协议：CLI 输出 [TASKQ_PROMPT] 块 + 退出码 10，宿主 AI 执行后调 taskq done
// prompt 四段增强：模块身份（共享 spec 每次重读）/ 引用消解（真实内容）/ 动作义务（动作必须执行）/ 执行留痕（断点续做）
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, readState, writeState } from './config';
import { scanQueue, buildExecutionSequence, findNextPending, ExecutableTask } from './queue';
import { resolveTaskType } from './task-type';
import { resolveReferences } from './references';

/** 每任务尝试上限（失败重试，超过标记 failed 不再接力） */
export const MAX_ATTEMPTS = 3;

export interface NextTaskInfo {
  task: ExecutableTask;
  prompt: string;      // 交给宿主 AI 的完整 prompt
  exitCode: number;    // 10 = 有下一任务（宿主 AI 接力），12 = 拦截（draft 未补全 / 模块缺共享 spec），0 = 队列已空
  summary: string;     // 状态摘要
}

/** 构建任务执行 prompt：规格全文 + 执行留痕 + 模块身份与公共约束 + 类型默认约束 + 引用资料 + 动作义务 + 验收标准 + 输出协议 */
export function buildTaskPrompt(exec: ExecutableTask, metaDir: string, projectRoot: string): string {
  const spec = exec.spec;
  const typeDef = resolveTaskType(metaDir, spec.type);
  const lines: string[] = [];
  lines.push('你正在执行 SpecTaskChain 队列中的一个任务（接力推进：干完这个，下个接着来）。');
  lines.push('');
  // —— 执行留痕：断点续跑时先读上次进度（续做而非重做）——
  const progressPath = join(spec.dir, 'PROGRESS.md');
  if (existsSync(progressPath)) {
    const progress = readFileSync(progressPath, 'utf-8').trim();
    if (progress) {
      lines.push('## 上次执行留痕');
      lines.push('');
      lines.push('这是上次执行留下的进度（做到了哪、在等什么）。先读它：按留痕续做，不要从头重做。');
      lines.push('');
      lines.push(progress);
      lines.push('');
    }
  }
  // —— 任务规格 ——
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
  // —— 模块身份与公共约束（恒存在段：每次执行子任务前重读共享 spec，等于重置必须的提示词）——
  if (exec.module) {
    const idx = exec.module.subtasks.findIndex((s) => s.id === spec.id) + 1;
    lines.push('## 模块身份与公共约束');
    lines.push('');
    lines.push(`你属于任务模块「${exec.module.id}」，是其 ${idx}/${exec.module.subtasks.length} 个子任务之一。`);
    lines.push('');
    if (exec.module.constraints.trim()) {
      lines.push('模块公共约束（共享 spec，每次执行前重新读取，必须遵守）：');
      lines.push('');
      lines.push(exec.module.constraints.trim());
    } else {
      lines.push('⚠️ 本模块未声明公共约束（CONSTRAINTS.md 缺失或为空）。');
    }
    lines.push('');
  }
  // —— 类型默认约束 ——
  if (typeDef.defaultConstraints.length) {
    lines.push('## 类型默认约束');
    lines.push('');
    typeDef.defaultConstraints.forEach((c) => lines.push(`- ${c}`));
    lines.push('');
  }
  // —— 引用的资料（CLI 已读取真实内容）——
  // 引用基准 = 项目根（与 output/artifacts 一致：用户写 SPEC 时站在项目根视角）
  const refs = resolveReferences(`${spec.goal}\n${spec.body}`, projectRoot);
  const okRefs = refs.filter((r) => r.status === 'ok');
  const badRefs = refs.filter((r) => r.status !== 'ok');
  if (okRefs.length) {
    lines.push('## 引用的资料（CLI 已读取真实内容）');
    lines.push('');
    lines.push('以下是规格中引用的文件/图片/链接的真实内容，属于规格的一部分——必须理解并执行其中的描述。');
    lines.push('');
    for (const r of okRefs) {
      if (r.kind === 'file') {
        lines.push(`### 文件：${r.target}`);
        lines.push('');
        lines.push(r.content || '');
        lines.push('');
      } else if (r.kind === 'image') {
        lines.push(`### 图片：${r.target}（真实存在：${r.absPath}）`);
        lines.push('');
        lines.push('请用视觉能力读取这张图片（宿主 AI 有读图能力），理解其中的设计/截图/图示。');
        lines.push('');
      } else {
        lines.push(`### 外部链接：${r.target}（CLI 已抓取内容）`);
        lines.push('');
        lines.push(r.content || '');
        lines.push('');
      }
    }
  }
  if (badRefs.length) {
    lines.push('## ⚠️ 引用告警');
    lines.push('');
    lines.push('以下引用无法读取（文件不存在 / 抓取失败）。请在执行前告知用户补上，或与用户确认后按现有规格继续：');
    lines.push('');
    for (const r of badRefs) {
      const loc = r.absPath ? `（查找位置：${r.absPath}）` : '';
      lines.push(`- ${r.target}${loc}：${r.status === 'fetch-failed' ? '抓取失败' : '文件不存在'}`);
    }
    lines.push('');
  }
  // —— 动作义务：动作型要求是任务的一部分 ——
  lines.push('## 执行要求');
  lines.push('');
  lines.push('规格正文中的动作型要求（发邮件、发通知、上传、调用外部服务等）是任务的一部分，必须执行——只产出文件不执行动作，视为未完成。');
  lines.push('');
  // —— 验收标准 ——
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
  lines.push('');
  lines.push('执行过程中，把进度写进任务目录的 PROGRESS.md（每完成一个阶段更新一句：做到了哪、在等什么）。断点续跑时它会被注入 prompt，供下个会话续做。');
  return lines.join('\n');
}

/**
 * 接力推进：找第一个未完成任务，输出其 prompt
 * - 队列空 → exitCode 0
 * - 有下一任务 → 输出 [TASKQ_PROMPT] 块，exitCode 10（宿主 AI 接力）
 * - draft 任务 → 提示先 clarify（可 --skip-draft 强跑）
 * - 模块子任务但共享 spec 缺失/为空 → 阻塞（宁可停，不可裸奔）
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
  if (next.module && next.module.constraintsMissing) {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⏸ 任务「${next.spec.id}」属于模块「${next.module.id}」，但模块公共约束 CONSTRAINTS.md 缺失或为空——共享 spec 是子任务每次执行前重置的必读前提，先补全再接力：${next.module.constraintsPath}`,
    };
  }
  if (next.spec.draft && !opts.skipDraft) {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⏸ 任务「${next.spec.id}」规格标记为 draft（未澄清），建议先 \`taskq clarify --task ${next.spec.id}\` 补全；或 \`taskq run --skip-draft\` 强跑`,
    };
  }
  const prompt = buildTaskPrompt(next, cfg.metaDir, cfg.projectRoot);
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
    lines.push(`任务模块 ${queue.modules.length} 个：${queue.modules.map((m) => `${m.id}（${m.subtasks.length} 个子任务${m.constraintsMissing ? '，缺公共约束' : ''}）`).join('、')}`);
  }
  const next = findNextPending(sequence, state);
  lines.push(next ? `下一个接力任务：「${next.spec.id}」` : '队列已清空或全部完成');
  return lines.join('\n');
}
