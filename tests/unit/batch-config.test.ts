// BATCH.yaml 批次配置：系统默认 / 三级兜底 / 优先级链 / 幂等落盘
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig, ensureStructure } from '../../src/core/config';
import { parseBatchConfig, readBatchConfig, locateBatchConfig, renderBatchConfig, ensureBatchConfig, SYSTEM_BATCH_DEFAULTS, BATCH_CONFIG_VERSION, BATCH_CONFIG_FILE } from '../../src/core/batch-config';
import { batchRelay, relayNext } from '../../src/core/runner';
import { doneCommand } from '../../src/commands/done';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-bcfg-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造一个顶层任务（可选 draft） */
function makeTask(cfg: TaskQConfig, id: string, extra: { draft?: boolean } = {}): void {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/${id}.md
${extra.draft ? 'draft: true\n' : ''}acceptance:
  artifacts:
    - path: docs/${id}.md
---
写 ${id} 的文档
`,
    'utf-8'
  );
}

describe('parseBatchConfig：字段级兜底', () => {
  it('正常解析：三键全生效', () => {
    const c = parseBatchConfig('version: 1\nbatch-size: 5\nmax-attempts: 2\nskip-draft: true\n');
    expect(c['batch-size']).toBe(5);
    expect(c['max-attempts']).toBe(2);
    expect(c['skip-draft']).toBe(true);
  });

  it('单个字段异常只回落该字段，其余照常生效（用户手改一半也要尊重）', () => {
    const c = parseBatchConfig('batch-size: 5\nmax-attempts: -1\nskip-draft: 随便写的\n');
    expect(c['batch-size']).toBe(5); // 正常字段保留
    expect(c['max-attempts']).toBe(SYSTEM_BATCH_DEFAULTS['max-attempts']); // 负数回落默认
    expect(c['skip-draft']).toBe(false); // 非布尔回落默认
  });

  it('0 / 非数 / 空文本全部回落系统默认', () => {
    expect(parseBatchConfig('batch-size: 0\n')).toEqual(SYSTEM_BATCH_DEFAULTS);
    expect(parseBatchConfig('batch-size: abc\n')).toEqual(SYSTEM_BATCH_DEFAULTS);
    expect(parseBatchConfig('')).toEqual(SYSTEM_BATCH_DEFAULTS);
  });
});

describe('readBatchConfig / locateBatchConfig：文件级兜底', () => {
  it('文件缺失 → 系统默认（静默回落）', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.queueDir, 'batch-001'), { recursive: true });
    expect(readBatchConfig(join(cfg.queueDir, 'batch-001'))).toEqual(SYSTEM_BATCH_DEFAULTS);
  });

  it('从任务目录向上爬升找到所属批次配置', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 7\n', 'utf-8');
    // 任务目录 queue/batch-001/01-a 向上两级到批次目录
    const c = locateBatchConfig(join(cfg.queueDir, 'batch-001', '01-a'), cfg.queueDir);
    expect(c['batch-size']).toBe(7);
  });

  it('队列根也找不到 → 系统默认', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const c = locateBatchConfig(join(cfg.queueDir, 'batch-001', '01-a'), cfg.queueDir);
    expect(c).toEqual(SYSTEM_BATCH_DEFAULTS);
  });
});

describe('renderBatchConfig / ensureBatchConfig：模板与幂等', () => {
  it('模板含 version 戳 + 三键 + 详细注释', () => {
    const t = renderBatchConfig();
    expect(t).toContain(`version: ${BATCH_CONFIG_VERSION}`);
    expect(t).toContain('batch-size: 3');
    expect(t).toContain('max-attempts: 3');
    expect(t).toContain('skip-draft: false');
    expect(t).toContain('优先级链'); // 注释讲清覆盖关系
    expect(t).toContain('taskq execute --batch-size'); // 注释讲清临时覆盖命令
  });

  it('overrides 定制首版配置', () => {
    const t = renderBatchConfig({ 'batch-size': 9 });
    expect(t).toContain('batch-size: 9');
    expect(t).toContain('max-attempts: 3'); // 未覆盖的取系统默认
  });

  it('ensureBatchConfig 幂等：已存在绝不覆盖用户手改', () => {
    const cfg = makeCfg();
    const batchDir = join(cfg.queueDir, 'batch-001');
    mkdirSync(batchDir, { recursive: true });
    expect(ensureBatchConfig(batchDir)).toBe(true); // 首次生成
    writeFileSync(join(batchDir, BATCH_CONFIG_FILE), 'batch-size: 11\n', 'utf-8'); // 用户手改
    expect(ensureBatchConfig(batchDir)).toBe(false); // 二次调用跳过
    expect(readFileSync(join(batchDir, BATCH_CONFIG_FILE), 'utf-8')).toBe('batch-size: 11\n'); // 手改保留
  });
});

describe('batchRelay 优先级链：CLI > 批次配置 > 系统默认', () => {
  it('无 CLI 无配置 → 系统默认领 3 个', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c', '04-d'].forEach((id) => makeTask(cfg, id));
    const r = batchRelay(cfg, {});
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b', '03-c']);
  });

  it('批次配置 batch-size: 2 → 领 2 个（CLI 未给）', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c'].forEach((id) => makeTask(cfg, id));
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 2\n', 'utf-8');
    const r = batchRelay(cfg, {});
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b']);
  });

  it('CLI --batch-size 3 覆盖批次配置 2', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c'].forEach((id) => makeTask(cfg, id));
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 2\n', 'utf-8');
    const r = batchRelay(cfg, { batchSize: 3 });
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b', '03-c']);
  });

  it('批次配置 skip-draft: true → draft 任务照领', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    makeTask(cfg, '02-b');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'skip-draft: true\n', 'utf-8');
    const r = batchRelay(cfg, {});
    expect(r.exitCode).toBe(10);
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b']);
  });

  it('无配置时 draft 仍拦停（默认姿势不变）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    const r = batchRelay(cfg, {});
    expect(r.exitCode).toBe(12);
    expect(r.summary).toContain('draft');
  });

  it('relayNext 单任务模式同样吃批次配置（skip-draft）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'skip-draft: true\n', 'utf-8');
    const r = relayNext(cfg, {});
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('01-a');
  });
});

describe('done 验收上限：max-attempts 配置生效', () => {
  it('max-attempts: 1 → 第一次验收失败即标记 failed', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a'); // 产出 docs/01-a.md 不存在 → 验收必不过
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'max-attempts: 1\n', 'utf-8');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail 不合格' });
    expect(out).toContain('已达尝试上限（1 次）');
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(state.tasks['01-a'].status).toBe('failed');
  });

  it('max-attempts: 5 → 第一次失败不标记 failed（提示 1/5）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'max-attempts: 5\n', 'utf-8');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail 不合格' });
    expect(out).toContain('第 1/5 次尝试');
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(state.tasks['01-a'].status).toBe('failed'); // 未达上限，状态仍为 failed（可重试）但 attempts=1
    expect(state.tasks['01-a'].attempts).toBe(1);
  });

  it('无配置 → 系统默认 3 次', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail 不合格' });
    expect(out).toContain('第 1/3 次尝试');
  });
});

describe('ensureStructure 建批次自动落配置', () => {
  it('新队列 init 后 batch-001 自带 BATCH.yaml', () => {
    const cfg = makeCfg();
    ensureStructure(cfg);
    expect(existsSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE))).toBe(true);
  });

  it('已有批次缺配置 → 幂等补齐；已有配置 → 不动', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.queueDir, 'batch-001'), { recursive: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 21\n', 'utf-8');
    ensureStructure(cfg);
    expect(readFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'utf-8')).toBe('batch-size: 21\n');
  });
});
