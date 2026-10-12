// 队列报告：执行留痕，队列跑完「有账可查、可复盘、可追责」
import { writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, readState } from './config';
import { scanQueue, buildExecutionSequence } from './queue';

export function generateQueueReport(cfg: TaskQConfig): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const sequence = buildExecutionSequence(queue);
  const state = readState(cfg);
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# 队列执行报告`);
  lines.push('');
  lines.push(`- 生成时间：${now}`);
  lines.push(`- 任务总数：${sequence.length}`);
  const done = sequence.filter((e) => state[e.spec.id]?.status === 'done');
  const failed = sequence.filter((e) => state[e.spec.id]?.status === 'failed');
  const pending = sequence.filter((e) => !state[e.spec.id] || ['todo', 'doing', 'draft'].includes(state[e.spec.id].status));
  lines.push(`- 完成：${done.length} / 失败：${failed.length} / 未完成：${pending.length}`);
  lines.push(`- 验收通过率：${done.length ? (done.filter((e) => !state[e.spec.id]?.verdict || /pass|通过/.test(state[e.spec.id].verdict!)).length / done.length * 100).toFixed(0) : 0}%（按登记结论）`);
  lines.push('');
  lines.push('## 执行记录');
  lines.push('');
  lines.push('| 任务 | 状态 | 尝试次数 | 完成时间 | 验收结论 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');
  for (const e of sequence) {
    const s = state[e.spec.id];
    const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
    lines.push(`| ${e.spec.id} | ${icon} ${s?.status || 'todo'} | ${s?.attempts || 0} | ${s?.doneAt || '-'} | ${s?.verdict || '-'} |`);
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
  const report = lines.join('\n');
  writeFileSync(join(cfg.queueDir, 'QUEUE_REPORT.md'), report, 'utf-8');
  return report;
}
