// taskq run：无人值守接力执行——做完一个接下一个，断点续跑，直到队列清空
import { TaskQConfig } from '../core/config';
import { relayNext, NextTaskInfo } from '../core/runner';

export interface RunOptions {
  skipDraft?: boolean; // 强跑 draft 任务
}

/** 渲染接力结果（CLI 输出文本；退出码由调用方传播：0 清空 / 10 接力 / 12 draft 拦截） */
export function renderRunResult(result: NextTaskInfo): string {
  if (result.exitCode === 0) {
    return result.summary;
  }
  if (result.exitCode === 12) {
    return result.summary;
  }
  // 接力模式：输出 prompt 块（宿主 AI 执行）
  return `${result.summary}\n\n[TASKQ_PROMPT]\n${result.prompt}\n[TASKQ_PROMPT_END]\n\n宿主 AI：执行上面的任务，完成后运行 \`taskq done ${result.task.spec.id} --verdict "pass 评审结论"\` 登记验收，再 \`taskq run\` 接力下一个。`;
}

export function runCommand(cfg: TaskQConfig, opts: RunOptions): string {
  return renderRunResult(relayNext(cfg, { skipDraft: opts.skipDraft }));
}
