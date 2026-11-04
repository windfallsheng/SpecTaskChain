// 批次测试：多批次目录 / 聚焦最新批次 / 编号全局递增 / --batch 指定老批次
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { scanQueue, selectBatch, batchKey, latestBatchId } from '../../src/core/queue';
import { newCommand } from '../../src/commands/new';
import { relayNext, markTaskState } from '../../src/core/runner';
import { listCommand } from '../../src/commands/list';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-batch-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 在某批次下造一个顶层任务（旧式 tasks 与 batch-NNN 通用） */
function makeTask(cfg: TaskQConfig, batch: string, id: string): void {
  const dir = join(cfg.queueDir, batch, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/
acceptance:
  artifacts:
    - path: docs/${id}.md
---
${id}`,
    'utf-8'
  );
}

describe('批次键与最新批次', () => {
  it('batchKey：batch-10 > batch-9 > batch-001 > tasks', () => {
    expect(batchKey('batch-10')).toBeGreaterThan(batchKey('batch-9'));
    expect(batchKey('batch-001')).toBeGreaterThan(batchKey('tasks'));
    expect(batchKey('tasks')).toBe(0);
  });

  it('latestBatchId：数字序最大者胜出；无 batch-* 时 tasks 兜底', () => {
    expect(latestBatchId([
      { id: 'batch-001', tasks: [], modules: [] },
      { id: 'batch-002', tasks: [], modules: [] },
    ])).toBe('batch-002');
    expect(latestBatchId([{ id: 'tasks', tasks: [], modules: [] }])).toBe('tasks');
    expect(latestBatchId([])).toBeNull();
  });
});

describe('扫描：多批次', () => {
  it('scanQueue：批次分组 + 全量合并 + 旧式 tasks 兼容为第 0 批', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-a');
    makeTask(cfg, 'batch-002', '02-b');
    makeTask(cfg, 'tasks', '01-old');
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    expect(queue.batches.map((b) => b.id)).toEqual(['batch-001', 'batch-002', 'tasks']);
    expect(queue.tasks.map((t) => t.id).sort()).toEqual(['01-a', '01-old', '02-b']);
    expect(latestBatchId(queue.batches)).toBe('batch-002');
  });

  it('selectBatch：缺省 = 最新批次；指定老批次；all 全量；不存在返回 null', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-a');
    makeTask(cfg, 'batch-002', '02-b');
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    expect(selectBatch(queue)!.tasks.map((t) => t.id)).toEqual(['02-b']);
    expect(selectBatch(queue, 'batch-001')!.tasks.map((t) => t.id)).toEqual(['01-a']);
    expect(selectBatch(queue, 'all')!.tasks.length).toBe(2);
    expect(selectBatch(queue, 'batch-099')).toBeNull();
  });
});

describe('new：默认落最新批次 + 编号全局递增', () => {
  it('无批次时自动建 batch-001', () => {
    const cfg = makeCfg();
    newCommand(cfg, { goal: '写文档', draft: true });
    expect(existsSync(join(cfg.queueDir, 'batch-001', '01-task-xiewendang', 'SPEC.md'))).toBe(true);
  });

  it('存在 batch-002 时新任务落最新批次，编号接着老批次排（全局唯一）', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-a');
    makeTask(cfg, 'batch-002', '02-b');
    const out = newCommand(cfg, { goal: '新任务', draft: true });
    expect(out).toContain('batch-002');
    expect(existsSync(join(cfg.queueDir, 'batch-002', '03-task-xinrenwu', 'SPEC.md'))).toBe(true);
    expect(existsSync(join(cfg.queueDir, 'batch-001', '03-task-xinrenwu'))).toBe(false);
  });

  it('--batch 指定老批次：新任务落老批次，编号仍全局递增', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-a');
    mkdirSync(join(cfg.queueDir, 'batch-002'));
    const out = newCommand(cfg, { goal: '补老批次', batch: 'batch-001', draft: true });
    expect(out).toContain('batch-001');
    expect(existsSync(join(cfg.queueDir, 'batch-001', '02-task-bulaopici', 'SPEC.md'))).toBe(true);
  });

  it('--batch 不存在的批次 → 报错不落盘', () => {
    const cfg = makeCfg();
    const out = newCommand(cfg, { goal: 'x', batch: 'batch-099', draft: true });
    expect(out).toContain('不存在');
  });
});

describe('run：默认只接力最新批次', () => {
  it('老批次有 todo，默认 run 跳过它、只领最新批次', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-old');
    makeTask(cfg, 'batch-002', '02-new');
    const r = relayNext(cfg);
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('02-new');
  });

  it('--batch 指定老批次：接力老批次的任务', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-old');
    makeTask(cfg, 'batch-002', '02-new');
    const r = relayNext(cfg, { batch: 'batch-001' });
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('01-old');
  });

  it('--batch 不存在 → exit 12 报错', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-old');
    const r = relayNext(cfg, { batch: 'batch-099' });
    expect(r.exitCode).toBe(12);
    expect(r.summary).toContain('不存在');
  });

  it('最新批次清空后默认 run 收尾；--batch all 才轮到老批次', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-old');
    makeTask(cfg, 'batch-002', '02-new');
    markTaskState(cfg, '02-new', 'done', 'pass');
    const r = relayNext(cfg);
    expect(r.exitCode).toBe(0); // 聚焦最新批次：已清空
    const rAll = relayNext(cfg, { batch: 'all' });
    expect(rAll.exitCode).toBe(10);
    expect(rAll.task.spec.id).toBe('01-old');
  });
});

describe('list：批次分组显示 + 最新标注', () => {
  it('多批次分组，最新批次带 ← 标注', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'batch-001', '01-a');
    makeTask(cfg, 'batch-002', '02-b');
    const out = listCommand(cfg);
    expect(out).toContain('批次 batch-001');
    expect(out).toContain('批次 batch-002');
    expect(out).toContain('← 当前批次');
  });
});
