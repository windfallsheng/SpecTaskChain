// taskq clarify：随叫随到的体检——用户自己的操作行为，系统只提供入口、检测和报告，从不打断
// 四入口：写完查（--task/--file）/ 建链前查（--chain 链级体检）/ 翻车时查（无参数整队查）/ 随口查（taskq ask 路由）
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { TaskQConfig } from '../core/config';
import { scanQueue, latestBatchId } from '../core/queue';
import { readSpec, parseFrontmatter, buildSpec } from '../core/task-spec';
import { resolveTaskType } from '../core/task-type';
import { readBatchConfig } from '../core/batch-config';
import { buildClarifyAssessment, dispatchAssessment, assessmentNotice, resolveReportSwitch } from '../core/assessment';
import { computeFixes } from '../core/fixer';
import { readLineSync } from './fix';
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
  noReport?: boolean;   // 报告开关（临时）：当次不生成评估报告
  forceReport?: boolean; // 报告开关（临时）：当次强制生成（覆盖批次配置 reports: false）
  decide?: boolean;     // 判断题通道：exec 档逐项裁决（y 采纳 / n 换方案 / s 跳过），采纳写回 SPEC.md decisions 留痕
}

/**
 * 决策留痕：向 SPEC.md frontmatter 追加 decisions 条目（只改 frontmatter，正文一字不碰）
 * 幂等：同一条目已存在则不重复写；覆盖前原文件归档到任务目录 sources/（与 fix 同手法）
 */
export function applyDecision(specPath: string, decision: string): boolean {
  if (!existsSync(specPath)) return false;
  const original = readFileSync(specPath, 'utf-8');
  const text = original.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return false;
  const esc = decision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^\\s*-\\s*${esc}\\s*$`, 'm').test(m[1])) return false;
  const lines = m[1].split('\n');
  const idx = lines.findIndex((l) => /^decisions:\s*$/.test(l));
  if (idx === -1) {
    lines.push('decisions:', `  - ${decision}`); // frontmatter 末尾追加（保证在 --- 之前）
  } else {
    let last = idx;
    for (let j = idx + 1; j < lines.length; j++) {
      if (/^\s+-\s/.test(lines[j])) last = j;
      else break;
    }
    lines.splice(last + 1, 0, `  - ${decision}`); // decisions 列表末尾追加
  }
  const next = text.replace(m[1], lines.join('\n'));
  try {
    const archiveDir = join(dirname(specPath), 'sources');
    mkdirSync(archiveDir, { recursive: true });
    copyFileSync(specPath, join(archiveDir, 'SPEC.md'));
  } catch {
    // 归档失败不阻断决策留痕（sources/ 是用户可见存档，不是主流程）
  }
  writeFileSync(specPath, next, 'utf-8');
  return true;
}

export function clarifyCommand(cfg: TaskQConfig, opts: ClarifyOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  let issues: ClarifyIssue[] = [];
  let clarifyNotice = ''; // 全量体检触发澄清评估报告（后台生成）时的可见提示，随终端输出末尾附带
  let fixHint = ''; // A 档机械修复提示（补 output/acceptance/role/摘 draft）：taskq fix 一处搞定

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
    // 单任务体检后顺手亮修复提示（A 档机械修）
    const fixable = computeFixes(found, resolveTaskType(cfg.metaDir, found.type)).length;
    fixHint = fixable ? `🔧 可自动修复 ${fixable} 处：taskq fix --task ${found.id}（--yes 应用 / --dry-run 预览）` : '';
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
    // 报告开关四级链：CLI 临时（--no-report/--report）> 任务级（SPEC.md reports: false 筛掉）> 批次级（config/BATCH.yaml reports）> 系统默认（生成）
    const batchId = latestBatchId(queue.batches) || 'tasks';
    const allTasks = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
    const reportable = allTasks.filter((t) => t.reports !== false);
    const batchCfg = readBatchConfig(join(cfg.queueDir, batchId));
    const sw = resolveReportSwitch(batchCfg, opts);
    if (!reportable.length) {
      clarifyNotice = '📄 评估报告已跳过：全部任务 SPEC.md 设了 reports: false（删掉该行即恢复参与）';
    } else if (!sw.enabled) {
      clarifyNotice = `📄 评估报告已跳过：${sw.reason}`;
    } else {
      const report = buildClarifyAssessment(batchId, reportable, issues);
      dispatchAssessment(cfg, report);
      clarifyNotice = assessmentNotice(cfg.queueDir, report);
    }
    // 全量体检后亮修复提示（A 档机械修）
    const fixable = allTasks.reduce((n, t) => n + computeFixes(t, resolveTaskType(cfg.metaDir, t.type)).length, 0);
    fixHint = fixable ? `🔧 可自动修复 ${fixable} 处：taskq fix（--yes 应用 / --dry-run 预览）` : '';
  }

  // --decide 判断题通道：exec 档逐项裁决（y 采纳当前推荐 / n 换下一个方案 / s 跳过）
  // 采纳即写回任务 SPEC.md frontmatter decisions（「风险标签→方案名」）留痕，下次体检跳过已决信号
  if (opts.decide) {
    const candidates = issues.filter((i) => i.level === 'exec' && i.options && i.options.length);
    // 写回目标：任务级 exec issue 写任务 SPEC.md；模块级（CONSTRAINTS.md 无 frontmatter）只提示不落盘
    const specByTask = new Map<string, { specPath: string; refused: boolean }>();
    for (const t of [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)]) {
      specByTask.set(t.id, { specPath: join(t.dir, 'SPEC.md'), refused: t.overwrite === false });
    }
    if (opts.file) {
      // 手动写场景：文件可能不在队列里，单独登记（覆盖开关读文件 frontmatter）
      const resolved = opts.file.endsWith('.md') ? opts.file : join(opts.file, 'SPEC.md');
      if (existsSync(resolved)) {
        const { data } = parseFrontmatter(readFileSync(resolved, 'utf-8'));
        specByTask.set(taskIdFromPath(resolved) || '此文件', {
          specPath: resolved,
          refused: data.overwrite === false || data.overwrite === 'false',
        });
      }
    }
    const decidable = candidates.filter((i) => specByTask.has(i.taskId));
    const moduleScoped = candidates.filter((i) => !specByTask.has(i.taskId));
    const others = issues.length - candidates.length;
    if (!decidable.length) {
      const base = moduleScoped.length
        ? `⚠️ 可执行性风险来自模块公共约束（CONSTRAINTS.md 无 frontmatter 留痕位）：${moduleScoped.map((i) => i.taskId).join('、')}——直接改写约束文本即可。`
        : '✅ 没有待裁决的可执行性风险。';
      return `${base}${others ? `\n（另有 ${others} 条其他档位条目，完整体检：taskq clarify）` : ''}`;
    }
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    if (!isTTY) {
      return `${renderClarifyReport(issues)}\n\n🤖 判断题通道需要交互终端：请在本机终端跑 taskq clarify --task <任务ID> --decide（y 采纳 / n 换方案 / s 跳过）。`;
    }
    const applied: string[] = [];
    const noted: string[] = []; // overwrite: false 任务：采纳仅提示不落盘（与 fix 覆盖开关同哲学）
    for (const i of decidable) {
      const opts = [...i.options!].sort((a, b) => (b.score || 0) - (a.score || 0));
      let cur = 0;
      let settled = false;
      while (!settled) {
        const o = opts[cur % opts.length];
        const whoIcon = o.who === 'ai' ? '🤖' : o.who === 'human' ? '👤' : '🤝';
        console.log(`\n[${i.taskId}] ${i.message}`);
        console.log(`  当前方案${o.recommended ? ' ✅ 推荐' : ''}：${whoIcon} ${o.title}${o.score !== undefined ? ` ${o.score}/10` : ''}：${o.how}${o.recommended && o.reason ? `\n  推荐理由：${o.reason}` : ''}`);
        const a = readLineSync('  裁决 [y=采纳 / n=换下一个方案 / s=跳过此项] ').toLowerCase();
        if (a === 'y') {
          const meta = specByTask.get(i.taskId)!;
          const label = i.message.match(/可执行性风险（([^）]+)）/)?.[1] || i.taskId; // TS7 扫描器缺陷：全角括号正则+外层括号+可选链组合报 TS1005，去掉外层括号规避
          const decision = `${label}→${o.title}`;
          if (meta.refused) {
            noted.push(`${i.taskId}：${decision}`); // SPEC.md overwrite: false：仅提示不落盘
          } else {
            if (applyDecision(meta.specPath, decision)) applied.push(`${i.taskId}：${decision}`);
          }
          settled = true;
        } else if (a === 'n') {
          cur += 1; // 换下一个方案（循环回到推荐）
        } else {
          settled = true; // s / 回车 / 其他输入：跳过此项
        }
      }
    }
    const parts: string[] = [];
    if (applied.length) parts.push(`✅ 已采纳 ${applied.length} 条决策，写回 SPEC.md decisions（覆盖前原文件已归档 sources/）：\n${applied.map((d) => `  · ${d}`).join('\n')}\n\n重新体检确认：taskq clarify`);
    if (noted.length) parts.push(`⏸ ${noted.length} 条采纳但未落盘（SPEC.md overwrite: false，与 fix 覆盖开关同哲学）：${noted.map((d) => `  · ${d}`).join('、')}`);
    if (moduleScoped.length) parts.push(`⚠️ ${moduleScoped.length} 条可执行性风险来自模块公共约束（无 frontmatter 留痕位）：${moduleScoped.map((i) => i.taskId).join('、')}——直接改写 CONSTRAINTS.md 文本即可`);
    if (!parts.length) parts.push('未采纳任何方案（全部跳过）。');
    if (others) parts.push(`另有 ${others} 条其他档位条目，完整体检：taskq clarify`);
    return parts.join('\n\n');
  }

  // --html：体检报告可视化（三档红黄灰分组卡片）；终端文本照旧可读
  if (opts.html) {
    const htmlPath = join(cfg.queueDir, 'CLARIFY.html');
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, renderClarifyHtml(issues), 'utf-8');
    const head = renderClarifyReport(issues).split('\n').slice(0, 6).join('\n');
    return `🩺 体检报告已生成：${htmlPath}\n\n${head}\n...${clarifyNotice ? `\n\n${clarifyNotice}` : ''}${fixHint ? `\n\n${fixHint}` : ''}`;
  }
  const tail = [clarifyNotice, fixHint].filter(Boolean).join('\n\n');
  return tail ? `${renderClarifyReport(issues)}\n\n${tail}` : renderClarifyReport(issues);
}
