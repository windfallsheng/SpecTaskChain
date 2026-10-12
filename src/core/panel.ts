// HTML 可视化面板：单文件，打开即看——队列总览、进度条、状态矩阵
import { writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, readState } from './config';
import { scanQueue, buildExecutionSequence } from './queue';

export function generatePanelHtml(cfg: TaskQConfig): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const sequence = buildExecutionSequence(queue);
  const state = readState(cfg);
  const doneCount = sequence.filter((e) => state[e.spec.id]?.status === 'done').length;
  const pct = sequence.length ? Math.round((doneCount / sequence.length) * 100) : 0;
  const rows = sequence.map((e) => {
    const s = state[e.spec.id];
    const status = s?.status || 'todo';
    const color = status === 'done' ? '#22c55e' : status === 'failed' ? '#ef4444' : status === 'doing' ? '#3b82f6' : '#94a3b8';
    const icon = status === 'done' ? '✅' : status === 'failed' ? '⛔' : status === 'doing' ? '▶' : '⏳';
    return `<tr><td>${icon}</td><td>${e.spec.id}</td><td>${e.spec.type}</td><td style="color:${color};font-weight:600">${status}</td><td>${s?.attempts || 0}</td><td>${e.spec.goal.slice(0, 40)}</td></tr>`;
  }).join('');
  const moduleBlocks = queue.modules.map((m) => {
    const doneSubs = m.subtasks.filter((s) => state[s.id]?.status === 'done').length;
    return `<div class="mod"><b>${m.id}</b>（共享约束 ${m.constraints.trim() ? '已挂' : '未挂'}）子任务 ${doneSubs}/${m.subtasks.length} 完成</div>`;
  }).join('');
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecTaskChain 队列面板</title>
<style>
body{font-family:'PingFang SC','Hiragino Sans GB',sans-serif;margin:40px auto;max-width:860px;padding:0 20px;color:#1e293b;background:#f8fafc}
h1{font-size:26px;margin-bottom:4px}
.sub{color:#64748b;font-size:13px;margin-bottom:20px}
.bar{height:14px;background:#e2e8f0;border-radius:7px;overflow:hidden;margin-bottom:8px}
.fill{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:7px;transition:width .4s}
.pct{font-weight:700;color:#1e293b;margin-bottom:24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
th,td{padding:10px 12px;text-align:left;font-size:14px;border-bottom:1px solid #f1f5f9}
th{background:#f1f5f9;color:#475569;font-weight:600}
.mod{background:#fff;border-radius:10px;padding:12px 16px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
h2{margin-top:28px;font-size:18px}
</style>
</head>
<body>
<h1>📋 SpecTaskChain 队列面板</h1>
<div class="sub">队列：${cfg.queueDir} · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
<div class="bar"><div class="fill" style="width:${pct}%"></div></div>
<div class="pct">${doneCount} / ${sequence.length} 完成（${pct}%）</div>
${moduleBlocks ? `<h2>任务模块</h2>${moduleBlocks}` : ''}
<h2>任务清单</h2>
<table>
<thead><tr><th></th><th>任务</th><th>类型</th><th>状态</th><th>尝试</th><th>目标</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
  writeFileSync(join(cfg.queueDir, 'PANEL.html'), html, 'utf-8');
  return join(cfg.queueDir, 'PANEL.html');
}
