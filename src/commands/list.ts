// taskq list：队列清单——有哪些批次、批次内有哪些任务、各自状态与元数据
// 筛选三扇窗：--batch 聚焦批次 / --status 按状态 / --type 按类型（AND 组合，业务挑任务的视角）
import { TaskQConfig, readState } from '../core/config';
import { scanQueue, resolveDefaultBatch } from '../core/queue';
import { TaskSpec, daysOverdue } from '../core/task-spec';

export interface ListOptions {
  batch?: string;  // 聚焦批次（batch-NNN / tasks / all；缺省 = 全批次展示）
  status?: string; // 按状态筛选（todo/doing/done/failed/draft）
  type?: string;   // 按类型筛选（doc/script/data…）
}

/** 任务行徽章：优先级 ⚑P1 / 预估 ⏱4h / 实耗 🕐6h / 截止 📅11-05（逾期 🔴晚N天；有才显示，不添噪） */
function badges(t: TaskSpec, s?: ReturnType<typeof readState>[string]): string {
  const parts: string[] = [];
  if (t.priority) parts.push(`⚑${t.priority}`);
  if (t.estimate !== undefined) parts.push(`⏱${t.estimate}h`);
  if (s?.spent !== undefined) parts.push(`🕐${s.spent}h`);
  if (t.due) {
    const days = daysOverdue(t.due);
    if (days !== null) parts.push(days > 0 ? `🔴晚${days}天` : `📅${t.due.slice(5)}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function listCommand(cfg: TaskQConfig, opts: ListOptions = {}): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const state = readState(cfg);
  if (!queue.tasks.length && !queue.modules.length) {
    return '队列还是空的。先建任务：taskq new "任务描述"';
  }
  // 批次聚焦（不存在报错，与 new/run 口径一致）
  let batches = queue.batches;
  if (opts.batch && opts.batch !== 'all') {
    batches = queue.batches.filter((b) => b.id === opts.batch);
    if (!batches.length) {
      return `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、')}`;
    }
  }
  // 状态/类型筛选（AND 组合）
  const match = (t: TaskSpec): boolean => {
    if (opts.status && (state[t.id]?.status || 'todo') !== opts.status) return false;
    if (opts.type && t.type !== opts.type) return false;
    return true;
  };
  const lines: string[] = ['队列清单：'];
  // 「当前批次」注释挂默认批次：最近使用（state 记忆）> 最新——与新任务落点、run 默认跑哪里同口径
  const defaultB = resolveDefaultBatch(cfg, queue.batches);
  let hitCount = 0;
  let total = 0;
  for (const b of batches) {
    const batchTitle = `📦 批次 ${b.id}${b.name ? `「${b.name}」` : ''}${b.id === defaultB ? ' ← 当前批次（新任务落这里，run 默认跑这里）' : ''}`;
    const batchLines: string[] = [];
    for (const t of b.tasks) {
      total++;
      if (!match(t)) continue;
      hitCount++;
      const s = state[t.id];
      const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
      const shown = t.name ? `「${t.name}」` : '';
      batchLines.push(`  ${icon} ${t.id}${shown} [${t.type}]${badges(t, s)} ${t.goal.slice(0, 40)}`);
    }
    for (const m of b.modules) {
      const subLines: string[] = [];
      for (const sub of m.subtasks) {
        total++;
        if (!match(sub)) continue;
        hitCount++;
        const s = state[sub.id];
        const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
        const shown = sub.name ? `「${sub.name}」` : '';
        subLines.push(`      ${icon} ${sub.id}${shown} [${sub.type}]${badges(sub, s)} ${sub.goal.slice(0, 36)}`);
      }
      if (subLines.length) {
        const modLabel = m.name ? `${m.id}「${m.name}」` : m.id;
        batchLines.push(`  📦 ${modLabel}（任务模块，共享 spec）`);
        batchLines.push(...subLines);
      }
    }
    if (batchLines.length) {
      lines.push('');
      lines.push(batchTitle);
      if (b.purpose) lines.push(`   ${b.purpose}`);
      lines.push(...batchLines);
    }
  }
  if (!hitCount) {
    const cond = [
      opts.batch && opts.batch !== 'all' ? `批次=${opts.batch}` : '',
      opts.status ? `状态=${opts.status}` : '',
      opts.type ? `类型=${opts.type}` : '',
    ].filter(Boolean).join('、');
    lines.push('');
    lines.push(`筛选无结果（${cond}）：${total} 个任务中无一命中。换个条件，或 taskq list 看全貌。`);
  }
  return lines.join('\n');
}
