// taskq done：验收登记——机器跑产物/断言门禁，宿主 AI 传评审结论
// 验收三态：产物门禁（文件存在非空）+ 断言门禁（shell 退出码）+ 评审门禁（AI 审查）
import { TaskQConfig, readState } from '../core/config';
import { scanQueue } from '../core/queue';
import { runAcceptance, renderAcceptanceResult } from '../core/acceptance';
import { markTaskState, MAX_ATTEMPTS } from '../core/runner';
import { generateQueueReport } from '../core/report';

export interface DoneOptions {
  taskId: string;
  verdict?: string; // 评审结论（pass / fail + 描述）
}

export function doneCommand(cfg: TaskQConfig, opts: DoneOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const all = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
  const task = all.find((t) => t.id === opts.taskId);
  if (!task) {
    return `❌ 未找到任务「${opts.taskId}」。可用：taskq list 查看队列清单。`;
  }
  // 验收门禁基准 = 项目根（output 是用户视角路径，AI 也在项目根干活）
  const result = runAcceptance(task.acceptance, cfg.projectRoot, opts.verdict);
  const rendered = renderAcceptanceResult(result);
  if (result.passed) {
    markTaskState(cfg, task.id, 'done', opts.verdict || 'pass');
    return `${rendered}\n\n✅ 「${task.id}」已登记完成。继续接力：taskq run`;
  }
  const state = readState(cfg);
  const prev = state[task.id];
  const attempts = (prev?.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    markTaskState(cfg, task.id, 'failed', opts.verdict || 'fail');
    return `${rendered}\n\n⛔ 已达尝试上限（${MAX_ATTEMPTS} 次），任务标记 failed 停止接力。修好规格/产出后：taskq run 会重新拾起（人工介入后可用 --reset 重置状态）。`;
  }
  markTaskState(cfg, task.id, 'failed', opts.verdict || 'fail');
  return `${rendered}\n\n❌ 验收未通过（第 ${attempts}/${MAX_ATTEMPTS} 次尝试）。修正产出后重试：taskq done ${task.id} --verdict "..."`;
}
