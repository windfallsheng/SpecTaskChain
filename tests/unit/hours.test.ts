// 工时与截止：due 口语解析 + spent 实际工时 + report 偏差账/逾期清单 + list 红标 + clarify 工时体检
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { buildSpec, renderSpec, parseDue, daysOverdue, readSpec } from '../../src/core/task-spec';
import { markTaskState } from '../../src/core/runner';
import { readState, writeState } from '../../src/core/config';
import { generateQueueReport, generateReportHtml } from '../../src/core/report';
import { detectTaskIssues } from '../../src/core/clarify';
import { listCommand } from '../../src/commands/list';
import { doneCommand } from '../../src/commands/done';
import { newCommand } from '../../src/commands/new';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

/** 落一个任务目录（frontmatter 直写） */
function seedTask(root: string, id: string, fm: string) {
  const dir = join(root, 'queue', 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPEC.md'), `---\n${fm}\n---\n`);
}

const fmt = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const today = fmt(new Date());
const daysAgo = (n: number) => fmt(new Date(Date.now() - n * 86400000));

describe('due：口语转日期 + 逾期天数', () => {
  it('YYYY-MM-DD 直通；明天/非法', () => {
    expect(parseDue('2026-11-30')).toBe('2026-11-30');
    expect(parseDue('明天')).toBe(fmt(new Date(Date.now() + 86400000)));
    expect(parseDue('昨天')).toBe(fmt(new Date(Date.now() - 86400000)));
    expect(parseDue('abc')).toBeNull();
  });

  it('daysOverdue：昨天=1 / 明天=-1 / 非法=null', () => {
    expect(daysOverdue(daysAgo(1))).toBe(1);
    expect(daysOverdue(fmt(new Date(Date.now() + 86400000)))).toBe(-1);
    expect(daysOverdue('abc')).toBeNull();
  });

  it('buildSpec 解析 due + renderSpec 渲染 due 行', () => {
    const spec = buildSpec('01-x', '/tmp/x', {
      due: '2026-11-30',
      goal: 'g', output: 'o', acceptance: { review: 'r' },
    }, '', 'general');
    expect(spec.due).toBe('2026-11-30');
    const out = renderSpec({
      type: 'doc', goal: 'g', output: 'o',
      acceptance: { artifacts: [], checks: [], review: '' },
      due: '2026-11-30',
    });
    expect(out).toContain('due: 2026-11-30');
  });

  it('new --due 口语自动转日期落盘', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    newCommand(cfg(root), { goal: '写迁移文档', name: 'xieqianyiwendang', draft: true, due: '明天' });
    // slug 不精确断言：直接扫批次目录下的任务目录，读回 SPEC.md
    const { readdirSync } = require('fs');
    const batchDir = join(root, 'queue', 'batch-001');
    const { existsSync } = require('fs');
    const taskDir = readdirSync(batchDir).find((d: string) => existsSync(join(batchDir, d, 'SPEC.md')));
    const loaded = readSpec(join(batchDir, taskDir));
    expect(loaded?.due).toBe(fmt(new Date(Date.now() + 86400000)));
  });
});

describe('spent：实际工时登记', () => {
  it('doneCommand --spent 登记进 state + 输出带实耗', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    seedTask(root, '01-a', 'type: doc\ngoal: 写文档\noutput: docs/a.md\nacceptance:\n  review: r');
    const out = doneCommand(cfg(root), { taskId: '01-a', verdict: 'pass', spent: 6 });
    const st = readState(cfg(root))['01-a'];
    expect(st.status).toBe('done');
    expect(st.spent).toBe(6);
    expect(out).toContain('实际工时 6h');
  });

  it('二次登记不带 spent 保留 prev 值', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    writeState(cfg(root), { '01-a': { status: 'done', attempts: 0, spent: 6 } });
    markTaskState(cfg(root), '01-a', 'done', 'pass');
    expect(readState(cfg(root))['01-a'].spent).toBe(6);
  });
});

describe('report：偏差账 + 逾期清单', () => {
  it('md 实际总工时 / 预估 vs 实际 / 偏差明细', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    seedTask(root, '01-a', 'type: doc\nestimate: 4\ngoal: A\noutput: docs/a.md\nacceptance:\n  review: r');
    seedTask(root, '02-b', 'type: doc\nestimate: 8\ngoal: B\noutput: docs/b.md\nacceptance:\n  review: r');
    writeState(cfg(root), {
      '01-a': { status: 'done', attempts: 0, spent: 6, verdict: 'pass' },
      '02-b': { status: 'done', attempts: 0, spent: 8, verdict: 'pass' },
    });
    const r = generateQueueReport(cfg(root));
    expect(r).toContain('实际总工时：14 小时（2 个已登记）');
    expect(r).toContain('预估 vs 实际：+2h');
    expect(r).toContain('超支 1 / 省时 0 / 持平 1');
    expect(r).toContain('偏差明细：01-a +2h');
    expect(r).not.toContain('02-b +0h');
  });

  it('md 逾期清单：到期未完成亮段，done 不算', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    seedTask(root, '01-a', `type: doc\ndue: ${daysAgo(2)}\ngoal: A\noutput: docs/a.md\nacceptance:\n  review: r`);
    seedTask(root, '02-b', `type: doc\ndue: ${daysAgo(1)}\ngoal: B\noutput: docs/b.md\nacceptance:\n  review: r`);
    writeState(cfg(root), { '02-b': { status: 'done', attempts: 0, verdict: 'pass' } });
    const r = generateQueueReport(cfg(root));
    expect(r).toContain('## 逾期任务（到期未完成）');
    expect(r).toContain('01-a：截止');
    expect(r).toContain('已过 2 天');
    expect(r).not.toContain('02-b：截止');
  });

  it('html 工时（估/实）列 + 逾期红卡', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    seedTask(root, '01-a', `type: doc\nestimate: 4\ndue: ${daysAgo(1)}\ngoal: A\noutput: docs/a.md\nacceptance:\n  review: r`);
    writeState(cfg(root), { '01-a': { status: 'done', attempts: 0, spent: 6, verdict: 'pass' } });
    const path = generateReportHtml(cfg(root));
    const html = readFileSync(path, 'utf-8');
    expect(html).toContain('工时（估/实）');
    expect(html).toContain('4 / 6');
    expect(html).toContain('实际总工时：<b>6</b>');
    // 无逾期任务时不渲染逾期红卡段
    expect(html).not.toContain('逾期任务（到期未完成）');
  });

  it('list 红标：实耗 🕐 + 逾期 🔴晚N天', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-hours-'));
    seedTask(root, '01-a', `type: doc\ndue: ${daysAgo(1)}\ngoal: A\noutput: docs/a.md\nacceptance:\n  review: r`);
    seedTask(root, '02-b', `type: doc\ndue: ${today}\ngoal: B\noutput: docs/b.md\nacceptance:\n  review: r`);
    writeState(cfg(root), { '02-b': { status: 'done', attempts: 0, spent: 5, verdict: 'pass' } });
    const out = listCommand(cfg(root));
    expect(out).toContain('🔴晚1天');
    expect(out).toContain('🕐5h');
    expect(out).toContain(`📅${today.slice(5)}`);
  });
});

describe('clarify：工时体检', () => {
  const mk = (estimate?: number) =>
    buildSpec('01-x', '/tmp/x', {
      ...(estimate !== undefined ? { estimate: String(estimate) } : {}),
      goal: 'g', output: 'o', acceptance: { review: 'r' },
    }, '', 'general');

  it('estimate 缺失 → 建议档「未估工时」', () => {
    const issues = detectTaskIssues(mk());
    expect(issues.some((i) => i.level === 'suggest' && i.message.includes('未估工时'))).toBe(true);
  });

  it('estimate > 40h → 建议拆任务', () => {
    const issues = detectTaskIssues(mk(50));
    expect(issues.some((i) => i.message.includes('单任务过重'))).toBe(true);
  });

  it('estimate 合理区间 → 不报工时问题', () => {
    const issues = detectTaskIssues(mk(8));
    expect(issues.some((i) => i.message.includes('未估工时') || i.message.includes('单任务过重'))).toBe(false);
  });
});
