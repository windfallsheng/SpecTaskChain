import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { buildSpec, readSpec } from '../../src/core/task-spec';
import { resolveTaskType } from '../../src/core/task-type';
import { scanQueue } from '../../src/core/queue';
import { inferOutputPath, computeFixes, applyFix } from '../../src/core/fixer';
import { fixCommand } from '../../src/commands/fix';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

// ============================================================
// 纯函数：修复项计算
// ============================================================

describe('fixer 纯函数：A 档修复项计算', () => {
  it('inferOutputPath：非代码类型按输出目录推断，data/代码类型不猜扩展名', () => {
    const spec = buildSpec('01-migrate-guide', '/x', { goal: 'g', type: 'doc', output: '', acceptance: {}, draft: true }, '', 'general');
    expect(inferOutputPath(spec, resolveTaskType('/tmp', 'doc'))).toBe('docs/migrate-guide.md');
    expect(inferOutputPath({ ...spec, type: 'data' }, resolveTaskType('/tmp', 'data'))).toBe('');
    expect(inferOutputPath({ ...spec, type: 'feature' }, resolveTaskType('/tmp', 'feature'))).toBe('');
  });

  it('computeFixes：doc 类型空 spec → 四项（role/output/acceptance/draft）', () => {
    const spec = buildSpec('01-migrate-guide', '/x', { goal: '写迁移手册', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '正文', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'));
    expect(items.map((i) => i.kind)).toEqual(['role', 'output', 'acceptance', 'draft']);
    expect(items.find((i) => i.kind === 'role')?.after).toBe('role: document-writer');
    expect(items.find((i) => i.kind === 'output')?.after).toBe('output: docs/migrate-guide.md');
    expect(items.find((i) => i.kind === 'acceptance')?.after).toContain('path: docs/migrate-guide.md');
  });

  it('computeFixes：general 类型不补 role（generalist 兜底保留 AI 自动选择空间）', () => {
    const spec = buildSpec('01-x', '/x', { goal: 'g', type: 'general', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'general'));
    expect(items.find((i) => i.kind === 'role')).toBeUndefined();
    expect(items.map((i) => i.kind)).toEqual(['output', 'acceptance', 'draft']);
  });

  it('computeFixes：data 类型 output 不可推断 → 只补 role，不补 acceptance/draft', () => {
    const spec = buildSpec('01-d', '/x', { goal: 'g', type: 'data', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'data'));
    expect(items.map((i) => i.kind)).toEqual(['role']);
  });

  it('computeFixes：三必填齐 + role 已指定 → 空（幂等）', () => {
    const spec = buildSpec('01-full', '/x', { goal: 'g', type: 'doc', output: 'docs/a.md', acceptance: { artifacts: [{ path: 'docs/a.md' }], checks: [], review: 'r' }, draft: false, role: 'document-writer' }, '', 'general');
    expect(computeFixes(spec, resolveTaskType('/tmp', 'doc'))).toEqual([]);
  });
});

// ============================================================
// 落盘：行级编辑 / 备份 / 幂等 / 正文不动
// ============================================================

const DRAFT_SPEC = `---
goal: 写迁移手册
type: doc
output:
acceptance:
  artifacts: []
  checks: []
  review: ''
draft: true
---

# 正文

这一行一个字都不能动。
`;

describe('applyFix 行级编辑：落盘 / 备份 / 幂等 / 正文不动', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-fixer-'));
    const dir = join(root, 'queue', 'batch-001', '01-migrate-guide');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'SPEC.md');
    writeFileSync(specPath, DRAFT_SPEC, 'utf-8');
    return { root, dir, specPath };
  };

  it('四类修复一次落盘：output 填充 / acceptance 骨架 / role 插入 / draft 摘除', () => {
    const { root, dir, specPath } = setup();
    const meta = join(root, 'queue', '.taskchain');
    const items = computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'));
    const applied = applyFix(specPath, items);
    expect(applied).toHaveLength(4);
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('output: docs/migrate-guide.md');
    expect(after).toContain('role: document-writer');
    expect(after).toContain('review: 待人工评审');
    expect(after).not.toContain('draft: true');
    // 正文一字不碰
    expect(after).toContain('# 正文');
    expect(after).toContain('这一行一个字都不能动。');
    // 备份 = 原文
    expect(readFileSync(`${specPath}.bak`, 'utf-8')).toBe(DRAFT_SPEC);
  });

  it('幂等：修复后再跑 → 无新改动、文件不变', () => {
    const { root, dir, specPath } = setup();
    const meta = join(root, 'queue', '.taskchain');
    applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc')));
    const once = readFileSync(specPath, 'utf-8');
    const again = applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc')));
    expect(again).toEqual([]);
    expect(readFileSync(specPath, 'utf-8')).toBe(once);
  });

  it('acceptance 已有评审内容 → 骨架不重复写、原文保留', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-fixer-'));
    const dir = join(root, 'queue', 'batch-001', '01-has-review');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'SPEC.md');
    const text = `---
goal: 写迁移手册
type: doc
output:
acceptance:
  review: 已有评审意见
draft: true
---
正文。
`;
    writeFileSync(specPath, text, 'utf-8');
    const meta = join(root, 'queue', '.taskchain');
    const items = computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'));
    expect(items.map((i) => i.kind)).toEqual(['role', 'output', 'draft']);
    applyFix(specPath, items);
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('review: 已有评审意见');
    expect(after).not.toContain('待人工评审');
    expect(after).toContain('正文。');
  });

  it('形状异常（无 frontmatter）→ 不碰文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-fixer-'));
    const dir = join(root, 'queue', 'batch-001', '01-weird');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'SPEC.md');
    const text = '没有 frontmatter\n\n纯文本。\n';
    writeFileSync(specPath, text, 'utf-8');
    const meta = join(root, 'queue', '.taskchain');
    const spec = readSpec(dir, 'general');
    const items = spec ? computeFixes(spec, resolveTaskType(meta, 'doc')) : [];
    expect(applyFix(specPath, items)).toEqual([]);
    expect(readFileSync(specPath, 'utf-8')).toBe(text);
  });
});

// ============================================================
// fixCommand 命令路径：非交互提示 / 预览 / 授权 / 定向
// ============================================================

describe('fixCommand 命令路径：非交互提示 / 预览 / 授权 / 定向', () => {
  const setupTask = () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-fixcmd-'));
    const dir = join(root, 'queue', 'batch-001', '01-migrate-guide');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'SPEC.md');
    writeFileSync(specPath, DRAFT_SPEC, 'utf-8');
    return { root, specPath, c: cfg(root) };
  };

  it('非 TTY 未授权：只提示不落盘（宿主 AI 决策后再 --yes）', () => {
    const { specPath, c } = setupTask();
    const out = fixCommand(c, {});
    expect(out).toContain('可自动修复 4 处');
    expect(out).toContain('应用：taskq fix --yes');
    expect(readFileSync(specPath, 'utf-8')).toBe(DRAFT_SPEC);
  });

  it('--dry-run：预览不落盘', () => {
    const { specPath, c } = setupTask();
    const out = fixCommand(c, { dryRun: true });
    expect(out).toContain('--dry-run：预览不落盘');
    expect(readFileSync(specPath, 'utf-8')).toBe(DRAFT_SPEC);
  });

  it('--yes：静默应用落盘，输出改动摘要', () => {
    const { specPath, c } = setupTask();
    const out = fixCommand(c, { yes: true });
    expect(out).toContain('✅ 已修复 4 处');
    expect(out).toContain('重新体检确认：taskq clarify');
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('output: docs/migrate-guide.md');
    expect(after).not.toContain('draft: true');
  });

  it('修复后无遗留问题', () => {
    const { c } = setupTask();
    fixCommand(c, { yes: true });
    expect(fixCommand(c, { yes: true })).toContain('没有可自动修复的问题');
  });

  it('--task 定向不存在 → 报错提示', () => {
    const { c } = setupTask();
    expect(fixCommand(c, { taskId: '99-ghost' })).toContain('❌ 未找到任务');
  });
});

// ============================================================
// 保留目录：overview 不被扫描为模块（评估报告回归守护）
// ============================================================

describe('queue 扫描：overview 保留目录不是模块', () => {
  it('批次内存在 overview/ 报告目录 → modules 为空、不误报缺公共约束', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-ovr-'));
    const batch = join(root, 'queue', 'batch-001');
    const taskDir = join(batch, '01-x');
    mkdirSync(join(taskDir), { recursive: true });
    writeFileSync(join(taskDir, 'SPEC.md'), '---\ngoal: g\noutput: o\nacceptance:\n  review: r\n---\n正文\n');
    // 评估报告落盘地：queue/{批次}/overview/reports/
    mkdirSync(join(batch, 'overview', 'reports'), { recursive: true });
    const queue = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    expect(queue.tasks).toHaveLength(1);
    expect(queue.modules).toEqual([]);
  });

  it('隐藏目录（.taskchain 等）同样跳过', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-ovr-'));
    const batch = join(root, 'queue', 'batch-001');
    mkdirSync(join(batch, '.hidden'), { recursive: true });
    const queue = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    expect(queue.tasks).toEqual([]);
    expect(queue.modules).toEqual([]);
  });
});
