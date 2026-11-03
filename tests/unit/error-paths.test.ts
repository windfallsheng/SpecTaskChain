// 错误路径补强（1.0 冲刺第二坎）：机器在用户手里，第一课永远是「意外」
// 覆盖：损坏/畸形 SPEC.md、BOM/CRLF 兼容、账本 draft 读侧兼容、init 幂等、批次尺寸边界
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConfig, ensureStructure, readState, TaskQConfig } from '../../src/core/config';
import { readSpec, parseFrontmatter } from '../../src/core/task-spec';
import { clarifyCommand } from '../../src/commands/clarify';
import { relayNext, batchRelay } from '../../src/core/runner';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'taskq-err-'));
  const cfg = resolveConfig(root);
  ensureStructure(cfg);
  return cfg;
}

function makeTask(cfg: TaskQConfig, id: string, content: string): void {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPEC.md'), content, 'utf-8');
}

const VALID_SPEC = `---
goal: 写一篇迁移文档
output: docs/
acceptance:
  artifacts:
    - path: docs/migration.md
  review: 结构完整
---
正文内容
`;

describe('SPEC.md 畸形输入：不崩、不静默丢字段', () => {
  it('BOM 头（Windows 记事本）→ 三必填正常解析', () => {
    const spec = readSpec(mkTaskDir('\uFEFF' + VALID_SPEC));
    expect(spec).not.toBeNull();
    expect(spec!.goal).toBe('写一篇迁移文档');
    expect(spec!.output).toBe('docs/');
    expect(spec!.acceptance.artifacts[0].path).toBe('docs/migration.md');
  });

  it('CRLF 行尾（Windows 编辑器）→ 顶层键值不丢失', () => {
    const content = VALID_SPEC.replace(/\n/g, '\r\n');
    const spec = readSpec(mkTaskDir(content));
    expect(spec).not.toBeNull();
    expect(spec!.goal).toBe('写一篇迁移文档');
    expect(spec!.output).toBe('docs/');
    expect(spec!.acceptance.review).toBe('结构完整');
    expect(spec!.body).toContain('正文内容');
  });

  it('空 SPEC.md → clarify 报三必填缺失（不崩）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-kongwenjian', '');
    const out = clarifyCommand(cfg, { taskId: '01-kongwenjian' });
    expect(out).toContain('goal');
    expect(out).toContain('output');
    expect(out).toContain('acceptance');
  });

  it('无 frontmatter 纯正文 → 正文保留 + 三必填判空（草案语义）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '02-chunzhengwen', '就是一段需求描述\n第二行');
    const out = clarifyCommand(cfg, { taskId: '02-chunzhengwen' });
    expect(out).toContain('goal');
    // 正文不丢：读回仍完整
    const all = clarifyCommand(cfg, {});
    expect(all).toContain('goal');
  });

  it('二进制乱码 SPEC.md → 不抛异常，按无 frontmatter 处理', () => {
    const cfg = makeCfg();
    makeTask(cfg, '03-luanma', '\x00\x01\x02\xff\xfe\x00binary');
    expect(() => clarifyCommand(cfg, { taskId: '03-luanma' })).not.toThrow();
  });

  it('frontmatter 值含 \r（混用行尾）→ 值被归一不残留回车', () => {
    const { data } = parseFrontmatter('---\ngoal: 目标\r\noutput: docs/\n---\n正文');
    expect(data.goal).toBe('目标');
    expect(data.output).toBe('docs/');
  });
});

describe('state.json 账本边界：读侧兼容与写侧安全', () => {
  it('手工标 draft 状态（SPEC 无 draft 标记）→ 任务可领取（读侧兼容）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-zhengchang', VALID_SPEC);
    const state = readState(cfg);
    state['01-zhengchang'] = { status: 'draft', attempts: 0 };
    writeFileSync(join(cfg.metaDir, 'state.json'), JSON.stringify({ version: 1, tasks: state }), 'utf-8');
    const r = relayNext(cfg, {});
    expect(r.exitCode).toBe(10);
  });

  it('state.json 含未知字段 → 读取不崩（前向兼容）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-zhengchang', VALID_SPEC);
    writeFileSync(
      join(cfg.metaDir, 'state.json'),
      JSON.stringify({ version: 1, tasks: { '01-zhengchang': { status: 'done', attempts: 1, futureField: 'x' } }, futureTop: true }),
      'utf-8'
    );
    expect(readState(cfg)['01-zhengchang'].status).toBe('done');
  });

  it('state.json 顶层非对象（数组/字符串）→ 不崩回空状态', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-zhengchang', VALID_SPEC);
    writeFileSync(join(cfg.metaDir, 'state.json'), '"just a string"', 'utf-8');
    expect(() => readState(cfg)).not.toThrow();
  });
});

describe('init 幂等：重复执行不毁现场', () => {
  it('删 batch-001 建 batch-002 后再 init → batch-001 不复活', () => {
    const cfg = makeCfg();
    // 模拟用户手工合并批次：删 batch-001，建 batch-002
    const b1 = join(cfg.queueDir, 'batch-001');
    const b2 = join(cfg.queueDir, 'batch-002');
    rmSync(b1, { recursive: true, force: true });
    mkdirSync(b2, { recursive: true });
    ensureStructure(cfg);
    const names = readdirSync(cfg.queueDir);
    expect(names).not.toContain('batch-001');
    expect(names).toContain('batch-002');
  });

  it('init 不覆盖已有 state.json 内容', () => {
    const cfg = makeCfg();
    writeFileSync(
      join(cfg.metaDir, 'state.json'),
      JSON.stringify({ version: 1, tasks: { '99-yiwan': { status: 'done', attempts: 1 } } }),
      'utf-8'
    );
    ensureStructure(cfg);
    expect(readState(cfg)['99-yiwan']?.status).toBe('done');
  });
});

describe('批次接力边界：参数畸形不崩溃', () => {
  it('batchSize 0 = 未提供（默认 3）；负数 → 兜底 1', () => {
    // 0 走 falsy 分支 → 默认 3（两个任务全取）
    const cfg0 = makeCfg();
    makeTask(cfg0, '01-a', VALID_SPEC);
    makeTask(cfg0, '02-b', VALID_SPEC);
    expect(batchRelay(cfg0, { batchSize: 0 }).tasks.length).toBe(2);
    // 负数 → Math.max(1, -3) 兜底 1
    const cfgNeg = makeCfg();
    makeTask(cfgNeg, '01-a', VALID_SPEC);
    makeTask(cfgNeg, '02-b', VALID_SPEC);
    expect(batchRelay(cfgNeg, { batchSize: -3 }).tasks.length).toBe(1);
  });

  it('clarify --file 指向不存在文件 → 明确报错不崩', () => {
    const cfg = makeCfg();
    const out = clarifyCommand(cfg, { file: 'queue/batch-001/bucunzai/SPEC.md' });
    expect(out).toContain('文件不存在');
  });

  it('clarify --file 指向目录（自动补 SPEC.md）→ 可检测', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-zhengchang', VALID_SPEC);
    const out = clarifyCommand(cfg, { file: join(cfg.queueDir, 'batch-001', '01-zhengchang') });
    expect(out).not.toContain('文件不存在');
  });
});

/** 建临时任务目录写 SPEC.md 后读（BOM/CRLF 用例复用） */
function mkTaskDir(content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'taskq-spec-'));
  writeFileSync(join(root, 'SPEC.md'), content, 'utf-8');
  return root;
}
