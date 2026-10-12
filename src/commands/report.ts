// taskq report：队列报告——执行留痕，队列跑完「有账可查、可复盘、可追责」
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { generateQueueReport } from '../core/report';

export function reportCommand(cfg: TaskQConfig): string {
  const report = generateQueueReport(cfg);
  return `✅ 队列报告已生成：${join(cfg.queueDir, 'QUEUE_REPORT.md')}\n\n${report.split('\n').slice(0, 8).join('\n')}\n...`;
}
