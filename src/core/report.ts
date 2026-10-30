// 队列报告：执行留痕，队列跑完「有账可查、可复盘、可追责」
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { TaskQConfig, readState } from './config';
import { scanQueue, buildExecutionSequence } from './queue';
import { verdictPassed } from './acceptance';

/** 报告筛选范围：--batch 聚焦批次 / --status 状态 / --type 类型（AND 组合） */
export interface ReportOptions {
  batch?: string;
  status?: string;
  type?: string;
}

export function generateQueueReport(cfg: TaskQConfig, opts: ReportOptions = {}): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  // 批次聚焦（report 默认全量；--batch 指定才收窄，与 list 口径一致）
  let view = queue;
  if (opts.batch && opts.batch !== 'all') {
    const found = queue.batches.find((b) => b.id === opts.batch);
    if (!found) {
      return `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、')}`;
    }
    view = { tasks: found.tasks, modules: found.modules, batches: queue.batches };
  }
  let sequence = buildExecutionSequence(view);
  const state = readState(cfg);
  if (opts.status) sequence = sequence.filter((e) => (state[e.spec.id]?.status || 'todo') === opts.status);
  if (opts.type) sequence = sequence.filter((e) => e.spec.type === opts.type);
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# 队列执行报告`);
  lines.push('');
  lines.push(`- 生成时间：${now}`);
  lines.push(`- 任务总数：${sequence.length}`);
  const cond = [
    opts.batch && opts.batch !== 'all' ? `批次 ${opts.batch}` : '',
    opts.status ? `状态 ${opts.status}` : '',
    opts.type ? `类型 ${opts.type}` : '',
  ].filter(Boolean).join(' + ');
  if (cond) lines.push(`- 筛选范围：${cond}`);
  const done = sequence.filter((e) => state[e.spec.id]?.status === 'done');
  const failed = sequence.filter((e) => state[e.spec.id]?.status === 'failed');
  const pending = sequence.filter((e) => !state[e.spec.id] || ['todo', 'doing', 'draft'].includes(state[e.spec.id].status));
  lines.push(`- 完成：${done.length} / 失败：${failed.length} / 未完成：${pending.length}`);
  lines.push(`- 验收通过率：${done.length ? (done.filter((e) => verdictPassed(state[e.spec.id]?.verdict)).length / done.length * 100).toFixed(0) : 0}%（按登记结论）`);
  lines.push('');
  lines.push('## 执行记录');
  lines.push('');
  lines.push('| 任务 | 优先级 | 状态 | 尝试次数 | 完成时间 | 验收结论 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const e of sequence) {
    const s = state[e.spec.id];
    const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
    lines.push(`| ${e.spec.id} | ${e.spec.priority || '-'} | ${icon} ${s?.status || 'todo'} | ${s?.attempts || 0} | ${s?.doneAt || '-'} | ${s?.verdict || '-'} |`);
  }
  lines.push('');
  lines.push('## 产出清单');
  lines.push('');
  for (const e of sequence) {
    lines.push(`- [${e.spec.id}] → ${e.spec.output}`);
  }
  lines.push('');
  const retries = sequence.filter((e) => (state[e.spec.id]?.attempts || 0) > 1).map((e) => `${e.spec.id}（${state[e.spec.id].attempts} 次）`);
  if (retries.length) {
    lines.push('## 重试记录');
    lines.push('');
    retries.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }
  if (failed.length) {
    lines.push('## 失败任务（需人工介入）');
    lines.push('');
    failed.forEach((e) => lines.push(`- ${e.spec.id}：${state[e.spec.id].verdict || '未通过验收'}`));
    lines.push('');
  }
  // 工时与优先级汇总（有元数据才展示，不空占版面）
  const prioCount: Record<string, number> = {};
  const estimated = sequence.filter((e) => e.spec.estimate !== undefined);
  for (const e of sequence) {
    if (e.spec.priority) prioCount[e.spec.priority] = (prioCount[e.spec.priority] || 0) + 1;
  }
  if (estimated.length || Object.keys(prioCount).length) {
    lines.push('## 工时与优先级');
    lines.push('');
    if (estimated.length) {
      lines.push(`- 预估总工时：${estimated.reduce((a, e) => a + (e.spec.estimate as number), 0)} 小时（${estimated.length} 个已估任务）`);
    }
    if (Object.keys(prioCount).length) {
      lines.push(`- 优先级分布：${Object.entries(prioCount).map(([k, v]) => `${k} ×${v}`).join(' / ')}`);
    }
    lines.push('');
  }
  const report = lines.join('\n');
  // 未 init 也兜底：自动补目录，不裸奔
  const reportPath = join(cfg.queueDir, 'QUEUE_REPORT.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, 'utf-8');
  return report;
}
