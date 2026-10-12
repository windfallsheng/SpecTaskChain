// taskq list：队列清单——有哪些任务、各自状态
import { TaskQConfig, readState } from '../core/config';
import { scanQueue } from '../core/queue';

export function listCommand(cfg: TaskQConfig): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const state = readState(cfg);
  const lines: string[] = [];
  if (!queue.tasks.length && !queue.modules.length) {
    return '队列还是空的。先建任务：taskq new "任务描述"';
  }
  lines.push('队列清单：');
  lines.push('');
  for (const t of queue.tasks) {
    const s = state[t.id];
    const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
    const shown = t.name ? `「${t.name}」` : '';
    lines.push(`  ${icon} ${t.id}${shown} [${t.type}] ${t.goal.slice(0, 40)}`);
  }
  for (const m of queue.modules) {
    lines.push(`  📦 ${m.id}（任务模块，共享 spec）`);
    for (const sub of m.subtasks) {
      const s = state[sub.id];
      const icon = s?.status === 'done' ? '✅' : s?.status === 'failed' ? '⛔' : s?.status === 'doing' ? '▶' : '⏳';
      const shown = sub.name ? `「${sub.name}」` : '';
      lines.push(`      ${icon} ${sub.id}${shown} [${sub.type}] ${sub.goal.slice(0, 36)}`);
    }
  }
  return lines.join('\n');
}
