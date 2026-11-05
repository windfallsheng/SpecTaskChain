// 评估报告（澄清 / 完成）：主流程之外的「账房先生」——后台生成，绝不阻断接力
// 架构：主进程聚合数据 → 临时 JSON 落盘 → detached worker 渲染 MD+HTML 写报告目录 → 主进程立即返回
// 设计原则：报告是辅助物，生成失败不能影响主流程（worker 静默运行，失败写 log 供排查）
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { DARK_CSS, SCAN_CSS, SCAN_LAYERS } from './html-theme';
import { spawn } from 'child_process';
import type { TaskSpec } from './task-spec';
import type { TaskRunState } from './config';
import type { ClarifyIssue } from './clarify';

/** 报告类型：澄清评估 / 完成评估（命名区分：CLARIFY_REPORT vs DONE_REPORT） */
export type AssessmentKind = 'clarify' | 'done';

/** 单任务评估条目（两个报告共用：状态 + 一句话 + 细节） */
export interface TaskAssessmentItem {
  taskId: string;           // 任务 ID（目录名）
  name?: string;            // 显示名（有则展示）
  status: 'ok' | 'warn' | 'risk' | 'failed' | 'done' | 'todo'; // 澄清视角：ok 健康/warn 建议/risk 风险；完成视角：done/failed/todo
  summary: string;          // 一句话评估
  details: string[];        // 细节清单（issue 消息 / 验收结论）
}

/** 评估报告主体（主进程聚合 → 序列化给 worker 渲染） */
export interface AssessmentReport {
  kind: AssessmentKind;
  batchId: string;          // 所属批次（报告放该批次 overview/reports/）
  generatedAt: string;      // 生成时间（ISO）
  grade: string;            // 总体评级 A/B/C/D
  score: number;            // 总体评分 0-100
  headline: string;         // 总评一句话
  totals: { label: string; value: string }[]; // 总体统计键值对（保持渲染器无语义负担）
  tasks: TaskAssessmentItem[];
}

/** 等级徽章颜色（HTML 用） */
function gradeColor(grade: string): string {
  if (grade === 'A') return '#059669';
  if (grade === 'B') return '#2563eb';
  if (grade === 'C') return '#d97706';
  return '#dc2626';
}

/** 按分数定等级：A≥90 优 / B≥75 良 / C≥60 及格 / D<60 需返工 */
export function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 报告文件名（不含扩展名）：CLARIFY_REPORT-{批次}-{日期} / DONE_REPORT-{批次}-{日期}——两类报告命名分明，同日重跑覆盖 */
export function reportBaseName(kind: AssessmentKind, batchId: string, generatedAt: string): string {
  return `${kind === 'clarify' ? 'CLARIFY_REPORT' : 'DONE_REPORT'}-${batchId}-${generatedAt.slice(0, 10)}`;
}

/** 报告目录：批次目录/overview/reports/（用户指定位置） */
export function reportDir(queueDir: string, batchId: string): string {
  return join(queueDir, batchId, 'overview', 'reports');
}

// ============================================================
// 聚合器（主进程调用：把体检/账本数据汇总成报告对象）
// ============================================================

const LEVEL_PENALTY: Record<string, number> = { blocking: 15, exec: 10, suggest: 5, pending: 3 };

/** 澄清评估聚合：issues 按任务归组 → 每任务条目 + 总评 + 评分（issue 等级扣分制） */
export function buildClarifyAssessment(batchId: string, tasks: TaskSpec[], issues: ClarifyIssue[], generatedAt = new Date().toISOString()): AssessmentReport {
  const byTask = new Map<string, ClarifyIssue[]>();
  for (const i of issues) {
    const list = byTask.get(i.taskId) || [];
    list.push(i);
    byTask.set(i.taskId, list);
  }
  let penalty = 0;
  let draftCount = 0;
  const items: TaskAssessmentItem[] = tasks.map((t) => {
    const mine = byTask.get(t.id) || [];
    let worst = 0;
    for (const i of mine) {
      const p = LEVEL_PENALTY[i.level] || 0;
      if (p > worst) worst = p;
      penalty += p;
    }
    if (t.draft) {
      draftCount += 1;
      penalty += 5;
    }
    const status: TaskAssessmentItem['status'] = mine.length === 0 && !t.draft ? 'ok' : worst >= 10 ? 'risk' : 'warn';
    return {
      taskId: t.id,
      name: t.name,
      status,
      summary:
        mine.length === 0 && !t.draft
          ? '规格干净，无需澄清'
          : t.draft
            ? `规格为 draft（未澄清）${mine.length ? `，另有 ${mine.length} 个体检问题` : ''}`
            : `${mine.length} 个体检问题待处理`,
      details: mine.map((i) => `[${i.level}] ${i.message}`),
    };
  });
  const score = Math.max(0, 100 - penalty);
  const healthy = items.filter((t) => t.status === 'ok').length;
  const riskCount = issues.filter((i) => i.level === 'blocking' || i.level === 'exec').length;
  const grade = scoreToGrade(score);
  return {
    kind: 'clarify',
    batchId,
    generatedAt,
    grade,
    score,
    headline:
      issues.length === 0 && draftCount === 0
        ? '本批次规格全部健康，可以直接进入接力执行。'
        : `本批次共 ${issues.length} 个体检问题（含 ${riskCount} 个阻塞/风险）与 ${draftCount} 个 draft 任务，建议先澄清再接力。`,
    totals: [
      { label: '任务总数', value: String(items.length) },
      { label: '健康任务', value: String(healthy) },
      { label: 'draft 任务', value: String(draftCount) },
      { label: '体检问题总数', value: String(issues.length) },
      { label: '阻塞', value: String(issues.filter((i) => i.level === 'blocking').length) },
      { label: '建议', value: String(issues.filter((i) => i.level === 'suggest').length) },
      { label: '待定', value: String(issues.filter((i) => i.level === 'pending').length) },
      { label: '可执行性风险', value: String(issues.filter((i) => i.level === 'exec').length) },
    ],
    tasks: items,
  };
}

/** 完成评估聚合：state 账本 → 每任务条目 + 总评 + 评分（完成率制） */
export function buildDoneAssessment(batchId: string, tasks: TaskSpec[], state: Record<string, TaskRunState>, generatedAt = new Date().toISOString()): AssessmentReport {
  let doneCount = 0;
  let failedCount = 0;
  let attemptsSum = 0;
  const items: TaskAssessmentItem[] = tasks.map((t) => {
    const st = state[t.id];
    const attempts = st?.attempts || 0;
    attemptsSum += attempts;
    if (st?.status === 'done') doneCount += 1;
    if (st?.status === 'failed') failedCount += 1;
    const status: TaskAssessmentItem['status'] = st?.status === 'done' ? 'done' : st?.status === 'failed' ? 'failed' : 'todo';
    const details: string[] = [];
    if (attempts) details.push(`尝试 ${attempts} 次`);
    if (st?.verdict) details.push(`验收结论：${st.verdict}`);
    if (st?.doneAt) details.push(`完成于 ${st.doneAt}`);
    return {
      taskId: t.id,
      name: t.name,
      status,
      summary: status === 'done' ? '已完成并验收通过' : status === 'failed' ? '失败（达尝试上限），需人工介入' : '未完成',
      details,
    };
  });
  const score = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 100;
  const grade = scoreToGrade(score);
  const todoCount = tasks.length - doneCount - failedCount;
  return {
    kind: 'done',
    batchId,
    generatedAt,
    grade,
    score,
    headline:
      todoCount === 0 && failedCount === 0
        ? `本批次 ${tasks.length} 个任务全部完成，接力圆满收官。`
        : `本批次完成 ${doneCount}/${tasks.length} 个任务${failedCount ? `，失败 ${failedCount} 个需人工介入` : ''}${todoCount ? `，${todoCount} 个未完成` : ''}。`,
    totals: [
      { label: '任务总数', value: String(tasks.length) },
      { label: '已完成', value: String(doneCount) },
      { label: '失败', value: String(failedCount) },
      { label: '未完成', value: String(todoCount) },
      { label: '完成率', value: tasks.length ? `${Math.round((doneCount / tasks.length) * 100)}%` : '—' },
      { label: '重试次数合计', value: String(attemptsSum) },
    ],
    tasks: items,
  };
}

// ============================================================
// 渲染器（纯函数，可单测）
// ============================================================

/** 渲染评估报告 MD（主内容：总评 + 统计 + 逐任务评估） */
export function renderAssessmentMd(r: AssessmentReport): string {
  const lines: string[] = [];
  const title = r.kind === 'clarify' ? '澄清评估报告' : '完成评估报告';
  lines.push(`# ${title}——批次 ${r.batchId}`);
  lines.push('');
  lines.push(`> 生成时间：${r.generatedAt} ｜ 总体评级：${r.grade}（${r.score} 分）`);
  lines.push('');
  lines.push(`## 总体评估`);
  lines.push('');
  lines.push(`**${r.headline}**`);
  lines.push('');
  lines.push(`| 维度 | 情况 |`);
  lines.push(`| :--- | :--- |`);
  r.totals.forEach((t) => lines.push(`| ${t.label} | ${t.value} |`));
  lines.push('');
  lines.push(`## 逐任务评估`);
  lines.push('');
  const statusIcon = (s: string) =>
    s === 'ok' || s === 'done' ? '✅' : s === 'warn' ? '⚠️' : s === 'risk' || s === 'failed' ? '⛔' : s === 'todo' ? '⏳' : '❓';
  for (const t of r.tasks) {
    lines.push(`### ${statusIcon(t.status)} ${t.taskId}${t.name ? `（${t.name}）` : ''}`);
    lines.push('');
    lines.push(`**评估**：${t.summary}`);
    if (t.details.length) {
      lines.push('');
      t.details.forEach((d) => lines.push(`- ${d}`));
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** 渲染评估报告 HTML（独立样式：等级大徽章 + 统计条 + 任务卡片） */
export function renderAssessmentHtml(r: AssessmentReport): string {
  const title = r.kind === 'clarify' ? '澄清评估报告' : '完成评估报告';
  const statusIcon = (s: string) =>
    s === 'ok' || s === 'done' ? '✅' : s === 'warn' ? '⚠️' : s === 'risk' || s === 'failed' ? '⛔' : s === 'todo' ? '⏳' : '❓';
  const statusLabel = (s: string) =>
    s === 'ok' ? '健康' : s === 'warn' ? '建议' : s === 'risk' ? '风险' : s === 'failed' ? '失败' : s === 'done' ? '完成' : '待办';
  const cards = r.tasks
    .map(
      (t) => `<div class="task"><div class="t-head"><span class="t-icon">${statusIcon(t.status)}</span><b>${escHtml(t.taskId)}${t.name ? `<span class="t-name">${escHtml(t.name)}</span>` : ''}</b><span class="t-status">${statusLabel(t.status)}</span></div><p class="t-sum">${escHtml(t.summary)}</p>${t.details.length ? `<ul>${t.details.map((d) => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}</div>`
    )
    .join('\n');
  const stats = r.totals
    .map((t) => `<div class="stat"><span class="s-label">${escHtml(t.label)}</span><span class="s-value">${escHtml(t.value)}</span></div>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}——批次 ${escHtml(r.batchId)}</title>
<style>
${DARK_CSS}${SCAN_CSS}
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; position: relative; z-index: 1; }
  .head { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .grade { width: 72px; height: 72px; border-radius: 16px; background: ${gradeColor(r.grade)}; color: #0b1929; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; line-height: 1; flex-shrink: 0; box-shadow: 0 0 24px ${gradeColor(r.grade)}66; }
  .grade small { font-size: 11px; font-weight: 500; margin-top: 4px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; }
  .headline { background: var(--card); border: 1px solid var(--border); border-left: 4px solid ${gradeColor(r.grade)}; padding: 14px 18px; border-radius: 12px; font-size: 15px; margin: 16px 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 24px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 18px; min-width: 120px; }
  .s-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .s-value { font-size: 16px; font-weight: 600; }
  h2 { font-size: 17px; margin: 28px 0 12px; }
  .task { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; }
  .t-head { display: flex; align-items: center; gap: 8px; }
  .t-icon { font-size: 16px; }
  .t-name { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 4px; }
  .t-status { margin-left: auto; font-size: 12px; padding: 2px 10px; border-radius: 999px; background: rgba(14,165,233,.1); color: var(--cyan); }
  .t-sum { margin: 8px 0 4px; font-size: 14px; color: var(--text); }
  ul { margin: 6px 0 2px; padding-left: 20px; font-size: 13px; color: var(--text); }
  li { margin: 3px 0; }
</style>
</head>
<body>
${SCAN_LAYERS}
<div class="wrap">
  <div class="head">
    <div class="grade">${escHtml(r.grade)}<small>${r.score} 分</small></div>
    <div><h1>${title}</h1><div class="meta">批次 ${escHtml(r.batchId)} ｜ 生成于 ${escHtml(r.generatedAt)}</div></div>
  </div>
  <div class="headline"><b>总评：</b>${escHtml(r.headline)}</div>
  <div class="stats">${stats}</div>
  <h2>逐任务评估</h2>
  ${cards || '<p style="color:#94a3b8">无任务。</p>'}
</div>
</body>
</html>
`;
}

// ============================================================
// 后台派发（detached worker：主进程立即返回，报告异步落盘）
// ============================================================

/**
 * 派发评估报告生成（后台子进程，不阻断主流程）。
 * 主进程把 report 序列化为临时 JSON → spawn detached worker 渲染写盘 → unref 后主进程立即返回。
 * worker 失败静默（报告是辅助物，不能因报告生成失败而影响接力），可查 {json}.log。
 */
export function dispatchAssessment(cfg: { queueDir: string; metaDir: string }, report: AssessmentReport): void {
  try {
    // 1. 临时 JSON：worker 的数据入口（放 .taskchain 下，随队列走；queueDir 一并带入供 worker 定位报告目录）
    const tmpDir = join(cfg.metaDir, 'reports-tmp');
    mkdirSync(tmpDir, { recursive: true });
    const jsonPath = join(tmpDir, `${report.kind}-${report.batchId}-${Date.now()}.json`);
    writeFileSync(jsonPath, JSON.stringify({ queueDir: cfg.queueDir, report }), 'utf-8');

    // 2. worker 启动：优先 node + 同目录编译产物（发布常态，零依赖）；开发期（源目录无 .js）回退 tsx（仅本机开发场景）
    const here = __dirname;
    const jsWorker = join(here, 'report-worker.js');
    const tsWorker = join(here, 'report-worker.ts');
    const cmd = existsSync(jsWorker) ? process.execPath : 'npx';
    const args = existsSync(jsWorker) ? [jsWorker, jsonPath] : ['tsx', tsWorker, jsonPath];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref(); // 主进程不等待，worker 在后台把报告写完
  } catch {
    // 派发失败（极端场景）静默——主流程绝不为报告让路
  }
}

// ============================================================
// 报告写入（worker 入口调用；也导出供测试与同步回退）
// ============================================================

/** 把报告写盘：{报告目录}/{basename}.md + .html（worker 与同步回退共用） */
export function writeAssessmentFiles(queueDir: string, report: AssessmentReport): { md: string; html: string } {
  const dir = reportDir(queueDir, report.batchId);
  mkdirSync(dir, { recursive: true });
  const base = reportBaseName(report.kind, report.batchId, report.generatedAt);
  const mdPath = join(dir, `${base}.md`);
  const htmlPath = join(dir, `${base}.html`);
  writeFileSync(mdPath, renderAssessmentMd(report), 'utf-8');
  writeFileSync(htmlPath, renderAssessmentHtml(report), 'utf-8');
  return { md: mdPath, html: htmlPath };
}

/** 后台派发的可见提示（主流程输出一行，不等待） */
export function assessmentNotice(queueDir: string, report: AssessmentReport): string {
  const base = reportBaseName(report.kind, report.batchId, report.generatedAt);
  return `📝 ${report.kind === 'clarify' ? '澄清' : '完成'}评估报告后台生成中 → ${join(reportDir(queueDir, report.batchId), base)}.md/.html`;
}

// ============================================================
// 报告开关判定（纯函数，便于测试与两处调用共用）
// ============================================================

/**
 * 报告生成开关（四级优先级链，每项独立生效）：
 *   CLI 临时指令（--no-report / --report）> 批次配置（config/BATCH.yaml reports）> 系统默认（true）
 * 任务级（SPEC.md reports: false）不在这里判——由调用处先把该任务筛掉。
 * 返回 enabled + 关闭原因（enabled 时 reason 为空，不用读）。
 */
export function resolveReportSwitch(
  batchCfg: { reports?: boolean },
  opts: { noReport?: boolean; forceReport?: boolean },
): { enabled: boolean; reason: string } {
  if (opts.noReport) return { enabled: false, reason: 'CLI --no-report 临时关闭' };
  if (opts.forceReport) return { enabled: true, reason: '' };
  if (batchCfg.reports === false) {
    return { enabled: false, reason: '批次配置 config/BATCH.yaml 设了 reports: false（临时出一次：--report）' };
  }
  return { enabled: true, reason: '' };
}
