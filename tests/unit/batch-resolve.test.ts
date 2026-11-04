// 懒人批次解析：parseBatchRef（口径识别）+ resolveBatchRef（语义落定）+ askCommand（端到端集成）
// 设计：用户嘴里的「预算那批」不是选择题——先语义命中唯一批就直落，平局/零命中亮候选清单给 AI 挑
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseBatchRef } from '../../src/core/intent';
import { resolveBatchRef, renderBatchCandidates } from '../../src/core/batch-resolve';
import { QueueScan, BatchInfo, TaskSpec, scanQueue } from '../../src/core/queue';
import { writeLastUsedBatch } from '../../src/core/config';
import { askCommand } from '../../src/commands/ask';

function task(name: string, goal: string): TaskSpec {
  return { id: name, name, goal } as unknown as TaskSpec;
}

function batch(id: string, opts: { name?: string; purpose?: string; tasks?: TaskSpec[] } = {}): BatchInfo {
  return { id, name: opts.name, purpose: opts.purpose, tasks: opts.tasks || [], modules: [], createdAt: '2026-01-01' } as unknown as BatchInfo;
}

/** 假 cfg：metaDir 不存在 → 无 state 记忆，默认落最新批次 */
const fakeCfg = { projectRoot: '/tmp', queueDir: '/tmp/q', metaDir: '/tmp/q/.taskchain' };

const queue: QueueScan = {
  tasks: [],
  modules: [],
  batches: [
    batch('batch-001', { name: '预算季', purpose: '编制季度预算', tasks: [task('11-yusuan', '编制 Q4 预算')] }),
    batch('batch-002', { name: '复盘', purpose: '月度复盘', tasks: [task('21-fupan', '十月复盘')] }),
  ],
};

/** 真实队列夹具：两个批次目录（BATCH.md 带 name/purpose 作语义素材） */
function realQueueFixture(): { cfg: { projectRoot: string; queueDir: string; metaDir: string } } {
  const root = mkdtempSync(join(tmpdir(), 'taskq-batch-'));
  for (const [id, name, purpose] of [['batch-001', '预算季', '编制季度预算'], ['batch-002', '复盘', '月度复盘']] as const) {
    const dir = join(root, 'queue', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'BATCH.md'), `---\nname: ${name}\npurpose: ${purpose}\n---\n`);
  }
  // batch-001 落一个真任务（list 对空队列提前返回「队列还是空的」，聚焦断言需要它出镜）
  mkdirSync(join(root, 'queue', 'batch-001', '11-yusuan'), { recursive: true });
  writeFileSync(join(root, 'queue', 'batch-001', '11-yusuan', 'SPEC.md'), `---\nname: 编制预算\ngoal: 编制 Q4 预算\n---\n`);
  return { cfg: { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') } };
}

describe('parseBatchRef：懒人口径批次引用识别', () => {
  it('精确编号：批次002 / batch-003 / 第二批', () => {
    expect(parseBatchRef('把任务拆到批次002')).toEqual({ kind: 'exact', id: 'batch-002' });
    expect(parseBatchRef('跑 batch-003')).toEqual({ kind: 'exact', id: 'batch-003' });
    expect(parseBatchRef('执行第二批')).toEqual({ kind: 'exact', id: 'batch-002' });
  });

  it('相对位次：最新 / 上一 / 最早', () => {
    expect(parseBatchRef('跑最新的那批')).toEqual({ kind: 'latest' });
    expect(parseBatchRef('继续上一批')).toEqual({ kind: 'prev' });
    expect(parseBatchRef('最早的那批')).toEqual({ kind: 'first' });
  });

  it('特征短语：「预算那批」→ fuzzy 预算', () => {
    expect(parseBatchRef('预算那批还没跑完')).toEqual({ kind: 'fuzzy', phrase: '预算' });
  });

  it('批量语境不误伤：「批量执行」不产出批次引用', () => {
    expect(parseBatchRef('批量执行剩下的任务')).toBeUndefined();
  });
});

describe('resolveBatchRef：三层递进落定真实批次', () => {
  it('无引用 → 缺省最新批次', () => {
    const r = resolveBatchRef(fakeCfg, queue, undefined);
    expect(r.id).toBe('batch-002');
    expect(r.matchedBy).toBe('default');
  });

  it('精确编号：存在直落；不存在亮候选清单', () => {
    expect(resolveBatchRef(fakeCfg, queue, { kind: 'exact', id: 'batch-001' }).id).toBe('batch-001');
    const miss = resolveBatchRef(fakeCfg, queue, { kind: 'exact', id: 'batch-009' });
    expect(miss.id).toBe('');
    expect(miss.candidates!.map((c) => c.id)).toEqual(['batch-001', 'batch-002']);
    expect(miss.note).toContain('不存在');
  });

  it('相对位次：latest / prev / first', () => {
    expect(resolveBatchRef(fakeCfg, queue, { kind: 'latest' }).id).toBe('batch-002');
    expect(resolveBatchRef(fakeCfg, queue, { kind: 'prev' }).id).toBe('batch-001');
    expect(resolveBatchRef(fakeCfg, queue, { kind: 'first' }).id).toBe('batch-001');
  });

  it('特征短语语义命中：「预算」→ batch-001（唯一最高分）', () => {
    const r = resolveBatchRef(fakeCfg, queue, { kind: 'fuzzy', phrase: '预算' });
    expect(r.id).toBe('batch-001');
    expect(r.matchedBy).toBe('semantic');
    expect(r.note).toContain('预算');
  });

  it('得分并列 → 候选清单（不瞎猜）', () => {
    const tieQueue: QueueScan = {
      tasks: [],
      modules: [],
      batches: [
        batch('batch-001', { tasks: [task('1', '编制季度预算')] }),
        batch('batch-002', { tasks: [task('2', '季度复盘')] }),
      ],
    };
    const r = resolveBatchRef(fakeCfg, tieQueue, { kind: 'fuzzy', phrase: '季度' });
    expect(r.id).toBe('');
    expect(r.candidates!.length).toBe(2);
  });

  it('零命中 → 全量候选清单', () => {
    const r = resolveBatchRef(fakeCfg, queue, { kind: 'fuzzy', phrase: '外卖' });
    expect(r.id).toBe('');
    expect(r.candidates!.map((c) => c.id)).toEqual(['batch-001', 'batch-002']);
    expect(r.note).toContain('未命中');
  });

  it('只有单批次时「上一批」= 它（注明不报错）', () => {
    const one: QueueScan = { tasks: [], modules: [], batches: [batch('batch-001', { name: '唯一' })] };
    const r = resolveBatchRef(fakeCfg, one, { kind: 'prev' });
    expect(r.id).toBe('batch-001');
    expect(r.note).toContain('只有');
  });

  it('空队列 → 未决 + 建批指引', () => {
    const empty: QueueScan = { tasks: [], modules: [], batches: [] };
    const r = resolveBatchRef(fakeCfg, empty, { kind: 'latest' });
    expect(r.id).toBe('');
    expect(r.note).toContain('还没有任何批次');
  });

  it('最近使用优先：state 记忆 batch-001 → 无引用落 batch-001 而非最新', () => {
    const { cfg } = realQueueFixture();
    writeLastUsedBatch(cfg, 'batch-001');
    const scan = scanQueue(cfg.queueDir, cfg.metaDir);
    const r = resolveBatchRef(cfg, scan, undefined);
    expect(r.id).toBe('batch-001');
    expect(r.matchedBy).toBe('default');
  });

  it('最近使用批次已删 → 回退最新批次', () => {
    const { cfg } = realQueueFixture();
    writeLastUsedBatch(cfg, 'batch-009'); // 已不存在的批次号
    const scan = scanQueue(cfg.queueDir, cfg.metaDir);
    expect(resolveBatchRef(cfg, scan, undefined).id).toBe('batch-002');
  });
});

describe('renderBatchCandidates：候选清单渲染', () => {
  it('带批次名与任务数，NEEDS_INFO 块封装', () => {
    const out = renderBatchCandidates(resolveBatchRef(fakeCfg, queue, { kind: 'fuzzy', phrase: '外卖' }));
    expect(out).toContain('[TASKQ_NEEDS_INFO]');
    expect(out).toContain('batch-001「预算季」');
    expect(out).toContain('batch-002「复盘」');
    expect(out).toContain('未命中任何批次');
  });
});

describe('askCommand：懒人批次端到端', () => {
  it('「预算那批有哪些任务」→ 语义定位 batch-001 并聚焦（batch-002 不出镜）', () => {
    const { cfg } = realQueueFixture();
    const r = askCommand(cfg, '预算那批有哪些任务');
    expect(r.output).toContain('batch-001「预算季」');
    expect(r.output).not.toContain('batch-002');
  });

  it('「外卖那批有哪些任务」→ 零命中亮候选清单（不接力不瞎猜）', () => {
    const { cfg } = realQueueFixture();
    const r = askCommand(cfg, '外卖那批有哪些任务');
    expect(r.output).toContain('[TASKQ_NEEDS_INFO]');
    expect(r.output).toContain('未命中任何批次');
    expect(r.output).toContain('batch-001「预算季」');
  });

  it('空队列 + 模糊批次 → NEEDS_INFO 指引（退出码 0 不接力）', () => {
    const cfg = { projectRoot: '/proj', queueDir: '/proj/queue', metaDir: '/proj/queue/.taskchain' };
    const r = askCommand(cfg, '看下预算那批的进度');
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('[TASKQ_NEEDS_INFO]');
    expect(r.output).toContain('还没有任何批次');
  });

  it('编排 + 未决批次引用 → 剧本照出 + 候选清单块并列', () => {
    const cfg = { projectRoot: '/proj', queueDir: '/proj/queue', metaDir: '/proj/queue/.taskchain' };
    const r = askCommand(cfg, '拆分素材，然后澄清并执行，预算那批');
    expect(r.exitCode).toBe(10);
    expect(r.output).toContain('[TASKQ_ORCHESTRATE]');
    expect(r.output).toContain('[TASKQ_NEEDS_INFO]');
  });
});
