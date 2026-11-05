// 队列报告：执行留痕，队列跑完「有账可查、可复盘、可追责」
// 双形态：QUEUE_REPORT.md（终端/文档）+ REPORT.html（复盘可视化，taskq report --html）
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { DARK_CSS, SCAN_CSS, SCAN_LAYERS } from './html-theme';
import { TaskQConfig, readState } from './config';
import { scanQueue, buildExecutionSequence } from './queue';
import { verdictPassed } from './acceptance';
import { daysOverdue } from './task-spec';

/** 报告筛选范围：--batch 聚焦批次 / --status 状态 / --type 类型（AND 组合） */
export interface ReportOptions {
  batch?: string;
  status?: string;
  type?: string;
}

/** HTML 转义：任务描述与验收结论来自规格（内容不受控） */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

type Entry = ReturnType<typeof buildExecutionSequence>[number];
type StateMap = ReturnType<typeof readState>;

/** 报告数据（md 与 html 共用同一份计算，避免两处口径漂移） */
interface ReportData {
  sequence: Entry[];
  state: StateMap;
  done: Entry[];
  failed: Entry[];
  pending: Entry[];
  passRate: number;
  now: string;
  cond: string;
  retries: Array<{ id: string; attempts: number }>;
  estimated: Array<{ id: string; est: number }>;
  prioCount: Record<string, number>;
  spentSum: number;
  spentCount: number;
  deviations: Array<{ id: string; est: number; spent: number; diff: number }>;
  overdue: Array<{ id: string; due: string; days: number }>;
}

/** 收集报告数据：批次聚焦 + 状态/类型筛选 + 统计汇总；批次不存在时返回错误文案 */
function collectReport(cfg: TaskQConfig, opts: ReportOptions = {}): ReportData | { error: string } {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  // 批次聚焦（report 默认全量；--batch 指定才收窄，与 list 口径一致）
  let view = queue;
  if (opts.batch && opts.batch !== 'all') {
    const found = queue.batches.find((b) => b.id === opts.batch);
    if (!found) {
      return { error: `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、')}` };
    }
    view = { tasks: found.tasks, modules: found.modules, batches: queue.batches };
  }
  let sequence = buildExecutionSequence(view);
  const state = readState(cfg);
  if (opts.status) sequence = sequence.filter((e) => (state[e.spec.id]?.status || 'todo') === opts.status);
  if (opts.type) sequence = sequence.filter((e) => e.spec.type === opts.type);
  const done = sequence.filter((e) => state[e.spec.id]?.status === 'done');
  const failed = sequence.filter((e) => state[e.spec.id]?.status === 'failed');
  const pending = sequence.filter((e) => !state[e.spec.id] || ['todo', 'doing', 'draft'].includes(state[e.spec.id].status));
  const passRate = done.length ? Math.round((done.filter((e) => verdictPassed(state[e.spec.id]?.verdict)).length / done.length) * 100) : 0;
  const cond = [
    opts.batch && opts.batch !== 'all' ? `批次 ${opts.batch}` : '',
    opts.status ? `状态 ${opts.status}` : '',
    opts.type ? `类型 ${opts.type}` : '',
  ].filter(Boolean).join(' + ');
  const retries = sequence
    .filter((e) => (state[e.spec.id]?.attempts || 0) > 1)
    .map((e) => ({ id: e.spec.id, attempts: state[e.spec.id].attempts }));
  const estimated = sequence.filter((e) => e.spec.estimate !== undefined).map((e) => ({ id: e.spec.id, est: e.spec.estimate as number }));
  const prioCount: Record<string, number> = {};
  for (const e of sequence) {
    if (e.spec.priority) prioCount[e.spec.priority] = (prioCount[e.spec.priority] || 0) + 1;
  }
  // 实际工时与偏差（done 且登记过 spent 才有账可算；diff 正 = 超支，负 = 省时）
  const spentTasks = done.filter((e) => state[e.spec.id]?.spent !== undefined);
  const spentSum = Math.round(spentTasks.reduce((a, e) => a + (state[e.spec.id].spent as number), 0) * 10) / 10;
  const deviations = spentTasks
    .filter((e) => e.spec.estimate !== undefined)
    .map((e) => {
      const est = e.spec.estimate as number;
      const spent = state[e.spec.id].spent as number;
      return { id: e.spec.id, est, spent, diff: Math.round((spent - est) * 10) / 10 };
    });
  const overdue: Array<{ id: string; due: string; days: number }> = [];
  for (const e of sequence) {
    if (!e.spec.due || ['done', 'failed'].includes(state[e.spec.id]?.status || '')) continue;
    const days = daysOverdue(e.spec.due);
    if (days !== null && days > 0) overdue.push({ id: e.spec.id, due: e.spec.due, days });
  }
  return {
    sequence,
    state,
    done,
    failed,
    pending,
    passRate,
    now: new Date().toISOString(),
    cond,
    retries,
    estimated,
    prioCount,
    spentSum,
    spentCount: spentTasks.length,
    deviations,
    overdue,
  };
}

export function generateQueueReport(cfg: TaskQConfig, opts: ReportOptions = {}): string {
  const collected = collectReport(cfg, opts);
  if ('error' in collected) return collected.error;
  const { sequence, state, done, failed, pending, passRate, now, cond, retries, estimated, prioCount, spentSum, spentCount, deviations, overdue } = collected;
  const lines: string[] = [];
  lines.push(`# 队列执行报告`);
  lines.push('');
  lines.push(`- 生成时间：${now}`);
  lines.push(`- 任务总数：${sequence.length}`);
  if (cond) lines.push(`- 筛选范围：${cond}`);
  lines.push(`- 完成：${done.length} / 失败：${failed.length} / 未完成：${pending.length}`);
  lines.push(`- 验收通过率：${passRate}%（按登记结论）`);
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
  if (retries.length) {
    lines.push('## 重试记录');
    lines.push('');
    retries.forEach((r) => lines.push(`- ${r.id}（${r.attempts} 次）`));
    lines.push('');
  }
  if (failed.length) {
    lines.push('## 失败任务（需人工介入）');
    lines.push('');
    failed.forEach((e) => lines.push(`- ${e.spec.id}：${state[e.spec.id].verdict || '未通过验收'}`));
    lines.push('');
  }
  // 工时与优先级汇总（有元数据才展示，不空占版面）
  if (estimated.length || Object.keys(prioCount).length) {
    lines.push('## 工时与优先级');
    lines.push('');
    if (estimated.length) {
      lines.push(`- 预估总工时：${estimated.reduce((a, e) => a + e.est, 0)} 小时（${estimated.length} 个已估任务）`);
    }
    if (spentCount) {
      const net = Math.round(deviations.reduce((a, d) => a + d.diff, 0) * 10) / 10;
      const over = deviations.filter((d) => d.diff > 0).length;
      const under = deviations.filter((d) => d.diff < 0).length;
      lines.push(`- 实际总工时：${spentSum} 小时（${spentCount} 个已登记）`);
      lines.push(`- 预估 vs 实际：${net > 0 ? `+${net}h` : `${net}h`}（超支 ${over} / 省时 ${under} / 持平 ${deviations.length - over - under}）`);
      const drift = deviations.filter((d) => d.diff !== 0);
      if (drift.length) lines.push(`- 偏差明细：${drift.map((d) => `${d.id} ${d.diff > 0 ? `+${d.diff}h` : `${d.diff}h`}`).join(' / ')}（估 → 实）`);
    }
    if (Object.keys(prioCount).length) {
      lines.push(`- 优先级分布：${Object.entries(prioCount).map(([k, v]) => `${k} ×${v}`).join(' / ')}`);
    }
    lines.push('');
  }
  if (overdue.length) {
    lines.push('## 逾期任务（到期未完成）');
    lines.push('');
    overdue.forEach((o) => lines.push(`- ${o.id}：截止 ${o.due}（已过 ${o.days} 天）`));
    lines.push('');
  }
  const report = lines.join('\n');
  // 未 init 也兜底：自动补目录，不裸奔
  const reportPath = join(cfg.queueDir, 'reports', 'QUEUE_REPORT.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, 'utf-8');
  return report;
}

/** 复盘报告 HTML（taskq report --html）：状态分布条 + 执行记录表 + 失败红卡，与 PANEL.html 同视觉语言 */
export function generateReportHtml(cfg: TaskQConfig, opts: ReportOptions = {}): string {
  const collected = collectReport(cfg, opts);
  if ('error' in collected) return collected.error;
  const { sequence, state, done, failed, pending, passRate, cond, retries, estimated, prioCount, spentSum, spentCount, deviations, overdue } = collected;
  const total = sequence.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rows = sequence
    .map((e) => {
      const s = state[e.spec.id];
      const status = s?.status || 'todo';
      const color = status === 'done' ? '#22c55e' : status === 'failed' ? '#ef4444' : status === 'doing' ? '#3b82f6' : '#94a3b8';
      const icon = status === 'done' ? '✅' : status === 'failed' ? '⛔' : status === 'doing' ? '▶' : '⏳';
      return `<tr><td>${icon}</td><td>${esc(e.spec.id)}</td><td>${esc(e.spec.priority || '-')}</td><td style="color:${color};font-weight:600">${esc(status)}</td><td>${s?.attempts || 0}</td><td>${esc(s?.doneAt || '-')}</td><td>${esc(s?.verdict || '-')}</td><td>${e.spec.estimate !== undefined ? e.spec.estimate : '-'} / ${s?.spent !== undefined ? s.spent : '-'}</td></tr>`;
    })
    .join('');
  const failedCards = failed
    .map((e) => `<div class="fail"><b>${esc(e.spec.id)}</b><p>${esc(state[e.spec.id].verdict || '未通过验收')}</p></div>`)
    .join('');
  const overdueCards = overdue
    .map((o) => `<div class="fail"><b>${esc(o.id)}</b><p>截止 ${esc(o.due)}（已过 ${o.days} 天）</p></div>`)
    .join('');
  const retryBlocks = retries.map((r) => `<div class="retry">${esc(r.id)}（${r.attempts} 次）</div>`).join('');
  const statBlock =
    estimated.length || spentCount || Object.keys(prioCount).length
      ? `<h2>工时与优先级</h2><div class="zone"><p>${
          estimated.length ? `预估总工时：<b>${estimated.reduce((a, e) => a + e.est, 0)}</b> 小时（${estimated.length} 个已估任务）` : ''
        }${spentCount ? `　实际总工时：<b>${spentSum}</b> 小时（${spentCount} 个已登记）` : ''}${Object.keys(prioCount).length ? `　优先级分布：${Object.entries(prioCount)
          .map(([k, v]) => `${esc(k)} ×${v}`)
          .join(' / ')}` : ''}</p></div>`
      : '';
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecTaskChain 执行报告</title>
<style>
${DARK_CSS}${SCAN_CSS}
body{margin:40px auto;max-width:880px;padding:0 20px;position:relative;z-index:1}
</style>
</head>
<body>
${SCAN_LAYERS}
<h1>📊 队列执行报告</h1>
<div class="sub">${cond ? `筛选范围：${esc(cond)} · ` : ''}生成于 ${new Date().toLocaleString('zh-CN')}</div>
<div class="stats">
  <div class="stat"><div class="num">${total}</div><div class="lab">任务总数</div></div>
  <div class="stat"><div class="num" style="color:#22c55e">${done.length}</div><div class="lab">完成（${pct(done.length)}%）</div></div>
  <div class="stat"><div class="num" style="color:#ef4444">${failed.length}</div><div class="lab">失败（${pct(failed.length)}%）</div></div>
  <div class="stat"><div class="num" style="color:#94a3b8">${pending.length}</div><div class="lab">未完成（${pct(pending.length)}%）</div></div>
  <div class="stat"><div class="num" style="color:#3b82f6">${passRate}%</div><div class="lab">验收通过率</div></div>
</div>
<h2>执行记录</h2>
<table>
<thead><tr><th></th><th>任务</th><th>优先级</th><th>状态</th><th>尝试</th><th>完成时间</th><th>验收结论</th><th>工时（估/实）</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" style="color:#94a3b8">（无匹配任务）</td></tr>'}</tbody>
</table>
${failed.length ? `<h2>失败任务（需人工介入）</h2>${failedCards}` : ''}\n${overdue.length ? `<h2>逾期任务（到期未完成）</h2>${overdueCards}` : ''}
${retries.length ? `<h2>重试记录</h2>${retryBlocks}` : ''}
${statBlock}
<footer>SpecTaskChain · 完整账本见 queue/reports/QUEUE_REPORT.md（taskq report）</footer>
</body>
</html>`;
  const reportPath = join(cfg.queueDir, 'reports', 'REPORT.html');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, html, 'utf-8');
  return reportPath;
}
