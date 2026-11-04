import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { toSlug, hasCJK, isPlaceholderSlug, hasNonAscii, slugFromDir } from '../../src/core/task-naming';
import { newCommand } from '../../src/commands/new';
import { recognizeIntent } from '../../src/core/intent';
import { detectTaskIssues, detectDuplicateNames } from '../../src/core/clarify';
import { scanQueue } from '../../src/core/queue';
import { parseFrontmatter, buildSpec } from '../../src/core/task-spec';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

describe('task-naming：目录名 ASCII slug + 显示名', () => {
  it('英文名保留', () => {
    expect(toSlug('migration-docs')).toBe('migration-docs');
    expect(toSlug('UserAuth模块')).toBe('userauth');
  });
  it('中文名转全拼', () => {
    expect(toSlug('迁移文档')).toBe('qianyiwendang');
  });
  it('纯中文全拼幂等（同一输入稳定同一 slug）', () => {
    expect(toSlug('支付')).toBe(toSlug('支付'));
  });
  it('占位 slug 与中文检测', () => {
    expect(isPlaceholderSlug('t9x2kfp')).toBe(true);
    expect(isPlaceholderSlug('qianyiwendang')).toBe(false);
    expect(hasCJK('迁移文档')).toBe(true);
    expect(hasNonAscii('01-迁移文档')).toBe(true);
    expect(hasNonAscii('01-qianyiwendang')).toBe(false);
  });
});

describe('new：中文名全拼目录 + frontmatter 显示名', () => {
  it('裸 new（无描述）→ 提示用法不建占位任务（不再落「未命名任务」）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-bare-'));
    const out = newCommand(cfg(root), { goal: '' });
    expect(out).toContain('用法：taskq new');
    expect(out).toContain('任务描述是必填');
    // 不建任何任务目录：queue 下只有 .taskchain 元数据，无 batch-001/task-* 残留
    const queueDir = join(root, 'queue');
    expect(!existsSync(join(queueDir, 'batch-001'))).toBe(true);
    expect(scanQueue(queueDir, cfg(root).metaDir).tasks.length).toBe(0);
  });
  it('--name 中文 → 目录全拼 + name 显示名落盘', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '写迁移文档', name: '迁移文档', draft: true });
    expect(out).toContain('qianyiwendang');
    const spec = readFileSync(join(root, 'queue', 'batch-001', 'task-qianyiwendang', 'SPEC.md'), 'utf-8');
    expect(spec).toContain('name: 迁移文档');
  });

  it('--name 英文 → 目录直接用，不重复写 name', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    newCommand(cfg(root), { goal: '写文档', name: 'migration-docs', draft: true });
    const spec = readFileSync(join(root, 'queue', 'batch-001', 'task-migration-docs', 'SPEC.md'), 'utf-8');
    expect(spec).not.toContain('name:');
  });

  it('--group 中文 → 模块目录 module- 前缀 + CONSTRAINTS.md 带显示名', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '实现登录', group: '认证模块', name: '登录接口', draft: true });
    expect(out).toContain('module-renzhengmokuai');
    expect(out).toContain('认证模块');
    const constraints = readFileSync(join(root, 'queue', 'batch-001', 'module-renzhengmokuai', 'CONSTRAINTS.md'), 'utf-8');
    expect(constraints).toContain('认证模块');
    const subSpec = readFileSync(join(root, 'queue', 'batch-001', 'module-renzhengmokuai', 'denglujiekou', 'SPEC.md'), 'utf-8');
    expect(subSpec).toContain('name: 登录接口');
  });

  it('--group 已带 module- 前缀 → 不叠加', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '实现登录', group: 'module-auth', name: '登录', draft: true });
    expect(out).toContain('module-auth');
    expect(out).not.toContain('module-module-auth');
  });

  it('无 --name → 从 goal 提取语义 slug（中文全拼）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '整理会议纪要', draft: true });
    expect(out).toContain('zhenglihuiyijiyao');
  });

  it('goal 提不出语义 → 兜底任务类型键，不落 task 哑名', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '！！！', type: 'script', draft: true });
    expect(out).toContain('「task-script」');
    expect(out).not.toContain('「task-task-script');
    const spec = readFileSync(join(root, 'queue', 'batch-001', 'task-script', 'SPEC.md'), 'utf-8');
    expect(spec).toContain('goal: ！！！');
  });

  it('--name 已带 task- 前缀 → 尊重原样不叠加（参考模块 module- 前缀效果）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '写文档', name: 'task-01', draft: true });
    expect(out).toContain('task-01');
    expect(out).not.toContain('task-task-01');
    const spec = readFileSync(join(root, 'queue', 'batch-001', 'task-01', 'SPEC.md'), 'utf-8');
    expect(spec).toContain('goal: 写文档');
  });

  it('无 --name → goal 含拉丁片段优先提取（默认落 task- 前缀）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '写 MySQL 慢查询分析脚本', draft: true });
    expect(out).toContain('task-mysql');
  });

  it('重名 → 拼内容短 hash 区分（不覆盖、state 键各归各）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    newCommand(cfg(root), { goal: '写文档', name: 'xiewendang', draft: true });
    const out = newCommand(cfg(root), { goal: '另一种文档', name: 'xiewendang', draft: true });
    expect(out).toContain('task-xiewendang-');
    expect(out).toContain('撞名拼短 hash 区分');
    expect(existsSync(join(root, 'queue', 'batch-001', 'task-xiewendang', 'SPEC.md'))).toBe(true);
  });

  it('同名同内容重复建 → 第二次拼 hash 区分，第三次报错提示换名', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    newCommand(cfg(root), { goal: '写文档', name: 'xiewendang', draft: true });
    const second = newCommand(cfg(root), { goal: '写文档', name: 'xiewendang', draft: true });
    expect(second).toContain('task-xiewendang-');
    const third = newCommand(cfg(root), { goal: '写文档', name: 'xiewendang', draft: true });
    expect(third).toContain('❌');
  });

  it('slugFromDir：剥 task- 前缀得语义 slug（hash 后缀保留，老目录兼容）', () => {
    expect(slugFromDir('task-xiewendang')).toBe('xiewendang');
    expect(slugFromDir('task-xiewendang-a1b2c3')).toBe('xiewendang-a1b2c3');
    expect(slugFromDir('task-01-xiewendang')).toBe('xiewendang');
    expect(slugFromDir('01-task-xiewendang')).toBe('xiewendang');
    expect(slugFromDir('01-xiewendang')).toBe('xiewendang');
    expect(slugFromDir('module-auth')).toBe('module-auth');
  });

  it('AI 草案指令含起名要求', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '写迁移文档', draft: false });
    expect(out).toContain('命名要求');
    expect(out).toContain('name:');
  });
});

describe('ask：创建命名识别', () => {
  it('「叫 X 的」→ taskName', () => {
    const r = recognizeIntent('建个叫 auth 的任务：写登录');
    expect(r.intent).toBe('new');
    expect(r.params.taskName).toBe('auth');
  });
  it('--name / --group 显式参数', () => {
    const r = recognizeIntent('新建任务 --name 迁移文档 --group 数据组');
    expect(r.params.taskName).toBe('迁移文档');
    expect(r.params.group).toBe('数据组');
  });
  it('「X 模块」→ group', () => {
    const r = recognizeIntent('建个任务：实现登录，放认证模块');
    expect(r.intent).toBe('new');
    expect(r.params.group).toBe('认证');
  });
});

describe('clarify：命名体检联动', () => {
  it('随机占位目录名 → suggest', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const { data, body } = parseFrontmatter('---\ngoal: x\noutput: docs/\nacceptance:\n  artifacts:\n    - path: docs/a.md\n---\nx');
    const spec = buildSpec('01-t9x2kfp', join(root, 'x'), data, body, 'general');
    const issues = detectTaskIssues(spec);
    expect(issues.some((i) => i.message.includes('随机占位'))).toBe(true);
  });

  it('中文目录名 → suggest', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const { data, body } = parseFrontmatter('---\ngoal: x\noutput: docs/\nacceptance:\n  artifacts:\n    - path: docs/a.md\n---\nx');
    const spec = buildSpec('01-迁移文档', join(root, 'x'), data, body, 'general');
    const issues = detectTaskIssues(spec);
    expect(issues.some((i) => i.message.includes('非 ASCII'))).toBe(true);
  });

  it('同 ID 跨批次重复 → blocking（state 键撞车拦截）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const c = cfg(root);
    newCommand(c, { goal: '写A', name: 'auth', draft: true }); // 落 batch-001/task-auth
    // 手工在另一批次建同名目录（CLI 新建会拼 hash 避开，手工建的可能撞）
    mkdirSync(join(c.queueDir, 'batch-002', 'task-auth'), { recursive: true });
    writeFileSync(join(c.queueDir, 'batch-002', 'task-auth', 'SPEC.md'), '---\ngoal: x\noutput: docs/\nacceptance:\n  artifacts: []\n---\nx', 'utf-8');
    const queue = scanQueue(c.queueDir, c.metaDir);
    const issues = detectDuplicateNames(queue);
    expect(issues.some((i) => i.level === 'blocking')).toBe(true);
  });

  it('全拼 slug 不重复 → 无命名重复信号', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const c = cfg(root);
    newCommand(c, { goal: '写A', name: 'auth', draft: true });
    newCommand(c, { goal: '写B', name: 'payment', draft: true });
    const issues = detectDuplicateNames(scanQueue(c.queueDir, c.metaDir));
    expect(issues).toHaveLength(0);
  });
});
