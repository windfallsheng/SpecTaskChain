// taskq reset：重跑复位——状态回 todo + attempts 清零。软复位留痕保留（重跑=基于现有内容调整补充），
// --hard 连 PROGRESS.md 留痕清空（重跑=从头再来）。产物文件两种模式都不删（成果由你定夺，重跑时按规格自然覆盖）
import { TaskQConfig, readState, writeState } from '../core/config';
import { scanQueue, selectBatch, QueueScan } from '../core/queue';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface ResetOptions {
  hard?: boolean; // 连留痕 PROGRESS.md 一起清空
}

/** 拉平任务（顶层 + 模块子任务）为 { id, dir } */
function flatTasks(q: QueueScan): { id: string; dir: string }[] {
  return [
    ...q.tasks.map((t) => ({ id: t.id, dir: t.dir })),
    ...q.modules.flatMap((m) => m.subtasks.map((s) => ({ id: s.id, dir: s.dir }))),
  ];
}

/**
 * 复位目标解析：
 * - --all / all → 全队列
 * - batch-NNN → 该批次
 * - 任务 ID → 单任务（顶层或模块子任务）
 * - 模块名 → 模块全部子任务
 */
export function resetCommand(cfg: TaskQConfig, target: string, opts: ResetOptions = {}): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const isAll = target === '--all' || target === 'all';

  let targets: { id: string; dir: string }[] = [];
  let scopeHint: string; // 复位后接力命令提示

  if (isAll) {
    targets = flatTasks(queue);
    scopeHint = '';
  } else if (/^batch-/i.test(target)) {
    const view = selectBatch(queue, target);
    if (!view) {
      return `❌ 批次「${target}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、') || '无（队列为空）'}`;
    }
    targets = flatTasks(view);
    scopeHint = ` --batch ${target}`;
  } else {
    const byTask = flatTasks(queue).filter((t) => t.id === target);
    if (byTask.length > 0) {
      targets = byTask;
      scopeHint = ` --task ${target}`;
    } else {
      const mod = queue.modules.find((m) => m.id === target);
      if (!mod) {
        return `❌ 找不到任务或模块「${target}」。用 taskq list 查 ID（任务如 34-cshidaima，模块如 module-yingxiaomokuai）`;
      }
      targets = mod.subtasks.map((s) => ({ id: s.id, dir: s.dir }));
      scopeHint = ` --module ${target}`;
    }
  }

  if (targets.length === 0) {
    return '⚠️ 目标下没有任务，无需复位。';
  }

  const state = readState(cfg);
  let cleared = 0;
  for (const t of targets) {
    state[t.id] = { status: 'todo', attempts: 0 };
    if (opts.hard) {
      const progressPath = join(t.dir, 'PROGRESS.md');
      if (existsSync(progressPath)) {
        unlinkSync(progressPath);
        cleared++;
      }
    }
  }
  writeState(cfg, state);

  const hardNote = opts.hard
    ? `（留痕 PROGRESS.md 已清 ${cleared} 个，重跑 = 从头再来）`
    : '（留痕保留，重跑 = 基于现有内容调整补充）';
  return [
    `✅ 已复位 ${targets.length} 个任务至 todo${hardNote}`,
    '',
    `接着跑：taskq run${scopeHint}`,
  ].join('\n');
}
