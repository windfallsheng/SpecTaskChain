// 报告开关四级链：CLI 临时（--no-report/--report）> 任务级（SPEC.md reports: false）> 批次级（config/BATCH.yaml reports）> 系统默认（true）
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { resolveReportSwitch } from '../../src/core/assessment';
import { clarifyCommand } from '../../src/commands/clarify';
import { batchRelay } from '../../src/core/runner';
import { doneCommand } from '../../src/commands/done';
import { BATCH_CONFIG_DIR, BATCH_CONFIG_FILE } from '../../src/core/batch-config';

// 拦截 child_process.spawn（hoisted：防真实 worker 进程炸出）
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn().mockReturnValue({ unref: vi.fn() }) }));
vi.mock('child_process', () => ({ spawn: spawnMock }));

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-rsw-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造一个顶层任务（可选 draft / reports: false） */
function makeTask(cfg: TaskQConfig, id: string, extra: { draft?: boolean; reports?: boolean } = {}): void {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/${id}.md
${extra.reports === false ? 'reports: false\n' : ''}${extra.draft ? 'draft: true\n' : ''}acceptance:
  artifacts:
    - path: docs/${id}.md
---
写 ${id} 的文档
`,
    'utf-8'
  );
}

describe('resolveReportSwitch：纯函数四级链', () => {
  it('无 CLI 无配置 → 系统默认生成', () => {
    expect(resolveReportSwitch({}, {})).toEqual({ enabled: true, reason: '' });
  });

  it('批次配置 reports: false → 关闭（原因指路）', () => {
    const r = resolveReportSwitch({ reports: false }, {});
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain('config/BATCH.yaml');
    expect(r.reason).toContain('--report'); // 关闭时指路临时开启
  });

  it('CLI --no-report 临时关闭（优先级高于批次）', () => {
    const r = resolveReportSwitch({ reports: true }, { noReport: true });
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain('--no-report');
  });

  it('CLI --report 强制开启（覆盖批次关闭）', () => {
    expect(resolveReportSwitch({ reports: false }, { forceReport: true })).toEqual({ enabled: true, reason: '' });
  });
});

describe('clarify 澄清评估报告：三层开关', () => {
  it('默认生成（提示后台生成中）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const out = clarifyCommand(cfg, {});
    expect(out).toContain('评估报告后台生成中');
    expect(spawnMock).toHaveBeenCalled();
  });

  it('批次配置 reports: false → 跳过（提示原因）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    mkdirSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR), { recursive: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR, BATCH_CONFIG_FILE), 'reports: false\n', 'utf-8');
    const out = clarifyCommand(cfg, {});
    expect(out).toContain('评估报告已跳过');
    expect(out).toContain('reports: false');
    expect(out).not.toContain('后台生成中');
  });

  it('CLI --no-report 当次关闭（覆盖默认生成）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const out = clarifyCommand(cfg, { noReport: true });
    expect(out).toContain('评估报告已跳过');
    expect(out).toContain('--no-report');
  });

  it('CLI --report 强制生成（覆盖批次关闭）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    mkdirSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR), { recursive: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR, BATCH_CONFIG_FILE), 'reports: false\n', 'utf-8');
    const out = clarifyCommand(cfg, { forceReport: true });
    expect(out).toContain('评估报告后台生成中');
  });

  it('全部任务 SPEC.md reports: false → 跳过（任务级退出）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { reports: false });
    makeTask(cfg, '02-b', { reports: false });
    const out = clarifyCommand(cfg, {});
    expect(out).toContain('评估报告已跳过');
    expect(out).toContain('reports: false');
  });

  it('部分任务 reports: false → 只筛掉自己，报告照常生成', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { reports: false });
    makeTask(cfg, '02-b');
    const out = clarifyCommand(cfg, {});
    expect(out).toContain('评估报告后台生成中');
  });
});

describe('batchRelay 完成评估报告：三层开关', () => {
  /** 造一个已完成的任务（产出落盘 + done pass → state 有 done 记录） */
  function finishTask(cfg: TaskQConfig, id: string): void {
    mkdirSync(join(cfg.projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(cfg.projectRoot, 'docs', `${id}.md`), 'ok', 'utf-8');
    doneCommand(cfg, { taskId: id, verdict: 'pass' });
  }

  it('队列清空且真执行过 → 默认生成完成评估报告', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    finishTask(cfg, '01-a');
    const r = batchRelay(cfg, {});
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain('评估报告后台生成中');
  });

  it('批次配置 reports: false → 跳过完成评估报告', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    finishTask(cfg, '01-a');
    mkdirSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR), { recursive: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR, BATCH_CONFIG_FILE), 'reports: false\n', 'utf-8');
    const r = batchRelay(cfg, {});
    expect(r.summary).toContain('完成评估报告已跳过');
    expect(r.summary).not.toContain('后台生成中');
  });

  it('CLI --no-report 当次关闭完成评估报告', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    finishTask(cfg, '01-a');
    const r = batchRelay(cfg, { noReport: true });
    expect(r.summary).toContain('完成评估报告已跳过');
  });

  it('执行过的任务全 reports: false → 跳过（任务级退出）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { reports: false });
    finishTask(cfg, '01-a');
    const r = batchRelay(cfg, {});
    expect(r.summary).toContain('完成评估报告已跳过');
  });
});
