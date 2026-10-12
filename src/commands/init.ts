// taskq init：初始化队列骨架（幂等）
import { resolveConfig, ensureStructure } from '../core/config';

export function initCommand(cwd: string): string {
  const cfg = resolveConfig(cwd);
  ensureStructure(cfg);
  const lines = [
    '✅ 队列骨架已就绪（SpecTaskChain）',
    '',
    `  队列目录：${cfg.queueDir}`,
    '    tasks/                  ← 任务平铺（SPEC.md 三必填 + 正文自由）',
    '    .taskchain/state.json   ← 状态文件（断点续跑）',
    '    .taskchain/TASK_TYPES/  ← 自定义任务类型定义',
    '',
    '下一步：',
    '  taskq new "给三个仓库写迁移文档"   ← 对话成规格（AI 生成草案，你确认）',
    '  taskq clarify                        ← 随叫随到的体检（写完查一查）',
    '  taskq run                            ← 无人值守接力执行',
    '',
    'Chain = 接力（relay），不是依赖（dependency）。',
  ];
  return lines.join('\n');
}
