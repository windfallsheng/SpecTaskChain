// 评估报告：澄清/完成双报告——聚合器、渲染器、落盘、后台派发
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TaskSpec } from '../../src/core/task-spec';
import type { ClarifyIssue } from '../../src/core/clarify';
import type { TaskRunState } from '../../src/core/config';
import {
  buildClarifyAssessment,
  buildDoneAssessment,
  renderAssessmentMd,
  renderAssessmentHtml,
  writeAssessmentFiles,
  reportBaseName,
  reportDir,
  scoreToGrade,
  assessmentNotice,
  dispatchAssessment,
} from '../../src/core/assessment';

// 拦截 child_process.spawn（hoisted：在 assessment.ts 装载前生效，防真实进程炸出）
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn().mockReturnValue({ unref: vi.fn() }) }));
vi.mock('child_process', () => ({ spawn: spawnMock }));

function makeSpec(id: string, extra: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    dir: `/q/${id}`,
    name: extra.name,
    type: 'doc',
    goal: `${id} 的目标`,
    output: `docs/${id}.md`,
    acceptance: { artifacts: [{ path: `docs/${id}.md` }], checks: [], review: '' },
    dependsOn: [],
    draft: extra.draft || false,
    body: '',
  };
}

function makeIssue(taskId: string, level: ClarifyIssue['level'], message = '问题描述'): ClarifyIssue {
  return { level, taskId, message };
}

describe('scoreToGrade：评分定级', () => {
  it('A≥90 / B≥75 / C≥60 / D<60', () => {
    expect(scoreToGrade(95)).toBe('A');
    expect(scoreToGrade(75)).toBe('B');
    expect(scoreToGrade(60)).toBe('C');
    expect(scoreToGrade(59)).toBe('D');
  });
});

describe('buildClarifyAssessment：澄清评估聚合', () => {
  it('全健康任务 → A 级 100 分', () => {
    const r = buildClarifyAssessment('batch-001', [makeSpec('01-a'), makeSpec('02-b')], []);
    expect(r.grade).toBe('A');
    expect(r.score).toBe(100);
    expect(r.tasks.every((t) => t.status === 'ok')).toBe(true);
    expect(r.headline).toContain('全部健康');
  });

  it('issue 扣分：blocking -15 / suggest -5 / draft -5', () => {
    const r = buildClarifyAssessment(
      'batch-001',
      [makeSpec('01-a'), makeSpec('02-b', { draft: true })],
      [makeIssue('01-a', 'blocking'), makeIssue('02-b', 'suggest')]
    );
    expect(r.score).toBe(75); // 100 - 15 - 5 - 5
    expect(r.grade).toBe('B');
    const a = r.tasks.find((t) => t.taskId === '01-a')!;
    expect(a.status).toBe('risk');
    expect(a.details.length).toBe(1);
    expect(r.totals.find((t) => t.label === '阻塞')!.value).toBe('1');
    expect(r.totals.find((t) => t.label === 'draft 任务')!.value).toBe('1');
  });

  it('无任务也安全（空批次）', () => {
    const r = buildClarifyAssessment('batch-001', [], []);
    expect(r.tasks).toEqual([]);
    expect(r.score).toBe(100);
  });
});

describe('buildDoneAssessment：完成评估聚合', () => {
  it('全部完成 → 100 分 A 级', () => {
    const state: Record<string, TaskRunState> = {
      '01-a': { status: 'done', attempts: 1, verdict: 'pass' },
      '02-b': { status: 'done', attempts: 2, verdict: 'pass 良好' },
    };
    const r = buildDoneAssessment('batch-001', [makeSpec('01-a'), makeSpec('02-b')], state);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.headline).toContain('全部完成');
    const a = r.tasks.find((t) => t.taskId === '02-b')!;
    expect(a.details).toContain('尝试 2 次');
    expect(a.details).toContain('验收结论：pass 良好');
  });

  it('一半完成 → 50 分 D 级，失败任务亮出', () => {
    const state: Record<string, TaskRunState> = {
      '01-a': { status: 'done', attempts: 1 },
      '02-b': { status: 'failed', attempts: 3, verdict: 'fail 不合格' },
    };
    const r = buildDoneAssessment('batch-001', [makeSpec('01-a'), makeSpec('02-b')], state);
    expect(r.score).toBe(50);
    expect(r.grade).toBe('D');
    const b = r.tasks.find((t) => t.taskId === '02-b')!;
    expect(b.status).toBe('failed');
    expect(b.summary).toContain('需人工介入');
    expect(r.totals.find((t) => t.label === '失败')!.value).toBe('1');
  });
});

describe('渲染器：MD + HTML 双格式', () => {
  const report = buildDoneAssessment(
    'batch-001',
    [makeSpec('01-a', { name: '任务甲' })],
    { '01-a': { status: 'done', attempts: 1, verdict: 'pass' } }
  );

  it('MD：标题/评级/统计表/逐任务全齐', () => {
    const md = renderAssessmentMd(report);
    expect(md).toContain('# 完成评估报告——批次 batch-001');
    expect(md).toContain('A（100 分）');
    expect(md).toContain('## 总体评估');
    expect(md).toContain('## 逐任务评估');
    expect(md).toContain('01-a（任务甲）');
  });

  it('HTML：等级徽章 + 统计 + 任务卡片', () => {
    const html = renderAssessmentHtml(report);
    expect(html).toContain('class="grade"');
    expect(html).toContain('>A<small>100 分</small>');
    expect(html).toContain('class="stat"');
    expect(html).toContain('class="task"');
    expect(html).toContain('任务甲');
  });
});

describe('命名区分与落盘', () => {
  it('两类报告命名分明：CLARIFY_REPORT vs DONE_REPORT（同批次同日期不撞）', () => {
    const ts = '2026-11-03T10:00:00.000Z';
    expect(reportBaseName('clarify', 'batch-001', ts)).toBe('CLARIFY_REPORT-batch-001-2026-11-03');
    expect(reportBaseName('done', 'batch-001', ts)).toBe('DONE_REPORT-batch-001-2026-11-03');
  });

  it('落盘位置：批次目录/overview/reports/', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-asm-'));
    const queueDir = join(root, 'queue');
    const report = buildClarifyAssessment('batch-001', [makeSpec('01-a')], []);
    const { md, html } = writeAssessmentFiles(queueDir, report);
    expect(md).toContain(join('batch-001', 'overview', 'reports', 'CLARIFY_REPORT-batch-001-'));
    expect(existsSync(md)).toBe(true);
    expect(existsSync(html)).toBe(true);
    expect(readFileSync(html, 'utf-8')).toContain('澄清评估报告');
  });
});

describe('后台派发：不阻断主流程', () => {
  it('写临时 JSON + spawn detached worker（unref 后立即返回）', () => {
    spawnMock.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'stc-dsp-'));
    const cfg = { queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
    mkdirSync(cfg.metaDir, { recursive: true });
    const report = buildDoneAssessment('batch-001', [makeSpec('01-a')], { '01-a': { status: 'done', attempts: 1 } });
    dispatchAssessment(cfg, report);
    // 临时 JSON 已写（worker 数据入口）
    const tmpFiles = readdirSync(join(cfg.metaDir, 'reports-tmp'));
    expect(tmpFiles.length).toBe(1);
    const payload = JSON.parse(readFileSync(join(cfg.metaDir, 'reports-tmp', tmpFiles[0]), 'utf-8'));
    expect(payload.queueDir).toBe(cfg.queueDir);
    expect(payload.report.kind).toBe('done');
    // spawn 被调：detached + stdio ignore + unref（主进程不等待）
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , spawnOpts] = spawnMock.mock.calls[0];
    expect(spawnOpts.detached).toBe(true);
    expect(spawnOpts.stdio).toBe('ignore');
  });
});

describe('assessmentNotice：可见提示', () => {
  it('提示报告路径，不夸张', () => {
    const report = buildClarifyAssessment('batch-001', [], []);
    const n = assessmentNotice('/q', report);
    expect(n).toContain('澄清评估报告后台生成中');
    expect(n).toContain('overview/reports');
  });
});
