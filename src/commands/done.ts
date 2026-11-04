// taskq done：验收登记——机器跑产物/断言门禁，宿主 AI 传评审结论
// 验收三态：产物门禁（文件存在非空）+ 断言门禁（shell 退出码）+ 评审门禁（AI 审查）
import { TaskQConfig, readState, writeLastUsedBatch } from '../core/config';
import { appendOpLog } from '../core/oplog';
import { scanQueue } from '../core/queue';
import { runAcceptance, renderAcceptanceResult } from '../core/acceptance';
import { markTaskState } from '../core/runner';
import { locateBatchConfig } from '../core/batch-config';
import { relative, sep } from 'path';
import { generateQueueReport } from '../core/report';

export interface DoneOptions {
  taskId: string;
  verdict?: string; // 评审结论（pass / fail + 描述）
  spent?: number;   // 实际工时（小时；登记进 state，报告算预估 vs 实际偏差）
}

export function doneCommand(cfg: TaskQConfig, opts: DoneOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const all = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
  const task = all.find((t) => t.id === opts.taskId);
  if (!task) {
    return `❌ 未找到任务「${opts.taskId}」。可用：taskq list 查看队列清单。`;
  }
  // 批次 ID：task.dir 相对队列目录的第一段（模块子任务目录上溯同样命中）
  const batchId = relative(cfg.queueDir, task.dir).split(sep)[0];
  // 验收门禁基准 = 项目根（output 是用户视角路径，AI 也在项目根干活）
  const result = runAcceptance(task.acceptance, cfg.projectRoot, opts.verdict);
  const rendered = renderAcceptanceResult(result);
  if (result.passed) {
    markTaskState(cfg, task.id, 'done', opts.verdict || 'pass', opts.spent);
    // 最近使用批次记忆：验收通过即认领 + 操作轨迹留痕
    writeLastUsedBatch(cfg, batchId);
    appendOpLog(cfg, { cmd: 'done', target: task.id, batch: batchId, note: `验收通过${opts.spent !== undefined ? `，实际工时 ${opts.spent}h` : ''}` });
    return `${rendered}\n\n✅ 「${task.id}」已登记完成${opts.spent !== undefined ? `（实际工时 ${opts.spent}h）` : ''}。继续接力：taskq run`;
  }
  const state = readState(cfg);
  const prev = state[task.id];
  // 尝试上限优先级链：任务所在批次的 BATCH.yaml max-attempts > 系统默认（向上爬升找批次配置）
  const maxAttempts = locateBatchConfig(task.dir, cfg.queueDir)['max-attempts'];
  const attempts = (prev?.attempts || 0) + 1;
  if (attempts >= maxAttempts) {
    markTaskState(cfg, task.id, 'failed', opts.verdict || 'fail');
    appendOpLog(cfg, { cmd: 'done', target: task.id, batch: batchId, note: `验收未通过（达上限 ${maxAttempts} 次），标记 failed` });
    return `${rendered}\n\n⛔ 已达尝试上限（${maxAttempts} 次），任务标记 failed 停止接力。人工介入：修好规格/产出后重试 \`taskq done ${task.id} --verdict "..."\` 重新验收；如需整单重跑，手动把 queue/.taskchain/state.json 中该任务状态改为 todo。`;
  }
  markTaskState(cfg, task.id, 'failed', opts.verdict || 'fail');
  appendOpLog(cfg, { cmd: 'done', target: task.id, batch: batchId, note: '验收未通过' });
  return `${rendered}\n\n❌ 验收未通过（第 ${attempts}/${maxAttempts} 次尝试）。修正产出后重试：taskq done ${task.id} --verdict "..."`;
}
