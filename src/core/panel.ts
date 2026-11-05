// 批次看板（PANEL.html）：单文件，打开即看——五态统计卡、类型分组进度、工时对账、优先级与逾期维度
// 参考 speccore dashboard 的统计卡 + 类型分布思路；批次聚焦语义同 queueSummary（未指定聚焦最新批次，--batch all 全量）
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { TaskQConfig, readState } from './config';
import { scanQueue, buildExecutionSequence, selectBatch, resolveDefaultBatch, latestBatchId } from './queue';

/** HTML 转义：任务描述来自规格（内容不受控），面板打开不执行注入内容 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 类型徽章色板：8 色循环（同 PLAN.html 视觉语言） */
const TYPE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#ef4444', '#6366f1', '#84cc16'];
const STATUS_COLOR: Record<string, string> = { done: '#22c55e', failed: '#ef4444', doing: '#3b82f6', draft: '#f59e0b', todo: '#94a3b8' };
const STATUS_ICON: Record<string, string> = { done: '✅', failed: '⛔', doing: '▶', draft: '📝', todo: '⏳' };

/** 本地日期 YYYY-MM-DD（逾期判断锚） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function generatePanelHtml(cfg: TaskQConfig, batch?: string): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  // 批次聚焦语义与 queueSummary 一致：--batch 点名老批次 / --batch all 全量 / 缺省最新批次
  const view = selectBatch(queue, batch, resolveDefaultBatch(cfg, queue.batches)) || queue;
  const sequence = buildExecutionSequence(view);
  const state = readState(cfg);
  const today = todayStr();

  // ── 五态统计 ──
  const statusOf = (e: { spec: { id: string } }) => state[e.spec.id]?.status || 'todo';
  const done = sequence.filter((e) => statusOf(e) === 'done');
  const doing = sequence.filter((e) => statusOf(e) === 'doing');
  const failed = sequence.filter((e) => statusOf(e) === 'failed');
  const pct = sequence.length ? Math.round((done.length / sequence.length) * 100) : 0;

  // ── 工时对账（预估 estimate vs 实际 spent）──
  const estSum = sequence.reduce((a, e) => a + (e.spec.estimate || 0), 0);
  const spentTasks = done.filter((e) => state[e.spec.id]?.spent !== undefined);
  const spentSum = Math.round(spentTasks.reduce((a, e) => a + (state[e.spec.id].spent as number), 0) * 10) / 10;

  // ── 类型分组（动态聚合，不硬编码清单；自定义类型照常入列）──
  const typeAgg = new Map<string, { total: number; done: number; est: number }>();
  for (const e of sequence) {
    const a = typeAgg.get(e.spec.type) || { total: 0, done: 0, est: 0 };
    a.total += 1;
    a.est += e.spec.estimate || 0;
    if (statusOf(e) === 'done') a.done += 1;
    typeAgg.set(e.spec.type, a);
  }
  const typeCards = [...typeAgg.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([t, a], i) => {
      const color = TYPE_COLORS[i % TYPE_COLORS.length];
      const tp = a.total ? Math.round((a.done / a.total) * 100) : 0;
      return `<div class="tcard"><span class="tdot" style="background:${color}"></span><b>${esc(t)}</b><span class="tnum">${a.done}/${a.total}</span><span class="test">${a.est ? `预估 ${a.est}h` : '未估'}</span><div class="tbar"><div class="tfill" style="width:${tp}%;background:${color}"></div></div></div>`;
    })
    .join('');

  // ── 优先级分布（有数据才显示）──
  const prioAgg = new Map<string, number>();
  for (const e of sequence) {
    if (!e.spec.priority) continue;
    prioAgg.set(e.spec.priority, (prioAgg.get(e.spec.priority) || 0) + 1);
  }
  const prioChips = [...prioAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([p, n]) => `<span class="chip chip-${p.toLowerCase().replace(/[^a-z0-9]/g, '')}">${esc(p)} × ${n}</span>`)
    .join('');

  // ── 任务清单（加优先级/预估/实际/截止列；逾期红标）──
  const rows = sequence
    .map((e) => {
      const s = state[e.spec.id];
      const status = s?.status || 'todo';
      const overdue = e.spec.due && e.spec.due < today && status !== 'done';
      const dueCell = e.spec.due ? `<span class="${overdue ? 'overdue' : ''}">${esc(e.spec.due)}</span>` : '—';
      return `<tr><td>${STATUS_ICON[status] || '⏳'}</td><td>${esc(e.spec.id)}</td><td>${esc(e.spec.type)}</td><td style="color:${STATUS_COLOR[status] || '#94a3b8'};font-weight:600">${esc(status)}</td><td>${esc(e.spec.priority || '—')}</td><td>${e.spec.estimate ?? '—'}</td><td>${s?.spent ?? '—'}</td><td>${dueCell}</td><td>${esc(e.spec.goal.slice(0, 40))}</td></tr>`;
    })
    .join('');

  const moduleBlocks = view.modules
    .map((m) => {
      const doneSubs = m.subtasks.filter((s) => state[s.id]?.status === 'done').length;
      return `<div class="mod"><b>${esc(m.id)}</b>（共享约束 ${m.constraints.trim() ? '已挂' : '未挂'}）子任务 ${doneSubs}/${m.subtasks.length} 完成</div>`;
    })
    .join('');

  const statCards = [
    { label: '总任务', value: sequence.length, color: '#1e293b' },
    { label: '已完成', value: done.length, color: '#22c55e' },
    { label: '进行中', value: doing.length, color: '#3b82f6' },
    { label: '待办', value: sequence.length - done.length - doing.length - failed.length, color: '#94a3b8' },
    { label: '失败', value: failed.length, color: '#ef4444' },
  ]
    .map((c) => `<div class="scard"><div class="snum" style="color:${c.color}">${c.value}</div><div class="slabel">${c.label}</div></div>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecTaskChain 批次看板</title>
<style>
body{font-family:'PingFang SC','Hiragino Sans GB',sans-serif;margin:40px auto;max-width:960px;padding:0 20px;color:#1e293b;background:#f8fafc}
h1{font-size:26px;margin-bottom:4px}
.sub{color:#64748b;font-size:13px;margin-bottom:20px}
.scards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.scard{flex:1;min-width:110px;background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
.snum{font-size:26px;font-weight:700}
.slabel{color:#64748b;font-size:12px;margin-top:2px}
.bar{height:14px;background:#e2e8f0;border-radius:7px;overflow:hidden;margin-bottom:8px}
.fill{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:7px;transition:width .4s}
.pct{font-weight:700;color:#1e293b;margin-bottom:16px}
.ledger{background:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:13px;color:#475569;margin-bottom:8px}
h2{margin-top:28px;font-size:18px}
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.tcard{background:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
.tdot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
.tnum{color:#64748b;margin-left:8px;font-size:13px}
.test{float:right;color:#94a3b8;font-size:12px}
.tbar{height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:8px}
.tfill{height:100%;border-radius:3px;transition:width .4s}
.chip{display:inline-block;background:#fff;border-radius:20px;padding:4px 12px;margin:4px 6px 0 0;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.08);color:#475569}
.chip-p0{color:#dc2626;font-weight:600}
.chip-p1{color:#d97706;font-weight:600}
.chip-p2{color:#2563eb}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
th,td{padding:10px 12px;text-align:left;font-size:13px;border-bottom:1px solid #f1f5f9}
th{background:#f1f5f9;color:#475569;font-weight:600}
.overdue{color:#dc2626;font-weight:700}
.mod{background:#fff;border-radius:10px;padding:12px 16px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
</style>
</head>
<body>
<h1>📋 SpecTaskChain 批次看板</h1>
<div class="sub">${batch && batch !== 'all' ? `批次 <b>${esc(batch)}</b> · ` : ''}队列：${esc(cfg.queueDir)} · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
<div class="scards">${statCards}</div>
<div class="bar"><div class="fill" style="width:${pct}%"></div></div>
<div class="pct">${done.length} / ${sequence.length} 完成（${pct}%）</div>
<div class="ledger">⏱ 工时对账：预估合计 <b>${estSum || 0}h</b> · 实际登记 <b>${spentSum}h</b>（${spentTasks.length} 个任务有账）${estSum && spentSum ? ` · 偏差 ${Math.round((spentSum - estSum) * 10) / 10}h` : ''}</div>
${typeCards ? `<h2>任务类型分布</h2><div class="tgrid">${typeCards}</div>` : ''}
${prioChips ? `<h2>优先级分布</h2><div>${prioChips}</div>` : ''}
${moduleBlocks ? `<h2>任务模块</h2>${moduleBlocks}` : ''}
<h2>任务清单</h2>
<table>
<thead><tr><th></th><th>任务</th><th>类型</th><th>状态</th><th>优先级</th><th>预估</th><th>实际</th><th>截止</th><th>目标</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
  // 落盘：按批次命名可并存——dashboard-{批次}.html / --batch all 落 dashboard-all.html；PANEL.html 保留为「最新批次」快捷入口（meta refresh 指向，双击即达）
  const resolvedBatch = batch && batch !== 'all' ? batch : resolveDefaultBatch(cfg, queue.batches) || latestBatchId(queue.batches);
  const fname = batch === 'all' ? 'dashboard-all.html' : `dashboard-${resolvedBatch || 'all'}.html`;
  const reportsDir = join(cfg.queueDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const panelPath = join(reportsDir, fname);
  writeFileSync(panelPath, html, 'utf-8');
  // 缺省（未显式 --batch）时同步刷新 PANEL.html 快捷入口：永远指向最新批次看板
  if (!batch) {
    writeFileSync(
      join(reportsDir, 'PANEL.html'),
      `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta http-equiv="refresh" content="0; url=${fname}">\n<title>SpecTaskChain 批次看板</title>\n</head>\n<body style="font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 48px; color: #334155;">\n<p>正在打开最新批次看板……若未自动跳转，<a href="${fname}">点此打开 ${fname}</a></p>\n</body>\n</html>\n`,
      'utf-8'
    );
  }
  return panelPath;
}
