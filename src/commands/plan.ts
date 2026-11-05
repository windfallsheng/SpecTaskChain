// taskq plan：执行计划——开局全景，用户可审、AI 可依；命名计划是「一等资产」（可被 --plans 引用执行）
// 依赖排序的执行引擎一直在（buildExecutionSequence），本命令把隐式顺序说给人听：顺序 / 依赖边 / 模块分组 / 关键路径
// 三种形态：默认全景 PLAN.md / 命名计划 plans/{slug}.md（frontmatter 机读）/ --format none 只终端
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, readState } from '../core/config';
import { scanQueue, buildExecutionSequence, selectBatch, resolveDefaultBatch, latestBatchId } from '../core/queue';
import { readBatchConfig } from '../core/batch-config';
import {
  buildPlanModel,
  renderPlan,
  renderPlanBrief,
  renderPlanHtml,
  renderPlanFrontmatter,
  parsePlanFrontmatter,
  listPlanSummaries,
  planSlug,
  resolvePlanTaskIds,
} from '../core/plan';

export interface PlanOptions {
  batch?: string;     // 指定批次（缺省 = 最近使用批次 > 最新批次）
  noSave?: boolean;   // 只看不落盘
  brief?: boolean;    // execute 开局用：≤6 行摘要
  name?: string;      // 命名计划：落 overview/plans/{slug}.md（可被 run/execute --plans 引用）
  tasks?: string[];   // 圈定任务（--tasks a,b）
  modules?: string[]; // 圈定模块（--module a,b）
  list?: boolean;     // --list：命名计划资产列表
  show?: string;      // --show <名>：渲染某命名计划详情
  format?: string;    // CLI 临时覆盖：md | html | none（缺省走批次 plan-format → md）
}

/** 批次 overview/plans/ 目录 */
function plansDir(cfg: TaskQConfig, batchId: string): string {
  return join(cfg.queueDir, batchId, 'overview', 'plans');
}

/** 落盘形态解析：CLI --format > 批次 plan-format > md（none = 只终端） */
function resolveFormat(cfg: TaskQConfig, batchId: string, opts: PlanOptions): 'md' | 'html' | 'none' {
  if (opts.format === 'md' || opts.format === 'html' || opts.format === 'none') return opts.format;
  return readBatchConfig(join(cfg.queueDir, batchId))['plan-format'];
}

export function planCommand(cfg: TaskQConfig, opts: PlanOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  if (!queue.tasks.length && !queue.modules.length) {
    return '队列还是空的。先建任务：taskq new "任务描述"';
  }
  const focusBatch = opts.batch && opts.batch !== 'all' ? opts.batch : resolveDefaultBatch(cfg, queue.batches);
  const view = selectBatch(queue, opts.batch, focusBatch);
  if (!view) {
    return `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、')}`;
  }
  const batchId = focusBatch || latestBatchId(queue.batches) || 'tasks';
  const pdir = plansDir(cfg, batchId);

  // --list：命名计划资产列表（名称 / 任务数 / 形态 / 创建时间）
  if (opts.list) {
    const sums = listPlanSummaries(pdir);
    if (!sums.length) {
      return `批次「${batchId}」还没有命名计划。用 taskq plan --name "计划名" [--tasks a,b] 创建。`;
    }
    const lines = [`📚 命名计划（批次 ${batchId}，共 ${sums.length} 个）：`, ''];
    sums.forEach((x, i) => {
      const fmt = x.html ? 'md+html' : 'md';
      const when = x.createdAt ? x.createdAt.slice(0, 10) : '';
      lines.push(`  ${i + 1}. ${x.slug}${x.name && x.name !== x.slug ? `　${x.name}` : ''}　${x.taskCount} 任务　${fmt}${when ? `　${when}` : ''}`);
    });
    lines.push('');
    lines.push(`全景计划：${join(cfg.queueDir, batchId, 'overview', 'PLAN.md')}`);
    lines.push('用法：taskq plan --show <名> 看详情；taskq run --plans <名1>,<名2> 按计划接力执行');
    return lines.join('\n');
  }

  // --show：渲染某命名计划详情（读 frontmatter 任务清单重建模型，带上当前状态）
  if (opts.show) {
    const sums = listPlanSummaries(pdir);
    const hit = sums.find((x) => x.slug === opts.show) || sums.find((x) => x.name.startsWith(opts.show!));
    if (!hit) {
      return `❌ 计划「${opts.show}」不存在。现有计划：${sums.map((x) => x.slug).join('、') || '（无）'}。taskq plan --list 看全貌。`;
    }
    const ftext = readFileSync(join(pdir, hit.slug + '.md'), 'utf-8');
    const fm = parsePlanFrontmatter(ftext);
    const want = new Set(fm?.tasks || []);
    const filtered = buildExecutionSequence(view).filter((e) => (want.size ? want.has(e.spec.id) : true));
    const model = buildPlanModel(filtered, readState(cfg));
    return renderPlan(model, { batch: batchId }) + `\n\n📄 计划文件：${join(pdir, hit.slug + '.md')}${hit.html ? `\n🖥 HTML 页：${join(pdir, hit.slug + '.html')}` : ''}`;
  }

  // 主流程：全景（无 --name）或命名计划（--name），可选 --tasks/--module 圈定范围
  const sequence = buildExecutionSequence(view);
  const taskSet = opts.tasks?.length ? new Set(opts.tasks) : undefined;
  const moduleSet = opts.modules?.length ? new Set(opts.modules) : undefined;
  const scoped =
    taskSet || moduleSet
      ? sequence.filter((e) => (taskSet ? taskSet.has(e.spec.id) : false) || (moduleSet ? moduleSet.has(e.module?.id || '') : false))
      : sequence;
  if (!scoped.length) {
    const sel = opts.tasks?.length ? `任务 ${opts.tasks.join('、')}` : `模块 ${opts.modules?.join('、')}`;
    return `❌ ${sel}在本批次没有任何匹配任务。taskq list --batch ${batchId} 看有哪些。`;
  }
  const model = buildPlanModel(scoped, readState(cfg));
  if (opts.brief) return renderPlanBrief(model);
  const text = renderPlan(model, { batch: opts.name ? undefined : batchId });
  if (opts.noSave) return text;

  // 落盘：形态由批次配置 plan-format（或 CLI --format）决定
  const format = resolveFormat(cfg, batchId, opts);
  if (format === 'none') {
    return text + (opts.name ? `\n\n💡 本批次 plan-format: none，计划未落盘（一次性视图）。要长期保留：taskq plan --name "${opts.name}" --format md` : '');
  }
  if (!existsSync(join(cfg.queueDir, batchId, 'overview'))) mkdirSync(join(cfg.queueDir, batchId, 'overview'), { recursive: true });

  if (opts.name) {
    // 命名计划：md 底稿带 frontmatter（tasks 机读锚点，--plans 执行的依据）；html 按需伴生
    const slug = planSlug(opts.name);
    if (!existsSync(pdir)) mkdirSync(pdir, { recursive: true });
    const fm = renderPlanFrontmatter({ name: opts.name, tasks: scoped.map((e) => e.spec.id), modules: [...(moduleSet || [])] });
    const body = `# 📋 计划：${opts.name}\n\n> 生成于 ${new Date().toISOString()}；执行顺序由 depends-on 拓扑排序决定。\n\n\`\`\`\n${text}\n\`\`\`\n`;
    const mdPath = join(pdir, slug + '.md');
    writeFileSync(mdPath, fm + '\n' + body, 'utf-8');
    let extra = '';
    if (format === 'html') {
      const htmlPath = join(pdir, slug + '.html');
      writeFileSync(htmlPath, renderPlanHtml(model, { name: opts.name, batch: batchId }), 'utf-8');
      extra = `\n🖥 HTML 页：${htmlPath}`;
    }
    return `${text}\n\n📄 计划已落盘：${mdPath}${extra}\n\n按计划接力执行：taskq run --plans ${slug}（多个计划用逗号：--plans a,b）`;
  }

  // 全景计划：沿用 PLAN.md 底稿（人读资产）；与命名计划同构带 frontmatter（tasks 机读锚点——execute 沿用计划时锁定执行范围）；html 形态时伴生 PLAN.html
  const overviewDir = join(cfg.queueDir, batchId, 'overview');
  const planPath = join(overviewDir, 'PLAN.md');
  const stamp = `> 生成于 ${new Date().toISOString()}；执行顺序由 depends-on 拓扑排序决定（悬空依赖已在 clarify 报阻塞）。\n\n`;
  const fm = renderPlanFrontmatter({ name: '执行计划', tasks: scoped.map((e) => e.spec.id), modules: [...(moduleSet || [])] });
  writeFileSync(planPath, fm + '\n' + '# 执行计划\n\n' + stamp + '```\n' + text + '\n```\n', 'utf-8');
  let extra = '';
  if (format === 'html') {
    const htmlPath = join(overviewDir, 'PLAN.html');
    writeFileSync(htmlPath, renderPlanHtml(model, { name: '执行计划', batch: batchId }), 'utf-8');
    extra = `\n🖥 HTML 页：${htmlPath}`;
  }
  return text + `\n\n�� 计划已落盘：${planPath}${extra}`;
}

/** 执行前置仪式：批量执行多任务前默认先落全景计划（人可审、AI 可依）——「先谋后动」
 * 流水线衔接：批次已有计划（PLAN.md/PLAN.html）→ 沿用不重列（谋已定，不再重谋）；--replan 强制重列
 * 跳过条件：定向执行（--task/--module/--plans，用户已指定范围，仪式多余）或显式 --no-plan
 * 返回计划文本（未触发返回空串）；落盘形态照走批次 plan-format 配置 */
export function planBeforeExecute(cfg: TaskQConfig, batch: string | undefined, opts: { noPlan?: boolean; directed?: boolean; replan?: boolean }): { text: string; planTaskIds?: string[] } {
  if (opts.noPlan || opts.directed) return { text: '' };
  // 计划是执行依据不是拦路石：生成异常（写盘失败/渲染出错）降级为警告，接力主流程照跑
  try {
    // 批次解析与 planCommand 同源：缺省最新批次、--batch all 全量
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    if (!queue.tasks.length) return { text: '' }; // 队列为空谋无可谋，跳过仪式（避免「先建任务」与「队列已清空」两句话打架）
    const focusBatch = batch && batch !== 'all' ? batch : resolveDefaultBatch(cfg, queue.batches);
    const batchId = focusBatch || latestBatchId(queue.batches) || 'tasks';
    const overview = join(cfg.queueDir, batchId, 'overview');
    const planPath = join(overview, 'PLAN.md');
    const existing = existsSync(planPath) || existsSync(join(overview, 'PLAN.html'));
    if (existing && !opts.replan) {
      // 执行的就是这个计划：读 frontmatter tasks 锁定执行范围（旧版无 frontmatter 计划退化为全部待办）
      let planTaskIds: string[] | undefined;
      if (existsSync(planPath)) {
        const fm = parsePlanFrontmatter(readFileSync(planPath, 'utf-8'));
        planTaskIds = fm && fm.tasks.length ? fm.tasks : undefined;
      }
      return {
        text: `📋 沿用批次现有执行计划（${planPath}）——谋已定，不再重列，按计划圈定任务集执行${planTaskIds ? `（${planTaskIds.length} 个任务）` : ''}；要重列加 --replan`,
        planTaskIds,
      };
    }
    return { text: planCommand(cfg, { batch, brief: false }) };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { text: `⚠️ 执行前计划生成失败（${why}）——已跳过，不影响任务接力；可稍后 taskq plan 手动补` };
  }
}

/** run/execute 的 --plans 解析：按批次定位 plans/ 目录读任务集（多计划并集）；缺失的计划名进 missing 明确报错 */
export function resolvePlans(cfg: TaskQConfig, batch: string | undefined, planNames: string[]): { taskIds: string[]; missing: string[] } {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const focusBatch = batch && batch !== 'all' ? batch : resolveDefaultBatch(cfg, queue.batches);
  const batchId = focusBatch || latestBatchId(queue.batches) || 'tasks';
  return resolvePlanTaskIds(plansDir(cfg, batchId), planNames);
}
