// taskq status：队列总览 + HTML 可视化面板
import { TaskQConfig } from '../core/config';
import { queueSummary } from '../core/runner';
import { generatePanelHtml } from '../core/panel';

export function statusCommand(cfg: TaskQConfig, opts: { panel?: boolean; batch?: string }): string {
  const summary = queueSummary(cfg, { batch: opts.batch });
  if (opts.panel) {
    const panelPath = generatePanelHtml(cfg);
    return `${summary}\n\n📊 可视化面板已生成：${panelPath}`;
  }
  return summary;
}
