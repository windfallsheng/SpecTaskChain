// 元数据：created-at/priority/tags/estimate + 批次/模块可选元数据 + list/report 三扇窗筛选
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { buildSpec, renderSpec, readSpec } from '../../src/core/task-spec';
import { scanQueue } from '../../src/core/queue';
import { newCommand } from '../../src/commands/new';
import { listCommand } from '../../src/commands/list';
import { generateQueueReport } from '../../src/core/report';
import { writeState } from '../../src/core/config';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

describe('任务元数据：created-at / priority / tags / estimate', () => {
  it('buildSpec 解析四个新字段', () => {
    const spec = buildSpec('01-x', '/tmp/x', {
      'created-at': '2026-10-28',
      priority: 'P1',
      tags: ['客户', '线上'],
      estimate: '8',
      goal: 'g',
      output: 'o',
      acceptance: { review: 'r' },
    }, 'body', 'general');
    expect(spec.createdAt).toBe('2026-10-28');
    expect(spec.priority).toBe('P1');
    expect(spec.tags).toEqual(['客户', '线上']);
    expect(spec.estimate).toBe(8);
  });

  it('tags 逗号串兼容 + estimate 非法值静默', () => {
    const spec = buildSpec('02-x', '/tmp/x', {
      tags: '客户, 线上，Q4',
      estimate: 'abc',
      goal: 'g',
      output: 'o',
      acceptance: { review: 'r' },
    }, '', 'general');
    expect(spec.tags).toEqual(['客户', '线上', 'Q4']);
    expect(spec.estimate).toBeUndefined();
  });

  it('renderSpec 渲染新字段', () => {
    const out = renderSpec({
      type: 'doc', goal: 'g', output: 'o',
      acceptance: { artifacts: [], checks: [], review: '' },
      createdAt: '2026-10-28', priority: 'P0', tags: ['a', 'b'], estimate: 4,
    });
    expect(out).toContain('created-at: 2026-10-28');
    expect(out).toContain('priority: P0');
    expect(out).toContain('tags:\n  - a\n  - b');
    expect(out).toContain('estimate: 4');
  });

  it('readSpec：手工任务无 created-at → 目录出生时间兜底', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    const dir = join(root, 'q', 'batch-001', '01-x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SPEC.md'), '---\ngoal: g\noutput: o\nacceptance:\n  review: r\n---\n');
    const spec = readSpec(dir, 'general');
    expect(spec?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('new 落盘 created-at 与可选元数据', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    const out = newCommand(cfg(root), { goal: '写迁移手册', name: 'xieqianyishouce', type: 'doc', priority: 'P2', tags: ['迁移', '文档'], estimate: 3, draft: true });
    expect(out).toContain('task-xieqianyishouce');
    const specRaw = readFileSync(join(root, 'queue', 'batch-001', 'task-xieqianyishouce', 'SPEC.md'), 'utf-8');
    expect(specRaw).toContain(`created-at: ${new Date().toISOString().slice(0, 10)}`);
    expect(specRaw).toContain('priority: P2');
    expect(specRaw).toContain('tags:\n  - 迁移\n  - 文档');
    expect(specRaw).toContain('estimate: 3');
  });
});

describe('批次/模块元数据：BATCH.md 与 CONSTRAINTS frontmatter', () => {
  it('BATCH.md 可选解析（不写 BATCH.md 也能跑，出生时间兜底）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    const area = join(root, 'queue', 'batch-001');
    mkdirSync(join(area, '01-a'), { recursive: true });
    writeFileSync(join(area, '01-a', 'SPEC.md'), '---\ngoal: g\noutput: o\nacceptance:\n  review: r\n---\n');
    const q1 = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    expect(q1.batches[0].name).toBeUndefined();
    expect(q1.batches[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    writeFileSync(join(area, 'BATCH.md'), '---\nname: 十月攻坚批次\npurpose: 一批要做的全部任务\ncreated-at: 2026-10-01\n---\n');
    const q2 = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    expect(q2.batches[0].name).toBe('十月攻坚批次');
    expect(q2.batches[0].purpose).toBe('一批要做的全部任务');
    expect(q2.batches[0].createdAt).toBe('2026-10-01');
  });

  it('CONSTRAINTS.md frontmatter 剥离：元数据不注入约束正文', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    const mod = join(root, 'queue', 'batch-001', 'module-auth');
    mkdirSync(join(mod, '01-denglujiekou'), { recursive: true });
    writeFileSync(join(mod, '01-denglujiekou', 'SPEC.md'), '---\ngoal: g\noutput: o\nacceptance:\n  review: r\n---\n');
    writeFileSync(join(mod, 'CONSTRAINTS.md'), '---\nname: 认证模块\npurpose: 登录注册的共享约束\ncreated-at: 2026-10-29\n---\n# 公共约束\n\n1. 接口统一返回 JSON\n');
    const q = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    const m = q.modules[0];
    expect(m.name).toBe('认证模块');
    expect(m.purpose).toBe('登录注册的共享约束');
    expect(m.createdAt).toBe('2026-10-29');
    expect(m.constraints).not.toContain('name: 认证模块');
    expect(m.constraints).toContain('接口统一返回 JSON');
    expect(m.constraintsMissing).toBe(false);
  });
});

describe('list/report 筛选：三扇窗（batch/status/type）', () => {
  function seedQueue(root: string) {
    const area = join(root, 'queue', 'batch-001');
    mkdirSync(join(area, '01-doc-a'), { recursive: true });
    writeFileSync(join(area, '01-doc-a', 'SPEC.md'), '---\ntype: doc\npriority: P1\nestimate: 8\ngoal: 文档A\noutput: docs/a.md\nacceptance:\n  review: r\n---\n');
    mkdirSync(join(area, '02-script-b'), { recursive: true });
    writeFileSync(join(area, '02-script-b', 'SPEC.md'), '---\ntype: script\npriority: P2\ngoal: 脚本B\noutput: scripts/b.sh\nacceptance:\n  checks:\n    - bash b.sh\n---\n');
    writeState(cfg(root), { '01-doc-a': { status: 'done', attempts: 1, doneAt: '2026-10-29', verdict: 'pass' } });
  }

  it('--status 筛选：只显示 done', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    seedQueue(root);
    const out = listCommand(cfg(root), { status: 'done' });
    expect(out).toContain('01-doc-a');
    expect(out).not.toContain('02-script-b');
  });

  it('--type 筛选：只显示 script', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    seedQueue(root);
    const out = listCommand(cfg(root), { type: 'script' });
    expect(out).toContain('02-script-b');
    expect(out).not.toContain('01-doc-a');
  });

  it('组合筛选 AND + 无命中提示 + 批次不存在报错', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    seedQueue(root);
    const out = listCommand(cfg(root), { status: 'done', type: 'script' });
    expect(out).toContain('筛选无结果');
    const err = listCommand(cfg(root), { batch: 'batch-999' });
    expect(err).toContain('不存在');
  });

  it('list 徽章：优先级与工时', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    seedQueue(root);
    const out = listCommand(cfg(root));
    expect(out).toContain('⚑P1');
    expect(out).toContain('⏱8h');
  });

  it('report 筛选 + 优先级列 + 工时汇总', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-meta-'));
    seedQueue(root);
    const r1 = generateQueueReport(cfg(root), { type: 'doc' });
    expect(r1).toContain('筛选范围：类型 doc');
    expect(r1).toContain('| 01-doc-a | P1 |');
    expect(r1).toContain('预估总工时：8 小时');
    expect(r1).not.toContain('02-script-b');
    const r2 = generateQueueReport(cfg(root));
    expect(r2).toContain('P1 ×1 / P2 ×1');
  });
});
