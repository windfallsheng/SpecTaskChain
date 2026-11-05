import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { buildSpec, readSpec } from '../../src/core/task-spec';
import { resolveTaskType } from '../../src/core/task-type';
import { scanQueue } from '../../src/core/queue';
import { inferOutputPath, computeFixes, applyFix, resolveFixSwitch } from '../../src/core/fixer';
import { extractStatedPaths } from '../../src/core/output-location';
import { fixCommand } from '../../src/commands/fix';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

// ============================================================
// 纯函数：修复项计算
// ============================================================

describe('fixer 纯函数：A 档修复项计算', () => {
  it('extractStatedPaths：产出动词 + 路径 → 提取；输入引用（读/参考）不误提取', () => {
    expect(extractStatedPaths('把说明写到 docs/use-manual.md 里')).toEqual(['docs/use-manual.md']);
    expect(extractStatedPaths('优化 src/api/login.ts 的响应速度')).toEqual(['src/api/login.ts']);
    expect(extractStatedPaths('读 data/sales.csv 汇总成周报')).toEqual([]);
    expect(extractStatedPaths('参考 research/jingping.md 的框架写分析')).toEqual([]);
  });

  it('inferOutputPath：非代码类型落到任务目录内 outputs/{slug}.md；data/代码类型返回院落目录不猜文件名', () => {
    const dir = join('/proj', 'queue', 'batch-002', 'task-migrate-guide');
    const spec = buildSpec('01-migrate-guide', dir, { goal: 'g', type: 'doc', output: '', acceptance: {}, draft: true }, '', 'general');
    expect(inferOutputPath(spec, resolveTaskType('/tmp', 'doc'), '/proj')).toBe('queue/batch-002/task-migrate-guide/outputs/migrate-guide.md');
    expect(inferOutputPath({ ...spec, type: 'data' }, resolveTaskType('/tmp', 'data'), '/proj')).toBe('queue/batch-002/task-migrate-guide/outputs/');
    expect(inferOutputPath({ ...spec, type: 'feature' }, resolveTaskType('/tmp', 'feature'), '/proj')).toBe('queue/batch-002/task-migrate-guide/outputs/');
  });

  it('computeFixes：doc 类型空 spec → 四项（role/output/acceptance/draft）', () => {
    const spec = buildSpec('01-migrate-guide', join('/proj', 'queue', 'batch-001', '01-migrate-guide'), { goal: '写迁移手册', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '正文', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'), '/proj');
    expect(items.map((i) => i.kind)).toEqual(['role', 'output', 'acceptance', 'draft']);
    expect(items.find((i) => i.kind === 'role')?.after).toBe('role: document-writer');
    expect(items.find((i) => i.kind === 'output')?.after).toBe('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
    expect(items.find((i) => i.kind === 'acceptance')?.after).toContain('path: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
  });

  it('computeFixes：general 类型不补 role（generalist 兜底保留 AI 自动选择空间）', () => {
    const spec = buildSpec('01-x', '/x', { goal: 'g', type: 'general', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'general'));
    expect(items.find((i) => i.kind === 'role')).toBeUndefined();
    expect(items.map((i) => i.kind)).toEqual(['output', 'acceptance', 'draft']);
  });

  it('computeFixes：output 空 + 描述指出产出路径 → 按用户指定补（不按类型推断）', () => {
    const spec = buildSpec('01-bangong-shuoming', '/x', { goal: '把交接说明写到 docs/jiaojie-shuoming.md 里', type: 'general', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '正文', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'general'));
    const out = items.find((i) => i.kind === 'output');
    expect(out?.after).toBe('output: docs/jiaojie-shuoming.md');
    expect(out?.description).toContain('任务描述指出的产出位置');
  });

  it('computeFixes：描述里的输入引用（读 xx.csv）不误当产出路径', () => {
    const dir = join('/proj', 'queue', 'batch-001', '01-zhoubao');
    const spec = buildSpec('01-zhoubao', dir, { goal: '读 data/sales.csv 汇总成周报', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'), '/proj');
    const out = items.find((i) => i.kind === 'output');
    expect(out?.after).toBe('output: queue/batch-001/01-zhoubao/outputs/zhoubao.md');
  });

  it('computeFixes：默认落位 → 任务目录内 outputs/{slug}.md（产出与任务同住）', () => {
    const dir = join('/proj', 'queue', 'batch-002', 'task-guichao');
    const spec = buildSpec('01-guichao', dir, { goal: '写一份周报', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'), '/proj');
    const out = items.find((i) => i.kind === 'output');
    expect(out?.after).toBe('output: queue/batch-002/task-guichao/outputs/guichao.md');
  });

  it('computeFixes：模块子任务默认落位 → 子任务目录内 outputs/（层级保留）', () => {
    const dir = join('/proj', 'queue', 'batch-003', 'module-budget', 'yusuan-cesuan');
    const spec = buildSpec('yusuan-cesuan', dir, { goal: '写一份测算报告', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'), '/proj');
    const out = items.find((i) => i.kind === 'output');
    expect(out?.after).toBe('output: queue/batch-003/module-budget/yusuan-cesuan/outputs/yusuan-cesuan.md');
  });

  it('computeFixes：描述指定路径 → 批次覆盖与归巢都不介入（用户指定优先）', () => {
    const spec = buildSpec('03-zhiding', '/x', { goal: '把说明写到 docs/jiaojie.md 里', type: 'doc', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'doc'));
    const out = items.find((i) => i.kind === 'output');
    expect(out?.after).toBe('output: docs/jiaojie.md'); // 用户指定优先，不套目录
  });

  it('computeFixes：data 类型落任务目录内 outputs/ 院落（扩展名不可断定不猜文件名）', () => {
    const spec = buildSpec('01-d', join('/proj', 'queue', 'batch-001', '01-d'), { goal: 'g', type: 'data', output: '', acceptance: { artifacts: [], checks: [], review: '' }, draft: true }, '', 'general');
    const items = computeFixes(spec, resolveTaskType('/tmp', 'data'), '/proj');
    expect(items.map((i) => i.kind)).toEqual(['role', 'output', 'acceptance', 'draft']);
    expect(items.find((i) => i.kind === 'output')?.after).toBe('output: queue/batch-001/01-d/outputs/');
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

describe('applyFix 行级编辑：落盘 / sources 归档 / 幂等 / 正文不动', () => {
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
    const items = computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'), root);
    const applied = applyFix(specPath, items);
    expect(applied).toHaveLength(4);
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
    expect(after).toContain('role: document-writer');
    expect(after).toContain('review: 待人工评审');
    expect(after).not.toContain('draft: true');
    // 正文一字不碰
    expect(after).toContain('# 正文');
    expect(after).toContain('这一行一个字都不能动。');
    // 归档 = 原文（任务目录 sources/SPEC.md，不是同目录 .bak）
    expect(readFileSync(join(dir, 'sources', 'SPEC.md'), 'utf-8')).toBe(DRAFT_SPEC);
    expect(existsSync(`${specPath}.bak`)).toBe(false);
  });

  it('幂等：修复后再跑 → 无新改动、文件不变、sources 归档不刷新', () => {
    const { root, dir, specPath } = setup();
    const meta = join(root, 'queue', '.taskchain');
    applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'), root));
    const once = readFileSync(specPath, 'utf-8');
    const archiveOnce = readFileSync(join(dir, 'sources', 'SPEC.md'), 'utf-8');
    const again = applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'), root));
    expect(again).toEqual([]);
    expect(readFileSync(specPath, 'utf-8')).toBe(once);
    expect(readFileSync(join(dir, 'sources', 'SPEC.md'), 'utf-8')).toBe(archiveOnce); // 无改动不刷新归档
  });

  it('fix 留痕：frontmatter 追加 fix-log 累积日志，正文不碰，幂等不重复加', () => {
    const { root, dir, specPath } = setup();
    const meta = join(root, 'queue', '.taskchain');
    applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'), root));
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('fix-log:');
    expect(after).toContain('补 role: document-writer'); // 条目含日期与应用描述
    expect(after).toContain('补 output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
    expect(after).toContain('# 正文');
    expect(after).toContain('这一行一个字都不能动。'); // 正文一字不碰
    expect(after.split('\n').filter((l) => /^  - "/.test(l))).toHaveLength(1);
    // 幂等：再跑无改动 → 不追加日志
    applyFix(specPath, computeFixes(readSpec(dir, 'general')!, resolveTaskType(meta, 'doc'), root));
    expect(readFileSync(specPath, 'utf-8')).toBe(after);
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

  it('形状异常（无 frontmatter）→ 不碰文件、不产生 sources 归档', () => {
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
    expect(existsSync(join(dir, 'sources'))).toBe(false); // 无改动不产生归档目录
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
    expect(after).toContain('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md'); // 默认落位：任务目录内 outputs/
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
// 覆盖开关四级链：CLI 临时 > 任务级 > 批次级 > 系统默认
// ============================================================

describe('resolveFixSwitch：纯函数四级链', () => {
  it('无 CLI 无配置 → 系统默认覆盖', () => {
    expect(resolveFixSwitch({}, {})).toEqual({ enabled: true, reason: '' });
  });

  it('批次配置 overwrite: false → 关闭（原因指路）', () => {
    const r = resolveFixSwitch({ overwrite: false }, {});
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain('config/BATCH.yaml');
    expect(r.reason).toContain('--overwrite');
  });

  it('CLI --no-overwrite 临时关闭（优先级高于批次）', () => {
    const r = resolveFixSwitch({ overwrite: true }, { noOverwrite: true });
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain('--no-overwrite');
  });

  it('CLI --overwrite 强制覆盖（压过批次关闭）', () => {
    expect(resolveFixSwitch({ overwrite: false }, { forceOverwrite: true })).toEqual({ enabled: true, reason: '' });
  });
});

describe('fixCommand 覆盖开关：批次级 / CLI 临时 / 任务级', () => {
  const setupTask = () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-fixow-'));
    const dir = join(root, 'queue', 'batch-001', '01-migrate-guide');
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, 'SPEC.md');
    writeFileSync(specPath, DRAFT_SPEC, 'utf-8');
    return { root, dir, specPath, c: cfg(root) };
  };

  it('批次配置 overwrite: false → --yes 也不落盘，提示原因', () => {
    const { root, specPath, c } = setupTask();
    mkdirSync(join(root, 'queue', 'batch-001', 'config'), { recursive: true });
    writeFileSync(join(root, 'queue', 'batch-001', 'config', 'BATCH.yaml'), 'overwrite: false\n', 'utf-8');
    const out = fixCommand(c, { yes: true });
    expect(out).toContain('处方未应用');
    expect(out).toContain('overwrite: false');
    expect(readFileSync(specPath, 'utf-8')).toBe(DRAFT_SPEC); // 文件一字不动
  });

  it('CLI --no-overwrite 当次关闭（覆盖默认）', () => {
    const { specPath, c } = setupTask();
    const out = fixCommand(c, { yes: true, noOverwrite: true });
    expect(out).toContain('处方未应用');
    expect(out).toContain('--no-overwrite');
    expect(readFileSync(specPath, 'utf-8')).toBe(DRAFT_SPEC);
  });

  it('CLI --overwrite 强制覆盖（压过批次关闭）', () => {
    const { root, specPath, c } = setupTask();
    mkdirSync(join(root, 'queue', 'batch-001', 'config'), { recursive: true });
    writeFileSync(join(root, 'queue', 'batch-001', 'config', 'BATCH.yaml'), 'overwrite: false\n', 'utf-8');
    const out = fixCommand(c, { yes: true, forceOverwrite: true });
    expect(out).toContain('✅ 已修复 4 处');
    expect(readFileSync(specPath, 'utf-8')).toContain('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
  });

  it('任务级 SPEC.md overwrite: false → 处方跳过不落盘（--yes 也拦）', () => {
    const { dir, c } = setupTask();
    writeFileSync(join(dir, 'SPEC.md'), `---\ntype: doc\noverwrite: false\ngoal: 写迁移手册\noutput:\nacceptance:\n  artifacts: []\n  checks: []\n  review: ''\ndraft: true\n---\n正文。\n`, 'utf-8');
    const out = fixCommand(c, { yes: true });
    expect(out).toContain('overwrite: false');
    expect(readFileSync(join(dir, 'SPEC.md'), 'utf-8')).not.toContain('queue/batch-001/01-migrate-guide/outputs/migrate-guide.md'); // 未被覆盖
  });

  it('默认（无配置）：--yes 覆盖落盘 + sources/ 归档原文件', () => {
    const { dir, specPath, c } = setupTask();
    const out = fixCommand(c, { yes: true });
    expect(out).toContain('✅ 已修复 4 处');
    expect(readFileSync(join(dir, 'sources', 'SPEC.md'), 'utf-8')).toBe(DRAFT_SPEC);
    expect(readFileSync(specPath, 'utf-8')).not.toBe(DRAFT_SPEC);
  });

  it('定向修单任务：用任务所属批次配置（不被其它批次配置牵连）', () => {
    const { root, specPath, c } = setupTask();
    // batch-002 关闭：定向修 batch-002 的任务应被拦
    const d2 = join(root, 'queue', 'batch-002', '02-guide');
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d2, 'SPEC.md'), DRAFT_SPEC, 'utf-8');
    mkdirSync(join(root, 'queue', 'batch-002', 'config'), { recursive: true });
    writeFileSync(join(root, 'queue', 'batch-002', 'config', 'BATCH.yaml'), 'overwrite: false\n', 'utf-8');
    const out2 = fixCommand(c, { yes: true, taskId: '02-guide' });
    expect(out2).toContain('处方未应用');
    expect(readFileSync(join(d2, 'SPEC.md'), 'utf-8')).toBe(DRAFT_SPEC); // 未被覆盖
    // batch-001 默认开：定向修 batch-001 的任务照常覆盖
    const out1 = fixCommand(c, { yes: true, taskId: '01-migrate-guide' });
    expect(out1).toContain('✅ 已修复 4 处');
    expect(readFileSync(specPath, 'utf-8')).toContain('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
  });

  it('全队修混合批次：各任务按各自批次判定（开的修、关的拦）', () => {
    const { root, specPath, c } = setupTask();
    const d2 = join(root, 'queue', 'batch-002', '02-guide');
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d2, 'SPEC.md'), DRAFT_SPEC, 'utf-8');
    mkdirSync(join(root, 'queue', 'batch-002', 'config'), { recursive: true });
    writeFileSync(join(root, 'queue', 'batch-002', 'config', 'BATCH.yaml'), 'overwrite: false\n', 'utf-8');
    const out = fixCommand(c, { yes: true });
    expect(out).toContain('✅ 已修复 4 处');
    expect(out).toContain('02-guide'); // 被拦任务点名
    expect(readFileSync(specPath, 'utf-8')).toContain('output: queue/batch-001/01-migrate-guide/outputs/migrate-guide.md');
    expect(readFileSync(join(d2, 'SPEC.md'), 'utf-8')).toBe(DRAFT_SPEC); // 未被覆盖
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

  it('config/ 配置目录同样跳过（BATCH.yaml 落盘地不是模块）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-ovr-'));
    const batch = join(root, 'queue', 'batch-001');
    const taskDir = join(batch, '01-x');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'SPEC.md'), '---\ngoal: g\noutput: o\nacceptance:\n  review: r\n---\n正文\n');
    mkdirSync(join(batch, 'config'), { recursive: true });
    writeFileSync(join(batch, 'config', 'BATCH.yaml'), 'batch-size: 5\n');
    const queue = scanQueue(join(root, 'queue'), join(root, 'queue', '.taskchain'));
    expect(queue.tasks).toHaveLength(1);
    expect(queue.modules).toEqual([]);
  });
});
