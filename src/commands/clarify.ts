// taskq clarify：随叫随到的体检——用户自己的操作行为，系统只提供入口、检测和报告，从不打断
// 四入口：写完查（--task/--file）/ 建链前查（无参数整队查）/ 翻车时查（--task 重跑）/ 随口查（taskq ask 路由）
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { scanQueue } from '../core/queue';
import { readSpec, parseFrontmatter, buildSpec } from '../core/task-spec';
import {
  detectTaskIssues,
  detectDanglingDeps,
  detectOutputConflicts,
  renderClarifyReport,
  ClarifyIssue,
} from '../core/clarify';

export interface ClarifyOptions {
  taskId?: string;  // 单任务（按 ID）
  file?: string;    // 直接指文件（手动写场景：宿主 AI 消解「上面的内容」后传入）
  chain?: boolean;  // 建链前查：整队体检（依赖悬空 + 产出冲突 + 各任务三必填）
}

/** 从文件路径找任务 ID（宿主 AI 消解「上面」后传入的就是这里） */
function taskIdFromFile(file: string): string | null {
  const parts = file.split('/');
  const idx = parts.lastIndexOf('SPEC.md');
  if (idx > 0) return parts[idx - 1];
  // 指向任务目录的情况
  if (parts[parts.length - 1] !== 'SPEC.md') return parts[parts.length - 1];
  return null;
}

export function clarifyCommand(cfg: TaskQConfig, opts: ClarifyOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  let issues: ClarifyIssue[] = [];

  if (opts.file) {
    // 手动写场景：直接指文件（「澄清当前文件」——编辑器焦点由宿主/编辑器传入）
    const resolved = opts.file.endsWith('.md') ? opts.file : join(opts.file, 'SPEC.md');
    if (!existsSync(resolved)) {
      return `❌ 文件不存在：${resolved}\n\n手动写场景指代来源（从强到弱）：\n  1. 显式路径（最可靠）：taskq clarify --file tasks/01-xxx/SPEC.md\n  2. 编辑器焦点（IDE 集成后）：当前打开的文件自动传入\n  3. 问一句（最诚实）：候选不唯一时我们宁可问，不可猜`;
    }
    const content = readFileSync(resolved, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    const id = taskIdFromFile(resolved) || '此文件';
    const spec = buildSpec(id, resolved, data, body, 'general');
    issues = detectTaskIssues(spec);
    return renderClarifyReport(issues);
  }

  if (opts.taskId) {
    // 单任务体检（写完即查 / 翻车后查）
    const all = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
    const found = all.find((t) => t.id === opts.taskId);
    if (!found) {
      return `❌ 未找到任务「${opts.taskId}」。可用：taskq list 查看队列清单。`;
    }
    issues = detectTaskIssues(found);
    return renderClarifyReport(issues);
  }

  // 建链前查（无参数）：整队体检——只查链执行必翻车的硬伤
  issues = [...detectDanglingDeps(queue), ...detectOutputConflicts(queue)];
  for (const t of queue.tasks) issues.push(...detectTaskIssues(t));
  for (const m of queue.modules) {
    for (const s of m.subtasks) issues.push(...detectTaskIssues(s));
    if (!m.constraints.trim()) {
      issues.push({ level: 'pending', taskId: m.id, message: '任务模块未挂公共约束（CONSTRAINTS.md 为空）——共享 spec 院落没有内容' });
    }
  }
  const report = renderClarifyReport(issues);
  if (!queue.tasks.length && !queue.modules.length) {
    return '队列还是空的。先建任务：taskq new "任务描述"';
  }
  return report;
}
