import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { toSlug, hasCJK, isPlaceholderSlug, hasNonAscii } from '../../src/core/task-naming';
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
  it('--name 中文 → 目录全拼 + name 显示名落盘', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '写迁移文档', name: '迁移文档', draft: true });
    expect(out).toContain('qianyiwendang');
    const spec = readFileSync(join(root, 'queue', 'tasks', '01-qianyiwendang', 'SPEC.md'), 'utf-8');
    expect(spec).toContain('name: 迁移文档');
  });

  it('--name 英文 → 目录直接用，不重复写 name', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    newCommand(cfg(root), { goal: '写文档', name: 'migration-docs', draft: true });
    const spec = readFileSync(join(root, 'queue', 'tasks', '01-migration-docs', 'SPEC.md'), 'utf-8');
    expect(spec).not.toContain('name:');
  });

  it('--group 中文 → 模块目录全拼 + CONSTRAINTS.md 带显示名', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const out = newCommand(cfg(root), { goal: '实现登录', group: '认证模块', name: '登录接口', draft: true });
    expect(out).toContain('renzhengmokuai');
    expect(out).toContain('认证模块');
    const constraints = readFileSync(join(root, 'queue', 'tasks', 'renzhengmokuai', 'CONSTRAINTS.md'), 'utf-8');
    expect(constraints).toContain('认证模块');
    const subSpec = readFileSync(join(root, 'queue', 'tasks', 'renzhengmokuai', '01-denglujiekou', 'SPEC.md'), 'utf-8');
    expect(subSpec).toContain('name: 登录接口');
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

  it('slug 重复 → 命名重复检测', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-name-'));
    const c = cfg(root);
    newCommand(c, { goal: '写A', name: 'auth', draft: true });
    newCommand(c, { goal: '写B', name: 'auth', draft: true });
    const queue = scanQueue(c.queueDir, c.metaDir);
    const issues = detectDuplicateNames(queue);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('重复');
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
