// taskq clarify：随叫随到的体检——用户自己的操作行为，系统只提供入口、检测和报告，从不打断
// 四入口：写完查（--task/--file）/ 建链前查（--chain 链级体检）/ 翻车时查（无参数整队查）/ 随口查（taskq ask 路由）
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { TaskQConfig } from '../core/config';
import { scanQueue, latestBatchId } from '../core/queue';
import { readSpec, parseFrontmatter, buildSpec } from '../core/task-spec';
import { buildClarifyAssessment, dispatchAssessment, assessmentNotice } from '../core/assessment';
import {
  detectTaskIssues,
  detectChainIssues,
  renderClarifyReport,
  renderClarifyHtml,
  taskIdFromPath,
  ClarifyIssue,
} from '../core/clarify';

export interface ClarifyOptions {
  taskId?: string;  // 单任务（按 ID）
  file?: string;    // 直接指文件（手动写场景：宿主 AI 消解「上面的内容」后传入）
  chain?: boolean;  // 建链前查：只查链级硬伤（依赖悬空/产出冲突/模块约束/命名重复/循环依赖），不逐任务三必填
  html?: boolean;   // 体检报告 HTML 化（queue/CLARIFY.html，三档红黄灰分组）
}

export function clarifyCommand(cfg: TaskQConfig, opts: ClarifyOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  let issues: ClarifyIssue[] = [];
  let clarifyNotice = ''; // 全量体检触发澄清评估报告（后台生成）时的可见提示，随终端输出末尾附带

  if (opts.file) {
    // 手动写场景：直接指文件（「澄清当前文件」——编辑器焦点由宿主/编辑器传入）
    const resolved = opts.file.endsWith('.md') ? opts.file : join(opts.file, 'SPEC.md');
    if (!existsSync(resolved)) {
      return `❌ 文件不存在：${resolved}\n\n手动写场景指代来源（从强到弱）：\n  1. 显式路径（最可靠）：taskq clarify --file tasks/01-xxx/SPEC.md\n  2. 编辑器焦点（IDE 集成后）：当前打开的文件自动传入\n  3. 问一句（最诚实）：候选不唯一时我们宁可问，不可猜`;
    }
    const content = readFileSync(resolved, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    const id = taskIdFromPath(resolved) || '此文件';
    const spec = buildSpec(id, resolved, data, body, 'general');
    issues = detectTaskIssues(spec, cfg.projectRoot);
  } else if (opts.taskId) {
    // 单任务体检（写完即查 / 翻车后查）
    const all = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
    const found = all.find((t) => t.id === opts.taskId);
    if (!found) {
      return `❌ 未找到任务「${opts.taskId}」。可用：taskq list 查看队列清单。`;
    }
    issues = detectTaskIssues(found, cfg.projectRoot);
  } else if (opts.chain) {
    // 建链前查：只查链级硬伤（建链前逐任务可能还没写完，不报三必填）
    issues = detectChainIssues(queue);
  } else {
    // 翻车查（无参数）：链级硬伤 + 各任务三必填全量体检
    if (!queue.tasks.length && !queue.modules.length) {
      return '队列还是空的。先建任务：taskq new "任务描述"';
    }
    issues = [...detectChainIssues(queue)];
    for (const t of queue.tasks) issues.push(...detectTaskIssues(t, cfg.projectRoot));
    for (const m of queue.modules) {
      for (const s of m.subtasks) issues.push(...detectTaskIssues(s, cfg.projectRoot));
    }
    // 全量体检 → 澄清评估报告后台生成（不阻断终端输出）：每任务评估 + 总体评级，MD+HTML 落批次 overview/reports/
    const batchId = latestBatchId(queue.batches) || 'tasks';
    const allTasks = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
    const report = buildClarifyAssessment(batchId, allTasks, issues);
    dispatchAssessment(cfg, report);
    clarifyNotice = assessmentNotice(cfg.queueDir, report);
  }

  // --html：体检报告可视化（三档红黄灰分组卡片）；终端文本照旧可读
  if (opts.html) {
    const htmlPath = join(cfg.queueDir, 'CLARIFY.html');
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, renderClarifyHtml(issues), 'utf-8');
    const head = renderClarifyReport(issues).split('\n').slice(0, 6).join('\n');
    return `🩺 体检报告已生成：${htmlPath}\n\n${head}\n...${clarifyNotice ? `\n\n${clarifyNotice}` : ''}`;
  }
  return clarifyNotice ? `${renderClarifyReport(issues)}\n${clarifyNotice}` : renderClarifyReport(issues);
}
