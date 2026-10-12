import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractReferences, resolveReferences } from '../../src/core/references';
import { scanQueue, buildExecutionSequence } from '../../src/core/queue';
import { relayNext, buildTaskPrompt } from '../../src/core/runner';
import { detectTaskIssues, detectModuleIssues } from '../../src/core/clarify';
import { parseFrontmatter, buildSpec } from '../../src/core/task-spec';

/** 造临时队列：模块 + 子任务 + CONSTRAINTS */
function makeQueue(opts: { withConstraints?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stc-hard-'));
  const tasksDir = join(root, 'queue', 'tasks');
  const moduleDir = join(tasksDir, 'auth');
  const subDir = join(moduleDir, '01-login');
  mkdirSync(subDir, { recursive: true });
  const subSpec = `---
type: feature
goal: 实现登录接口
output: src/auth/
acceptance:
  artifacts:
    - path: src/auth/login.ts
---
写登录接口`;
  writeFileSync(join(subDir, 'SPEC.md'), subSpec, 'utf-8');
  if (opts.withConstraints) {
    writeFileSync(join(moduleDir, 'CONSTRAINTS.md'), '模块公共约束：统一错误码体系', 'utf-8');
  }
  return {
    root,
    queueDir: join(root, 'queue'),
    metaDir: join(root, 'queue', '.taskchain'),
  };
}

describe('引用消解：让 AI 读到的都是真的', () => {
  it('提取引用：链接/图片/裸路径/URL 分类', () => {
    const refs = extractReferences('见 [方案](docs/plan.md) 和 ![设计](assets/ui.png)，附 https://example.com/api，还有 data/schema.json');
    const kinds = refs.map((r) => r.kind).sort();
    expect(kinds).toContain('file');
    expect(kinds).toContain('image');
    expect(kinds).toContain('url');
    expect(refs.find((r) => r.target === 'docs/plan.md')?.kind).toBe('file');
    expect(refs.find((r) => r.target === 'assets/ui.png')?.kind).toBe('image');
    expect(refs.find((r) => r.target === 'https://example.com/api')?.kind).toBe('url');
  });

  it('消解引用：存在的文件读全文嵌入', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-ref-'));
    writeFileSync(join(dir, 'plan.md'), '真实内容：先导出用户表', 'utf-8');
    const resolved = resolveReferences('见 [方案](plan.md)', dir);
    expect(resolved[0].status).toBe('ok');
    expect(resolved[0].content).toContain('先导出用户表');
  });

  it('消解引用：文件缺失显式标记 missing，不静默', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-ref-'));
    const resolved = resolveReferences('见 [方案](plan.md)', dir);
    expect(resolved[0].status).toBe('missing');
    expect(resolved[0].absPath).toContain('plan.md');
  });

  it('消解引用：图片确认存在并给绝对路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-ref-'));
    writeFileSync(join(dir, 'ui.png'), 'fake-png', 'utf-8');
    const resolved = resolveReferences('![设计](ui.png)', dir);
    expect(resolved[0].status).toBe('ok');
    expect(resolved[0].absPath).toContain('ui.png');
    expect(resolved[0].content).toBeUndefined();
  });

  it('引用基准 = 项目根：SPEC 引用的项目根文件被嵌入 prompt（与 output/artifacts 同基准）', () => {
    const { root, queueDir, metaDir } = makeQueue({ withConstraints: true });
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'plan.md'), '真实内容：先导出用户表', 'utf-8');
    const subDir = join(queueDir, 'tasks', 'auth', '01-login');
    const specContent = `---
type: feature
goal: 按 [迁移方案](docs/plan.md) 实现登录接口
output: src/auth/
acceptance:
  artifacts:
    - path: src/auth/login.ts
---
见方案`;
    writeFileSync(join(subDir, 'SPEC.md'), specContent, 'utf-8');
    const result = relayNext({ projectRoot: root, queueDir, metaDir });
    expect(result.exitCode).toBe(10);
    expect(result.prompt).toContain('真实内容：先导出用户表');
  });
});

describe('模块约束加固：共享 spec 是必读前提', () => {
  it('CONSTRAINTS.md 缺失 → constraintsMissing 标记', () => {
    const { queueDir, metaDir } = makeQueue();
    const queue = scanQueue(queueDir, metaDir);
    expect(queue.modules[0].constraintsMissing).toBe(true);
  });

  it('CONSTRAINTS.md 非空 → constraintsMissing false', () => {
    const { queueDir, metaDir } = makeQueue({ withConstraints: true });
    const queue = scanQueue(queueDir, metaDir);
    expect(queue.modules[0].constraintsMissing).toBe(false);
  });

  it('模块缺共享 spec → 接力阻塞 exitCode 12（绝不静默裸奔）', () => {
    const { root, queueDir, metaDir } = makeQueue();
    const result = relayNext({ projectRoot: root, queueDir, metaDir });
    expect(result.exitCode).toBe(12);
    expect(result.summary).toContain('CONSTRAINTS.md');
  });

  it('共享 spec 齐备 → 正常接力，prompt 恒带模块身份与约束全文', () => {
    const { root, queueDir, metaDir } = makeQueue({ withConstraints: true });
    const result = relayNext({ projectRoot: root, queueDir, metaDir });
    expect(result.exitCode).toBe(10);
    expect(result.prompt).toContain('模块身份与公共约束');
    expect(result.prompt).toContain('统一错误码体系');
    expect(result.prompt).toContain('每次执行前重新读取');
  });

  it('clarify：模块缺共享 spec → blocking 信号', () => {
    const { queueDir, metaDir } = makeQueue();
    const issues = detectModuleIssues(scanQueue(queueDir, metaDir));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].level).toBe('blocking');
  });
});

describe('执行留痕与动作义务：断了的能续，动作必须做', () => {
  it('PROGRESS.md 存在 → 注入 prompt（续做而非重做）', () => {
    const { root, queueDir, metaDir } = makeQueue({ withConstraints: true });
    const queue = scanQueue(queueDir, metaDir);
    const seq = buildExecutionSequence(queue);
    const sub = seq.find((e) => e.module);
    writeFileSync(join(sub!.spec.dir, 'PROGRESS.md'), '已完成：数据模型定义；在等：接口鉴权方案确认', 'utf-8');
    const result = relayNext({ projectRoot: root, queueDir, metaDir });
    expect(result.prompt).toContain('上次执行留痕');
    expect(result.prompt).toContain('在等：接口鉴权方案确认');
    expect(result.prompt).toContain('按留痕续做');
  });

  it('prompt 恒含动作义务：动作型要求必须执行', () => {
    const { root, queueDir, metaDir } = makeQueue({ withConstraints: true });
    const queue = scanQueue(queueDir, metaDir);
    const seq = buildExecutionSequence(queue);
    const sub = seq.find((e) => e.module);
    const prompt = buildTaskPrompt(sub!, metaDir, root);
    expect(prompt).toContain('动作型要求');
    expect(prompt).toContain('只产出文件不执行动作，视为未完成');
  });

  it('prompt 恒含 PROGRESS.md 留痕协议（输出协议段）', () => {
    const { root, queueDir, metaDir } = makeQueue({ withConstraints: true });
    const queue = scanQueue(queueDir, metaDir);
    const seq = buildExecutionSequence(queue);
    const sub = seq.find((e) => e.module);
    const prompt = buildTaskPrompt(sub!, metaDir, root);
    expect(prompt).toContain('把进度写进任务目录的 PROGRESS.md');
  });
});

describe('引用悬空：clarify 体检报阻塞', () => {
  it('SPEC 引用不存在的文件 → blocking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-dangling-'));
    const content = `---
goal: 按 [方案](docs/plan.md) 执行
output: docs/
acceptance:
  artifacts:
    - path: docs/result.md
---
见方案`;
    const { data, body } = parseFrontmatter(content);
    const spec = buildSpec('01-x', dir, data, body, 'general');
    const issues = detectTaskIssues(spec);
    const refIssue = issues.find((i) => i.message.includes('读不到真实内容'));
    expect(refIssue?.level).toBe('blocking');
  });
});
