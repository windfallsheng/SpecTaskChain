// 操作轨迹账：appendOpLog（追加）+ readOpLog（倒序/过滤/截断/容错）+ historyCommand（渲染）+ 写点集成
// 设计：op-log 记时间线（何时发生了什么），state.json 记当前态（现在是什么状态）——两本账各管一半
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendOpLog, readOpLog } from '../../src/core/oplog';
import { historyCommand } from '../../src/commands/history';
import { newCommand } from '../../src/commands/new';
import { askCommand } from '../../src/commands/ask';

function fixture(): { cfg: { projectRoot: string; queueDir: string; metaDir: string } } {
  const root = mkdtempSync(join(tmpdir(), 'taskq-oplog-'));
  const cfg = { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
  mkdirSync(cfg.metaDir, { recursive: true });
  return { cfg };
}

describe('oplog 数据层', () => {
  it('空账：文件不存在返回 []', () => {
    const { cfg } = fixture();
    expect(readOpLog(cfg)).toEqual([]);
  });

  it('追加后读：倒序（最新在上）+ 自动时间戳 + 字段完整', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001', note: '建任务' });
    appendOpLog(cfg, { cmd: 'done', target: 'task-a', batch: 'batch-001', note: '验收通过' });
    const entries = readOpLog(cfg);
    expect(entries).toHaveLength(2);
    expect(entries[0].cmd).toBe('done'); // 倒序：最新在上
    expect(entries[1].cmd).toBe('new');
    expect(entries[0].ts).toBeTruthy();
    expect(entries[0].target).toBe('task-a');
    expect(entries[0].note).toBe('验收通过');
  });

  it('limit 截断（保留最新 N 条）', () => {
    const { cfg } = fixture();
    for (let i = 0; i < 5; i++) appendOpLog(cfg, { cmd: 'new', target: `t${i}` });
    const top = readOpLog(cfg, { limit: 2 });
    expect(top).toHaveLength(2);
    expect(top[0].target).toBe('t4'); // 最新在上
    expect(top[1].target).toBe('t3');
  });

  it('batch 过滤（跨批次操作不匹配）', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'a', batch: 'batch-001' });
    appendOpLog(cfg, { cmd: 'new', target: 'b', batch: 'batch-002' });
    appendOpLog(cfg, { cmd: 'reset', target: '--all' }); // 跨批次操作不记 batch
    const filtered = readOpLog(cfg, { batch: 'batch-001' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].target).toBe('a');
  });

  it('target 过滤：任务一生追踪', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001' });
    appendOpLog(cfg, { cmd: 'done', target: 'task-a', batch: 'batch-001' });
    appendOpLog(cfg, { cmd: 'new', target: 'task-b', batch: 'batch-001' });
    const traced = readOpLog(cfg, { target: 'task-a' });
    expect(traced).toHaveLength(2);
    expect(traced.every((e) => e.target === 'task-a')).toBe(true);
  });

  it('since 过滤：时间窗（UTC 日界，含当天）', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'old' });
    // 手写两条不同日期的记录验证边界
    const logPath = `${cfg.metaDir}/op-log.json`;
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(logPath, [
      JSON.stringify({ ts: '2020-01-01T00:00:00.000Z', cmd: 'new', target: 'old' }),
      JSON.stringify({ ts: `${today}T00:00:00.000Z`, cmd: 'new', target: 'today' }),
    ].join('\n') + '\n', 'utf-8');
    const win = readOpLog(cfg, { since: today });
    expect(win).toHaveLength(1);
    expect(win[0].target).toBe('today');
  });

  it('损坏行跳过不炸全账', () => {
    const { cfg } = fixture();
    writeFileSync(join(cfg.metaDir, 'op-log.json'), '{"ts":"broken json\n{"ts":"2026-01-01T00:00:00.000Z","cmd":"new","target":"ok"}\n', 'utf-8');
    const entries = readOpLog(cfg);
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe('ok');
  });
});

describe('historyCommand 渲染', () => {
  it('空账提示', () => {
    const { cfg } = fixture();
    const out = historyCommand(cfg);
    expect(out).toContain('还没有操作记录');
    expect(out).toContain('taskq new');
  });

  it('时间线渲染：命令标签 + 批次 + 备注 + 倒序', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001', note: '写文档' });
    appendOpLog(cfg, { cmd: 'done', target: 'task-a', batch: 'batch-001', note: '验收通过，实际工时 2h' });
    const out = historyCommand(cfg);
    expect(out).toContain('验收');
    expect(out).toContain('新建');
    expect(out).toContain('[batch-001]');
    expect(out).toContain('实际工时 2h');
    expect(out.indexOf('验收')).toBeLessThan(out.indexOf('新建')); // 倒序：验收行在上
  });

  it('limit 截断提示总数', () => {
    const { cfg } = fixture();
    for (let i = 0; i < 3; i++) appendOpLog(cfg, { cmd: 'new', target: `t${i}` });
    const out = historyCommand(cfg, { limit: 2 });
    expect(out).toContain('共 3 条');
  });

  it('--task 渲染：任务一生 + 无轨迹提示', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001' });
    const out = historyCommand(cfg, { task: 'task-a' });
    expect(out).toContain('任务 task-a 的一生');
    const miss = historyCommand(cfg, { task: 'ghost' });
    expect(miss).toContain('没有「ghost」的轨迹记录');
  });

  it('--since 渲染：时间窗标签', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a' });
    const out = historyCommand(cfg, { since: '2026-11-01' });
    expect(out).toContain('（2026-11-01 起）');
  });
});

describe('ask 口语接入集成', () => {
  it('ask「最近做了什么」→ 全批次流水', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001', note: '写文档' });
    const r = askCommand(cfg, '最近做了什么');
    expect(r.output).toContain('操作轨迹');
    expect(r.output).toContain('新建');
  });

  it('ask「task-a 怎么了」→ 任务一生追踪（不混入他任务）', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001' });
    appendOpLog(cfg, { cmd: 'new', target: 'task-b', batch: 'batch-001' });
    const r = askCommand(cfg, 'task-a 怎么了');
    expect(r.output).toContain('任务 task-a 的一生');
    expect(r.output).not.toContain('task-b');
  });

  it('ask「昨天做了什么」→ 时间窗流水', () => {
    const { cfg } = fixture();
    appendOpLog(cfg, { cmd: 'new', target: 'task-a', batch: 'batch-001' });
    const r = askCommand(cfg, '昨天做了什么');
    expect(r.output).toContain('操作轨迹');
    expect(r.output).toContain('起');
  });
});

describe('写点挂载集成', () => {
  it('new 建任务落轨迹（含批次与描述）', () => {
    const { cfg } = fixture();
    const out = newCommand(cfg, { goal: '写三篇迁移文档' });
    expect(out).toContain('已入队');
    const entries = readOpLog(cfg);
    expect(entries).toHaveLength(1);
    expect(entries[0].cmd).toBe('new');
    expect(entries[0].batch).toBe('batch-001');
    expect(entries[0].note).toContain('写三篇迁移文档');
  });
});
