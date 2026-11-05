// taskq status：队列总览 + HTML 可视化面板
import { TaskQConfig } from '../core/config';
import { queueSummary } from '../core/runner';
import { generatePanelHtml } from '../core/panel';

export function statusCommand(cfg: TaskQConfig, opts: { panel?: boolean; batch?: string }): string {
  const summary = queueSummary(cfg, { batch: opts.batch });
  if (opts.panel) {
    // 批次聚焦与终端摘要同源：--batch 点名老批次 / --batch all 全量 / 缺省最新批次
    const panelPath = generatePanelHtml(cfg, opts.batch);
    return `${summary}\n\n📊 批次看板已生成：${panelPath}`;
  }
  return summary;
}
