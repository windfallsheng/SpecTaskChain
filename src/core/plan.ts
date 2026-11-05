// 执行计划：把隐式的拓扑顺序显性化——开局全景，用户可审、AI 可依
// 依赖排序的执行引擎（buildExecutionSequence）已有，本模块负责「说给人听」：顺序 / 依赖边 / 模块分组 / 关键路径
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ExecutableTask, QueueScan } from './queue';
import { TaskRunState } from './config';

/** 计划里的一条任务：身份 + 上下游 + 状态 */
export interface PlanEntry {
  id: string;
  goal: string;
  module?: string;        // 属于模块时挂模块 ID（模块子任务聚组）
  deps: string[];         // 声明依赖的上游（已过滤悬空）
  dependents: string[];   // 依赖我的下游（全队列反查）
  status: string;
}

export interface PlanModel {
  entries: PlanEntry[];
  depEdges: number;         // 有效依赖边数（悬空已由 clarify 报阻塞，这里只计有效）
  criticalPath: string[];   // 最长依赖链（任务数最多；并列取先出现）
  byModule: Map<string, PlanEntry[]>; // 模块分组视图（键 = module id 或 '（独立）'）
}

/** 从执行序列与状态账本构建计划模型（顺序已拓扑） */
export function buildPlanModel(sequence: ExecutableTask[], state: Record<string, TaskRunState>): PlanModel {
  const byId = new Map(sequence.map((e) => [e.spec.id, e]));
  const entries: PlanEntry[] = sequence.map((e) => {
    const deps = e.spec.dependsOn.filter((d) => byId.has(d));
    return {
      id: e.spec.id,
      goal: e.spec.goal,
      module: e.module?.id,
      deps,
      dependents: [], // 反查补
      status: state[e.spec.id]?.status || 'todo',
    };
  });
  for (const en of entries) {
    for (const d of en.deps) {
      const up = entries.find((x) => x.id === d);
      if (up) up.dependents.push(en.id);
    }
  }
  // 关键路径：从每个根（无 deps）沿 dependents 边 DFS 取最长链
  let criticalPath: string[] = [];
  const dfs = (id: string, chain: string[], seen: Set<string>): string[] => {
    if (seen.has(id)) return chain;
    const en = entries.find((x) => x.id === id);
    if (!en) return chain;
    let best = [...chain, id];
    for (const next of en.dependents) {
      const cand = dfs(next, [...chain, id], new Set(seen).add(id));
      if (cand.length > best.length) best = cand;
    }
    return best;
  };
  for (const en of entries) {
    if (en.deps.length) continue; // 只从根出发
    const cand = dfs(en.id, [], new Set());
    if (cand.length > criticalPath.length) criticalPath = cand;
  }
  const byModule = new Map<string, PlanEntry[]>();
  for (const en of entries) {
    const key = en.module || '（独立）';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key)!.push(en);
  }
  return { entries, depEdges: entries.reduce((n, e) => n + e.deps.length, 0), criticalPath, byModule };
}

/** 终端全量计划：顺序清单 + 依赖边 + 关键路径 + 模块分组 */
export function renderPlan(model: PlanModel, opts: { batch?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`📋 执行计划${opts.batch ? `（批次 ${opts.batch}）` : ''}：${model.entries.length} 任务 / ${model.depEdges} 条依赖边 / 关键路径 ${model.criticalPath.length} 任务`);
  lines.push('');
  model.entries.forEach((e, i) => {
    const mod = e.module ? `[${e.module}] ` : '';
    const dep = e.deps.length ? `  ← 依赖: ${e.deps.join(', ')}` : '';
    const statusIcon = e.status === 'done' ? '✅' : e.status === 'doing' ? '⏳' : e.status === 'failed' ? '⛔' : '　';
    lines.push(`${String(i + 1).padStart(2)}. ${mod}${e.id}${dep}  ${statusIcon}`);
  });
  if (model.criticalPath.length > 1) {
    lines.push('');
    lines.push(`关键路径（最长依赖链，串行咽喉）：${model.criticalPath.join(' → ')}`);
  }
  const moduleKeys = [...model.byModule.keys()];
  if (moduleKeys.length > 1) {
    lines.push('');
    lines.push('模块分组：');
    for (const key of moduleKeys) {
      const ents = model.byModule.get(key)!;
      lines.push(`  ${key}（${ents.length} 任务）：${ents.map((e) => e.id).join(' → ')}`);
    }
  }
  return lines.join('\n');
}

/** execute 开局摘要（≤6 行）：批次开始先亮全景，不逐轮重复细节 */
export function renderPlanBrief(model: PlanModel): string {
  const pending = model.entries.filter((e) => e.status !== 'done');
  const nextUp = pending.slice(0, 4).map((e) => e.id);
  const lines: string[] = [];
  lines.push(`📋 执行计划：${model.entries.length} 任务 / ${pending.length} 待做 / ${model.depEdges} 条依赖边`);
  if (model.criticalPath.length > 1) lines.push(`   关键路径：${model.criticalPath.join(' → ')}`);
  if (nextUp.length) lines.push(`   接下来：${nextUp.join(' → ')}${pending.length > 4 ? ' → …' : ''}`);
  return lines.join('\n');
}

// ============================================================
// 命名计划：md 底稿既是人读也是机读（--plans 执行与 --show 重建的锚点）
// ============================================================

import { parseSimpleYaml } from './task-spec';
import { toSlug } from './task-naming';

/** 计划文件 frontmatter：机读锚点（md 底稿携带任务清单，HTML 纯展示不带数据） */
export interface PlanFrontmatter {
  name: string;         // plan-name：显示名（人读）
  tasks: string[];      // 圈定的任务 ID 清单
  modules: string[];    // 圈定的模块 ID 清单（信息性）
  createdAt?: string;   // created-at：ISO 时间戳
}

/** 计划 slug：显示名 → ASCII 文件名（与任务命名同一仪式） */
export function planSlug(name: string): string {
  return toSlug(name) || 'plan';
}

/** 渲染计划 frontmatter（YAML 文本，落盘 md 头部） */
export function renderPlanFrontmatter(fm: PlanFrontmatter): string {
  const lines = ['---', `plan-name: ${fm.name}`, `created-at: ${fm.createdAt || new Date().toISOString()}`];
  if (fm.tasks.length) lines.push(`tasks: [${fm.tasks.join(', ')}]`);
  else lines.push('tasks: []');
  if (fm.modules.length) lines.push(`modules: [${fm.modules.join(', ')}]`);
  lines.push('---');
  return lines.join('\n');
}

/** 解析计划 md 的 frontmatter（宽松解析；缺 tasks 或形状异常返回 null——不可机读的计划不可被 --plans 引用） */
export function parsePlanFrontmatter(text: string): PlanFrontmatter | null {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const raw = parseSimpleYaml(m[1]);
  const name = typeof raw['plan-name'] === 'string' ? raw['plan-name'] : '';
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(String) : [];
  const modules = Array.isArray(raw.modules) ? raw.modules.map(String) : [];
  if (!name && !tasks.length) return null;
  return { name, tasks, modules, createdAt: typeof raw['created-at'] === 'string' ? raw['created-at'] : undefined };
}

/** 计划摘要（--list 用）：名称 / 任务数 / 创建时间 / 是否有 HTML 伴生页 */
export interface PlanSummary {
  slug: string;
  name: string;
  taskCount: number;
  createdAt?: string;
  html: boolean;
}

/** 列出批次内全部命名计划（读 overview/plans/*.md 的 frontmatter；非计划 md 跳过） */
export function listPlanSummaries(plansDir: string): PlanSummary[] {
  const out: PlanSummary[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(plansDir).filter((f: string) => f.endsWith('.md'));
  } catch {
    return out; // 目录不存在 = 尚无命名计划
  }
  for (const f of entries) {
    let text = '';
    try {
      text = readFileSync(join(plansDir, f), 'utf-8');
    } catch {
      continue;
    }
    const fm = parsePlanFrontmatter(text);
    if (!fm) continue;
    out.push({
      slug: f.replace(/\.md$/, ''),
      name: fm.name || f.replace(/\.md$/, ''),
      taskCount: fm.tasks.length,
      createdAt: fm.createdAt,
      html: existsSync(join(plansDir, f.replace(/\.md$/, '.html'))),
    });
  }
  return out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

/** 按计划名解析任务 ID 集合：多计划取并集；slug 精确匹配，找不到再按显示名前缀兜底；缺失的名字进 missing 明确报错 */
export function resolvePlanTaskIds(plansDir: string, names: string[]): { taskIds: string[]; missing: string[] } {
  const summaries = listPlanSummaries(plansDir);
  const ids = new Set<string>();
  const missing: string[] = [];
  for (const n of names) {
    const hit = summaries.find((s) => s.slug === n) || summaries.find((s) => s.name.startsWith(n));
    if (!hit) {
      missing.push(n);
      continue;
    }
    let text = '';
    try {
      text = readFileSync(join(plansDir, hit.slug + '.md'), 'utf-8');
    } catch {
      continue;
    }
    const fm = parsePlanFrontmatter(text);
    if (fm) fm.tasks.forEach((t) => ids.add(t));
  }
  return { taskIds: [...ids], missing };
}

// ============================================================
// 计划 HTML：同视觉语言（PingFang SC / 浅灰底 / 白卡片 / 单文件零依赖）
// ============================================================

function escHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PLAN_CSS = `
body{font-family:'PingFang SC','Hiragino Sans GB',sans-serif;margin:40px auto;max-width:860px;padding:0 20px;color:#1e293b;background:#f8fafc;line-height:1.7}
h1{font-size:26px;margin-bottom:4px}
.sub{color:#64748b;font-size:13px;margin-bottom:22px}
.stats{display:flex;gap:14px;margin-bottom:22px;flex-wrap:wrap}
.stat{background:#fff;border-radius:10px;padding:10px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
.stat b{font-size:18px;margin-right:4px}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;margin-bottom:22px}
.bar div{height:100%}
.card{background:#fff;border-radius:10px;padding:12px 18px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card h3{font-size:15px;margin:6px 0 10px;color:#334155;display:flex;align-items:center;gap:8px}
.row{padding:7px 0;border-top:1px solid #f1f5f9;font-size:13.5px}
.row:first-of-type{border-top:none}
.row .seq{display:inline-block;width:30px;color:#94a3b8;font-size:12px}
.row b{color:#1d4ed8;font-weight:700}
.row .goal{color:#475569;margin-left:8px}
.row .dep{color:#b45309;font-size:12px}
.row .st{float:right;font-size:12px;color:#64748b}
.cp{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:8px 12px;font-size:13.5px;color:#047857;margin:8px 0}
.mod-tag{display:inline-block;background:#e0e7ff;color:#4338ca;font-size:11px;border-radius:6px;padding:1px 7px;margin-right:6px;font-weight:700}
.badge{color:#fff;font-size:12px;border-radius:9px;padding:1px 8px;font-weight:700;background:#1d4ed8}
`.trim();

const ST_ICON: Record<string, string> = { done: '✅', doing: '⏳', failed: '⛔', todo: '　' };

/** 渲染计划 HTML（单文件零依赖双击即看；与 GUIDE/PANEL/CLARIFY/REPORT 同视觉语言） */
export function renderPlanHtml(model: PlanModel, opts: { name: string; batch?: string }): string {
  const counts: Record<string, number> = { done: 0, doing: 0, failed: 0, todo: 0 };
  model.entries.forEach((e) => {
    counts[e.status] = (counts[e.status] || 0) + 1;
  });
  const rows = model.entries
    .map(
      (e, i) =>
        `<div class="row"><span class="seq">${i + 1}.</span>${e.module ? `<span class="mod-tag">${escHtml(e.module)}</span>` : ''}<b>${escHtml(e.id)}</b><span class="goal">${escHtml(e.goal.length > 60 ? e.goal.slice(0, 60) + '…' : e.goal)}</span>${e.deps.length ? `<span class="dep">← ${escHtml(e.deps.join(', '))}</span>` : ''}<span class="st">${ST_ICON[e.status] || ''}</span></div>`,
    )
    .join('\n');
  const cpBlock =
    model.criticalPath.length > 1
      ? `<div class="cp">🚩 关键路径（最长依赖链，串行咽喉）：${escHtml(model.criticalPath.join(' → '))}</div>`
      : '';
  const modBlocks = [...model.byModule.keys()]
    .map((key) => {
      const ents = model.byModule.get(key)!;
      return `<div class="card"><h3>📦 模块：${escHtml(key)}<span class="badge">${ents.length}</span></h3><div>${ents.map((e) => `<div class="row"><b>${escHtml(e.id)}</b><span class="goal">${escHtml(e.goal.length > 50 ? e.goal.slice(0, 50) + '…' : e.goal)}</span></div>`).join('\n')}</div></div>`;
    })
    .join('\n');
  const barTotal = model.entries.length || 1;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>计划：${escHtml(opts.name)}</title>
<style>${PLAN_CSS}</style>
</head>
<body>
<h1>📋 计划：${escHtml(opts.name)}</h1>
<div class="sub">${opts.batch ? `批次 ${escHtml(opts.batch)} · ` : ''}生成于 ${new Date().toLocaleString('zh-CN')}；执行顺序由 depends-on 拓扑排序决定</div>
<div class="stats">
<div class="stat"><b>${model.entries.length}</b>任务</div>
<div class="stat"><b>${model.depEdges}</b>依赖边</div>
<div class="stat"><b>${model.criticalPath.length}</b>关键路径</div>
<div class="stat"><b>${counts.done}</b>已完成</div>
</div>
<div class="bar">
<div style="width:${(counts.done / barTotal) * 100}%;background:#10b981"></div>
<div style="width:${(counts.doing / barTotal) * 100}%;background:#f59e0b"></div>
<div style="width:${(counts.failed / barTotal) * 100}%;background:#ef4444"></div>
<div style="width:${(counts.todo / barTotal) * 100}%;background:#e2e8f0"></div>
</div>
${cpBlock}
<div class="card"><h3>🗂 执行顺序（拓扑）</h3>
${rows}
</div>
${modBlocks}
</body>
</html>
`;
}
