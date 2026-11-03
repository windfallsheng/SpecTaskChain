// taskq report：队列报告——执行留痕，队列跑完「有账可查、可复盘、可追责」
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { generateQueueReport, generateReportHtml, ReportOptions } from '../core/report';

export function reportCommand(cfg: TaskQConfig, opts: ReportOptions & { html?: boolean } = {}): string {
  if (opts.html) {
    // --html：复盘报告可视化（状态分布条 + 执行记录 + 失败红卡），终端文本照旧
    const htmlPath = generateReportHtml(cfg, opts);
    if (htmlPath.startsWith('❌')) return htmlPath;
    return `📊 HTML 执行报告已生成：${htmlPath}\n\n双击打开即可看：状态分布 + 执行记录 + 失败红卡。`;
  }
  const report = generateQueueReport(cfg, opts);
  if (report.startsWith('❌')) return report;
  return `✅ 队列报告已生成：${join(cfg.queueDir, 'QUEUE_REPORT.md')}\n\n${report.split('\n').slice(0, 8).join('\n')}\n...`;
}
