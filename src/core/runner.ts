// 接力执行引擎：无人值守的核心——做完一个接下一个，断点续跑，直到队列清空
// prompt 接力协议：CLI 输出 [TASKQ_PROMPT] 块 + 退出码 10，宿主 AI 执行后调 taskq done
// prompt 四段增强：模块身份（共享 spec 每次重读）/ 引用消解（真实内容）/ 动作义务（动作必须执行）/ 执行留痕（断点续做）
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, readState, writeState, TaskRunState } from './config';
import { scanQueue, buildExecutionSequence, filterExecutionSequence, findNextPending, selectBatch, latestBatchId, DOING_TIMEOUT_MS, ExecutableTask, BatchInfo } from './queue';
import { readBatchConfig, SYSTEM_BATCH_DEFAULTS, BatchConfig } from './batch-config';
import { buildDoneAssessment, dispatchAssessment, assessmentNotice } from './assessment';
import { resolveTaskType } from './task-type';
import { resolveReferences } from './references';
import { renderEffectiveRoleSegment, resolveEffectiveRole } from './task-role';

/** 每任务尝试上限（失败重试，超过标记 failed 不再接力）——保留导出兼容；批次可用 BATCH.yaml 的 max-attempts 覆盖 */
export const MAX_ATTEMPTS = SYSTEM_BATCH_DEFAULTS['max-attempts'];

// —— 上下文防爆（Speccore 教训：prompt 无上限必爆；截断 + 亮明原文路径，AI 按需 Read 原文）——
const MAX_BODY_CHARS = 12000; // 规格正文截断上限
const MAX_PROGRESS_CHARS = 4000; // 执行留痕截断上限（保留最新进度尾部）
const MAX_CONSTRAINTS_CHARS = 8000; // 模块约束截断上限

/** 防爆截断：超长时 tail 取尾部（进度类，最新在尾），否则取头部（正文/约束类）；标注省略量与原文路径 */
function guardLong(text: string, max: number, tail: boolean, sourcePath?: string): string {
  if (text.length <= max) return text;
  const hint = sourcePath ? `（如需完整内容请 Read 原文：${sourcePath}；大文件分段 Read、读完一段处理一段）` : '';
  if (tail) {
    return `…（前文省略 ${text.length - max} 字符）\n${text.slice(-max)}`;
  }
  return `${text.slice(0, max)}\n…（原文共 ${text.length} 字符，已截断${hint}）`;
}

export interface NextTaskInfo {
  task: ExecutableTask;
  prompt: string;      // 交给宿主 AI 的完整 prompt
  exitCode: number;    // 10 = 有下一任务（宿主 AI 接力），12 = 拦截（draft / 模块缺共享 spec / doing 进行中 / failed 需人工介入），0 = 队列已空
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
      lines.push(guardLong(progress, MAX_PROGRESS_CHARS, true));
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
    lines.push(`### 规格正文\n${guardLong(spec.body.trim(), MAX_BODY_CHARS, false, join(spec.dir, 'SPEC.md'))}`);
    lines.push('');
  }
  // —— 执行角色（可选：type 管形态，role 管专业；显式 role 或 applies-to 绑定自动匹配，无则保持老行为）——
  lines.push(...renderEffectiveRoleSegment(resolveEffectiveRole(metaDir, spec)));
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
      lines.push(guardLong(exec.module.constraints.trim(), MAX_CONSTRAINTS_CHARS, false, exec.module.constraintsPath));
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
        lines.push(r.content || `（${r.note || `请 Read 原文：${r.absPath}`}）`);
        lines.push('');
      } else if (r.kind === 'image') {
        lines.push(`### 图片：${r.target}（真实存在：${r.absPath}）`);
        lines.push('');
        lines.push('请用视觉能力读取这张图片（宿主 AI 有读图能力），理解其中的设计/截图/图示。');
        lines.push('');
      } else {
        lines.push(`### 外部链接：${r.target}（CLI 已抓取内容）`);
        lines.push('');
        lines.push(r.content || `（${r.note || '抓取失败'}）`);
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
 * - 有下一任务 → 占位 doing + 输出 [TASKQ_PROMPT] 块，exitCode 10（宿主 AI 接力）
 * - draft 任务 → 提示先 clarify（--skip-draft 或批次配置 skip-draft 强跑）
 * - 模块子任务但共享 spec 缺失/为空 → 阻塞（宁可停，不可裸奔）
 * - failed 任务 → 需人工介入（协议拦截，不无限重试）
 * - 有 doing 任务未完成（未超时）→ 有执行者在干活，不重复领取
 */
export function relayNext(cfg: TaskQConfig, opts: { skipDraft?: boolean; batch?: string; task?: string; module?: string } = {}): NextTaskInfo {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const batchCfg = effectiveBatchConfig(cfg, queue.batches, opts.batch);
  // 批次聚焦：缺省 = 最新批次（新批次插队先跑）；--batch batch-NNN 指定老批次；--batch all 全批次
  const view = selectBatch(queue, opts.batch);
  if (!view) {
    return {
      task: null as any,
      prompt: '',
      exitCode: 12,
      summary: `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、') || '无（队列为空）'}`,
    };
  }
  // 定向执行：--task 单任务 / --module 模块全部子任务（无匹配时明确报错，不悄悄跑全量）
  let sequence = buildExecutionSequence(view);
  if (opts.task || opts.module) {
    sequence = filterExecutionSequence(sequence, { task: opts.task, module: opts.module });
    if (sequence.length === 0) {
      return {
        task: null as any,
        prompt: '',
        exitCode: 12,
        summary: `❌ 定向目标不存在：${opts.task ? `任务「${opts.task}」` : `模块「${opts.module}」`}。用 taskq list 查 ID（任务如 34-cshidaima，模块如 module-yingxiaomokuai）`,
      };
    }
  }
  const state = readState(cfg);
  const next = findNextPending(sequence, state);
  if (!next) {
    // 没有可领取的任务：区分「队列已清空」与「有任务正在执行中」
    const doing = sequence.find((e) => state[e.spec.id]?.status === 'doing');
    if (doing) {
      const at = state[doing.spec.id].doingAt || '未知时间';
      return {
        task: null as any,
        prompt: '',
        exitCode: 12,
        summary: `⏳ 任务「${doing.spec.id}」正在执行中（${at} 领取）。执行者完成后会调 taskq done 登记；若执行者已中断，超过 24 小时自动重拾（或手动把 queue/.taskchain/state.json 中该任务状态改为 todo）`,
      };
    }
    return { task: null as any, prompt: '', exitCode: 0, summary: `✅ 队列已清空：${sequence.length} 个任务全部完成${doneReportNotice(cfg, sequence, state, queue.batches, opts.batch)}` };
  }
  const st = state[next.spec.id] || { status: 'todo', attempts: 0 };
  if (st.status === 'failed') {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⛔ 任务「${next.spec.id}」已失败 ${st.attempts} 次（达尝试上限 ${batchCfg['max-attempts']} 次）——需人工介入：检查产出与规格，修复后运行 \`taskq done ${next.spec.id} --verdict "..."\` 重新验收；或手动把 queue/.taskchain/state.json 中该任务状态改为 todo 重跑`,
    };
  }
  if (next.module && next.module.constraintsMissing) {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⏸ 任务「${next.spec.id}」属于模块「${next.module.id}」，但模块公共约束 CONSTRAINTS.md 缺失或为空——共享 spec 是子任务每次执行前重置的必读前提，先补全再接力：${next.module.constraintsPath}`,
    };
  }
  if (next.spec.draft && !(opts.skipDraft || batchCfg['skip-draft'])) {
    return {
      task: next,
      prompt: '',
      exitCode: 12,
      summary: `⏸ 任务「${next.spec.id}」规格标记为 draft（未澄清），建议先 \`taskq clarify --task ${next.spec.id}\` 补全；或 \`taskq run --skip-draft\` 强跑（也可在批次 BATCH.yaml 设 skip-draft: true 对本批长期生效）`,
    };
  }
  const prompt = buildTaskPrompt(next, cfg.metaDir, cfg.projectRoot);
  // 占位 doing：防并发重复领取，status 面板与报告有真数据（doingAt 超时后自动重拾）
  markTaskState(cfg, next.spec.id, 'doing');
  return {
    task: next,
    prompt,
    exitCode: 10,
    summary: `▶ 接力推进：下个任务「${next.spec.id}」（第 ${st.attempts + 1} 次尝试）`,
  };
}

/** 登记任务状态（done 命令写入；attempts = 失败次数，failed 时 +1） */
export function markTaskState(cfg: TaskQConfig, taskId: string, status: 'doing' | 'done' | 'failed', verdict?: string): void {
  const state = readState(cfg);
  const prev = state[taskId] || { status: 'todo', attempts: 0 };
  const now = new Date().toISOString();
  state[taskId] = {
    status,
    attempts: prev.attempts + (status === 'failed' ? 1 : 0),
    doneAt: status === 'done' ? now : prev.doneAt,
    doingAt: status === 'doing' ? now : prev.doingAt,
    verdict: verdict || prev.verdict,
  };
  writeState(cfg, state);
}

/** 队列进度摘要（status 命令）：批次聚焦同 relayNext，多批次时先亮批次行 */
export function queueSummary(cfg: TaskQConfig, opts: { batch?: string } = {}): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const view = selectBatch(queue, opts.batch) || queue;
  const sequence = buildExecutionSequence(view);
  const state = readState(cfg);
  const done = sequence.filter((e) => state[e.spec.id]?.status === 'done').length;
  const failed = sequence.filter((e) => state[e.spec.id]?.status === 'failed').length;
  const doing = sequence.filter((e) => state[e.spec.id]?.status === 'doing').length;
  const todo = sequence.length - done - failed - doing;
  const lines: string[] = [];
  if (queue.batches.length > 1 || opts.batch) {
    const focus = opts.batch === 'all' ? '全部批次' : opts.batch || latestBatchId(queue.batches);
    lines.push(`批次：${queue.batches.map((b) => b.id).join('、')}（当前聚焦 ${focus}）`);
  }
  lines.push(`队列总览：共 ${sequence.length} 个任务`);
  lines.push(`  ✅ done: ${done}   ⛔ failed: ${failed}   ▶ doing: ${doing}   ⏳ todo: ${todo}`);
  if (queue.modules.length) {
    lines.push(`任务模块 ${queue.modules.length} 个：${queue.modules.map((m) => `${m.id}（${m.subtasks.length} 个子任务${m.constraintsMissing ? '，缺公共约束' : ''}）`).join('、')}`);
  }
  const next = findNextPending(sequence, state);
  lines.push(next ? `下一个接力任务：「${next.spec.id}」` : '队列已清空或全部完成');
  return lines.join('\n');
}

// ============================================================
// 批次接力（taskq execute）：run 的批量化——一次领取 N 个任务的完整 prompt
// 拦停语义与 relayNext 完全一致（draft/模块缺共享 spec/doing 活跃/failed 需人工介入），批截止于拦停任务
// ============================================================

/**
 * 当前聚焦批次的配置（BATCH.yaml）：--batch 指定批次 / 缺省最新批次；
 * 'all' 跨批次或队列无批次目录时回落系统默认（跨批次混跑没有单一「脾气」）
 */
function effectiveBatchConfig(cfg: TaskQConfig, batches: BatchInfo[], batch?: string): BatchConfig {
  const batchId = batch && batch !== 'all' ? batch : latestBatchId(batches);
  if (!batchId) return { ...SYSTEM_BATCH_DEFAULTS };
  return readBatchConfig(join(cfg.queueDir, batchId));
}

/**
 * 队列清空时的完成评估报告（后台生成，不阻断）——返回追加到 summary 的提示行。
 * 只在「真有过执行」时生成（有 done/failed 记录）；空队列或从未执行过不生成，避免空转噪音。
 */
function doneReportNotice(cfg: TaskQConfig, sequence: ExecutableTask[], state: Record<string, TaskRunState>, batches: BatchInfo[], batch?: string): string {
  if (!sequence.length) return '';
  const hasExecuted = sequence.some((e) => {
    const st = state[e.spec.id];
    return st?.status === 'done' || st?.status === 'failed';
  });
  if (!hasExecuted) return '';
  const batchId = batch && batch !== 'all' ? batch : latestBatchId(batches) || 'tasks';
  const report = buildDoneAssessment(batchId, sequence.map((e) => e.spec), state);
  dispatchAssessment(cfg, report);
  return `\n${assessmentNotice(cfg.queueDir, report)}`;
}

export interface BatchRelayResult {
  tasks: ExecutableTask[];  // 本批领取的任务
  prompts: string[];        // 与 tasks 一一对应的完整执行 prompt
  exitCode: number;         // 10 = 有批待执行（宿主 AI 按序接力），12 = 拦截，0 = 队列已清空
  summary: string;          // 批状态摘要（含执行约定）
  stopReason?: string;      // 批后拦停原因（批内任务已发，批后的拦停提醒）
}

/** 领取一批任务（默认 3 个）：按执行序列取连续未完成任务，批内逐个渲染 prompt + 占位 doing */
export function batchRelay(cfg: TaskQConfig, opts: { batch?: string; batchSize?: number; skipDraft?: boolean; task?: string; module?: string } = {}): BatchRelayResult {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const batchCfg = effectiveBatchConfig(cfg, queue.batches, opts.batch);
  const view = selectBatch(queue, opts.batch);
  if (!view) {
    return {
      tasks: [],
      prompts: [],
      exitCode: 12,
      summary: `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、') || '无（队列为空）'}`,
    };
  }
  let sequence = buildExecutionSequence(view);
  if (opts.task || opts.module) {
    sequence = filterExecutionSequence(sequence, { task: opts.task, module: opts.module });
    if (sequence.length === 0) {
      return {
        tasks: [],
        prompts: [],
        exitCode: 12,
        summary: `❌ 定向目标不存在：${opts.task ? `任务「${opts.task}」` : `模块「${opts.module}」`}。用 taskq list 查 ID（任务如 34-cshidaima，模块如 module-yingxiaomokuai）`,
      };
    }
  }
  const state = readState(cfg);
  // 批大小优先级链：CLI --batch-size > 批次配置 batch-size > 系统默认（配置层已字段级兜底，这里只兜 CLI 显式 0/负数的病态输入）
  const batchSize = Math.max(1, opts.batchSize || batchCfg['batch-size']);
  const skipDraft = opts.skipDraft || batchCfg['skip-draft'];
  const taken: ExecutableTask[] = [];
  let stop: string | undefined;

  for (const t of sequence) {
    if (taken.length >= batchSize) break;
    const st = state[t.spec.id];
    if (st?.status === 'done') continue;
    if (st?.status === 'failed') {
      stop = `⛔ 任务「${t.spec.id}」已失败 ${st.attempts} 次（达尝试上限 ${batchCfg['max-attempts']} 次）——需人工介入：检查产出与规格，修复后运行 \`taskq done ${t.spec.id} --verdict "..."\` 重新验收；或手动把 queue/.taskchain/state.json 中该任务状态改为 todo 重跑`;
      break;
    }
    if (st?.status === 'doing') {
      const at = st.doingAt ? new Date(st.doingAt).getTime() : 0;
      if (Date.now() - at <= DOING_TIMEOUT_MS) {
        stop = `⏳ 任务「${t.spec.id}」正在执行中（${st.doingAt} 领取）。执行者完成后会调 taskq done 登记；若执行者已中断，超过 24 小时自动重拾`;
        break;
      }
      // 孤儿 doing：领取超时视为执行者已中断，重拾（与 findNextPending 语义一致）
    }
    if (t.module && t.module.constraintsMissing) {
      stop = `⏸ 任务「${t.spec.id}」属于模块「${t.module.id}」，但模块公共约束 CONSTRAINTS.md 缺失或为空——先补全再接力：${t.module.constraintsPath}`;
      break;
    }
    if (t.spec.draft && !skipDraft) {
      stop = `⏸ 任务「${t.spec.id}」规格标记为 draft（未澄清），建议先 \`taskq clarify --task ${t.spec.id}\` 补全；或 \`taskq execute --skip-draft\` 强跑（也可在批次 BATCH.yaml 设 skip-draft: true 对本批长期生效）`;
      break;
    }
    taken.push(t);
  }

  if (!taken.length) {
    if (stop) return { tasks: [], prompts: [], exitCode: 12, summary: stop };
    return { tasks: [], prompts: [], exitCode: 0, summary: `✅ 队列已清空：${sequence.length} 个任务全部完成${doneReportNotice(cfg, sequence, state, queue.batches, opts.batch)}` };
  }

  const prompts = taken.map((t) => buildTaskPrompt(t, cfg.metaDir, cfg.projectRoot));
  // 批内全部占位 doing：串行执行整批，done 逐个销账（中断 24 小时后自动重拾）
  taken.forEach((t) => markTaskState(cfg, t.spec.id, 'doing'));
  const ids = taken.map((t) => t.spec.id).join('、');
  const lines: string[] = [
    `📦 批次接力：一次领取 ${taken.length} 个任务（${ids}）`,
    `按顺序执行：每个完成即 \`taskq done <id> --verdict "..."\`；批内全部完成后再次 \`taskq execute\` 取下一批，直到退出码 0`,
  ];
  if (stop) lines.push(`⛔ 批后拦停（下一批处理）：${stop}`);
  return { tasks: taken, prompts, exitCode: 10, summary: lines.join('\n'), stopReason: stop };
}

/** 渲染批次接力输出：批摘要 + 逐任务 [TASKQ_PROMPT] 块 + 执行约定 */
export function renderBatchResult(r: BatchRelayResult): string {
  const lines: string[] = [r.summary, ''];
  r.tasks.forEach((t, i) => {
    lines.push(`───── 批次任务 ${i + 1}/${r.tasks.length}：${t.spec.id} ─────`);
    lines.push('');
    lines.push('[TASKQ_PROMPT]');
    lines.push(r.prompts[i]);
    lines.push('[TASKQ_PROMPT_END]');
    lines.push('');
  });
  return lines.join('\n');
}
