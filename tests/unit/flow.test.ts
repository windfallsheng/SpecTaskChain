// 流水车间测试：执行角色（role）/ 批次接力（execute）/ 端到端流水线（pipeline）
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { scanQueue, buildExecutionSequence } from '../../src/core/queue';
import { resolveTaskRole, renderRoleSegment, listBuiltinRoles } from '../../src/core/task-role';
import { buildSpec, parseFrontmatter, renderSpec } from '../../src/core/task-spec';
import { buildTaskPrompt, batchRelay, renderBatchResult } from '../../src/core/runner';
import { detectTaskIssues } from '../../src/core/clarify';
import { pipelineCommand } from '../../src/commands/pipeline';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-flow-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造一个顶层任务（可选 role / draft） */
function makeTask(cfg: TaskQConfig, id: string, extra: { role?: string; draft?: boolean } = {}): string {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/${id}.md
${extra.role ? `role: ${extra.role}\n` : ''}${extra.draft ? 'draft: true\n' : ''}acceptance:
  artifacts:
    - path: docs/${id}.md
---
${id} 正文`,
    'utf-8'
  );
  return dir;
}

describe('执行角色（role）', () => {
  it('内置角色命中：document-writer 有立场与关注点（旧名 doc-writer 走别名同样命中）', () => {
    const def = resolveTaskRole('/tmp/meta', 'document-writer');
    expect(def?.name).toBe('document-writer');
    expect(def?.stance).toContain('文档');
    expect(def?.focus.length).toBeGreaterThan(0);
    // 旧名零感知兼容
    expect(resolveTaskRole('/tmp/meta', 'doc-writer')?.name).toBe('document-writer');
  });

  it('自定义角色文件：.taskchain/ROLES/{role}.md frontmatter 解析', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.metaDir, 'ROLES'), { recursive: true });
    writeFileSync(
      join(cfg.metaDir, 'ROLES', 'auditor.md'),
      '---\nstance: 你是一个审计师：只认单据，不认口头。\nfocus:\n  - 凭证完整性\n  - 数字勾稽\ntaboos:\n  - 不接受口头承诺\n---\n'
    );
    const def = resolveTaskRole(cfg.metaDir, 'auditor');
    expect(def?.stance).toContain('审计师');
    expect(def?.focus).toEqual(['凭证完整性', '数字勾稽']);
    expect(def?.taboos).toEqual(['不接受口头承诺']);
  });

  it('未知角色与未声明角色都返回 undefined；内置清单含 10 专业化角色', () => {
    expect(resolveTaskRole('/tmp/meta', 'no-such-role')).toBeUndefined();
    expect(resolveTaskRole('/tmp/meta')).toBeUndefined();
    expect(listBuiltinRoles()).toContain('generalist');
    expect(listBuiltinRoles().length).toBeGreaterThanOrEqual(8);
  });

  it('renderRoleSegment：无声明为空；内置注入立场；未知亮明回退', () => {
    expect(renderRoleSegment('/tmp/meta')).toEqual([]);
    const builtin = renderRoleSegment('/tmp/meta', 'coder');
    expect(builtin[0]).toBe('## 执行角色');
    expect(builtin.join('\n')).toContain('代码工程');
    const unknown = renderRoleSegment('/tmp/meta', 'ghost');
    expect(unknown.join('\n')).toContain('未找到定义');
    expect(unknown.join('\n')).toContain('通才');
  });

  it('SPEC 解析与渲染：role 字段往返', () => {
    const { data, body } = parseFrontmatter('---\ntype: doc\nrole: tester\ngoal: 写测试\noutput: tests/\n---\n正文');
    const spec = buildSpec('01-test', '/tmp/dir', data, body, 'general');
    expect(spec.role).toBe('tester');
    const rendered = renderSpec({ type: 'doc', goal: '写测试', output: 'tests/', acceptance: { artifacts: [], checks: [], review: '' }, role: 'tester' });
    expect(rendered).toContain('role: tester');
  });

  it('buildTaskPrompt：有 role 注入角色段，无 role 保持老行为', () => {
    const cfg = makeCfg();
    const dirA = makeTask(cfg, '01-role', { role: 'security-reviewer' });
    const dirB = makeTask(cfg, '02-plain');
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    const seq = buildExecutionSequence(queue);
    const taskA = seq.find((t) => t.spec.id === '01-role')!;
    const taskB = seq.find((t) => t.spec.id === '02-plain')!;
    const promptA = buildTaskPrompt(taskA, cfg.metaDir, cfg.projectRoot);
    const promptB = buildTaskPrompt(taskB, cfg.metaDir, cfg.projectRoot);
    expect(promptA).toContain('## 执行角色');
    expect(promptA).toContain('安全审查');
    expect(promptA).toContain('输入验证');
    expect(promptB).toContain('## 执行角色（自动选择）');
    expect(promptB).toContain('类型建议');
    expect(promptB).toContain('写回 SPEC.md frontmatter 固化');
    expect(dirA && dirB).toBeTruthy();
  });

  it('buildTaskPrompt：上游依赖完成摘要——deps 注入 goal/verdict/产物清单，无依赖不注入', () => {
    const cfg = makeCfg();
    const dirA = makeTask(cfg, '01-upstream');
    const dirB = makeTask(cfg, '02-downstream');
    // 下游声明 depends-on 上游
    writeFileSync(
      join(dirB, 'SPEC.md'),
      `---
type: doc
goal: 02-downstream 的任务
output: docs/02-downstream.md
depends-on:
  - 01-upstream
acceptance:
  artifacts:
    - path: docs/02-downstream.md
---
02-downstream 正文`,
      'utf-8'
    );
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    const seq = buildExecutionSequence(queue);
    const taskA = seq.find((t) => t.spec.id === '01-upstream')!;
    const taskB = seq.find((t) => t.spec.id === '02-downstream')!;
    expect(taskB.spec.dependsOn).toEqual(['01-upstream']);
    // 上游产物真实存在 → 清单无警告
    mkdirSync(join(cfg.projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(cfg.projectRoot, 'docs', '01-upstream.md'), 'x', 'utf-8');
    const state = {
      '01-upstream': { status: 'done' as const, attempts: 1, verdict: 'pass 迁移文档齐全', doneAt: '2026-11-05' },
    };
    const prompt = buildTaskPrompt(taskB, cfg.metaDir, cfg.projectRoot, { deps: [taskA], state });
    expect(prompt).toContain('## 上游依赖完成摘要');
    expect(prompt).toContain('### 上游：01-upstream（01-upstream 的任务）');
    expect(prompt).toContain('pass 迁移文档齐全'); // verdict
    expect(prompt).toContain('- docs/01-upstream.md'); // 产物清单
    expect(prompt).not.toContain('⚠️ 文件不存在');
    // 无依赖任务不注入该段
    const promptA = buildTaskPrompt(taskA, cfg.metaDir, cfg.projectRoot);
    expect(promptA).not.toContain('## 上游依赖完成摘要');
    // 上游未完成 → 状态提示（防御性）
    const promptHalf = buildTaskPrompt(taskB, cfg.metaDir, cfg.projectRoot, { deps: [taskA], state: { '01-upstream': { status: 'doing' as const, attempts: 1 } } });
    expect(promptHalf).toContain('未完成的上游不该轮到下游执行');
    expect(dirA && dirB).toBeTruthy();
  });

  it('clarify：未知角色出 suggest 提示，内置角色不报', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-ghost', { role: 'ghost' });
    makeTask(cfg, '02-ok', { role: 'coder' });
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    // queue.tasks 元素直接是 TaskSpec（无 spec 包装）；detectTaskIssues 也只吃 TaskSpec
    const ghost = queue.tasks.find((t) => t.id === '01-ghost')!;
    const ok = queue.tasks.find((t) => t.id === '02-ok')!;
    const ghostIssues = detectTaskIssues(ghost, cfg.projectRoot);
    const okIssues = detectTaskIssues(ok, cfg.projectRoot);
    expect(ghostIssues.some((i) => i.level === 'suggest' && i.message.includes('未定义'))).toBe(true);
    expect(okIssues.some((i) => i.message.includes('未定义'))).toBe(false);
  });
});

describe('批次接力（taskq execute）', () => {
  it('一次领取 batch-size 个任务：exit 10、批内全占位 doing、prompt 一一对应', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    makeTask(cfg, '02-b');
    makeTask(cfg, '03-c');
    const r = batchRelay(cfg, { batchSize: 2 });
    expect(r.exitCode).toBe(10);
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b']);
    expect(r.prompts.length).toBe(2);
    expect(r.prompts[0]).toContain('01-a 的任务');
    expect(r.summary).toContain('一次领取 2 个任务');
    // 批内两个任务都占位 doing，防并发重复领取（state.json 结构：{version, tasks:{}}）
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(state.tasks['01-a'].status).toBe('doing');
    expect(state.tasks['02-b'].status).toBe('doing');
  });

  it('队列清空：exit 0', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const r1 = batchRelay(cfg, { batchSize: 3 });
    expect(r1.exitCode).toBe(10);
    const statePath = join(cfg.metaDir, 'state.json');
    const s = JSON.parse(readFileSync(statePath, 'utf-8'));
    s.tasks['01-a'].status = 'done';
    writeFileSync(statePath, JSON.stringify(s));
    const r2 = batchRelay(cfg, { batchSize: 3 });
    expect(r2.exitCode).toBe(0);
    expect(r2.summary).toContain('队列已清空');
  });

  it('首任务 draft 拦停：exit 12、一个不领', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    makeTask(cfg, '02-b');
    const r = batchRelay(cfg, { batchSize: 2 });
    expect(r.exitCode).toBe(12);
    expect(r.tasks.length).toBe(0);
    expect(r.summary).toContain('draft');
  });

  it('批后拦停：正常任务先发，draft 截断批次并亮明原因', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    makeTask(cfg, '02-b', { draft: true });
    makeTask(cfg, '03-c');
    const r = batchRelay(cfg, { batchSize: 3 });
    expect(r.exitCode).toBe(10);
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a']);
    expect(r.stopReason).toContain('draft');
    expect(r.summary).toContain('批后拦停');
  });

  it('renderBatchResult：逐任务 [TASKQ_PROMPT] 块 + 序号', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    makeTask(cfg, '02-b');
    const r = batchRelay(cfg, { batchSize: 2 });
    const out = renderBatchResult(r);
    expect(out).toContain('批次任务 1/2：01-a');
    expect(out).toContain('批次任务 2/2：02-b');
    expect((out.match(/\[TASKQ_PROMPT\]/g) || []).length).toBe(2);
  });
});

describe('端到端流水线（taskq pipeline）', () => {
  it('目录素材：递归收集文本文件并输出剧本', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.projectRoot, 'materials'), { recursive: true });
    writeFileSync(join(cfg.projectRoot, 'materials', '需求一.md'), '做登录功能');
    writeFileSync(join(cfg.projectRoot, 'materials', '需求二.md'), '做注册功能');
    writeFileSync(join(cfg.projectRoot, 'materials', '图.png'), 'binary');
    const out = pipelineCommand(cfg, join(cfg.projectRoot, 'materials'), {});
    expect(out).toContain('素材采集完成：2 个文本文件');
    expect(out).toContain('做登录功能');
    expect(out).toContain('做注册功能');
    expect(out).not.toContain('binary');
    expect(out).toContain('[TASKQ_PIPELINE]');
    expect(out).toContain('阶段 1：拆分');
    expect(out).toContain('阶段 2：澄清');
    expect(out).toContain('阶段 3：执行');
    expect(out).toContain('阶段 4：收尾');
    expect(out).toContain('拦停点');
  });

  it('纯文字素材：剧本含描述原文', () => {
    const cfg = makeCfg();
    const out = pipelineCommand(cfg, '做一套报表系统，含导出与权限', {});
    expect(out).toContain('素材为纯文字描述');
    expect(out).toContain('做一套报表系统');
  });

  it('多文件逗号分隔 + 参数透传进剧本', () => {
    const cfg = makeCfg();
    writeFileSync(join(cfg.projectRoot, 'a.md'), 'A 需求');
    writeFileSync(join(cfg.projectRoot, 'b.md'), 'B 需求');
    const out = pipelineCommand(cfg, `${join(cfg.projectRoot, 'a.md')},${join(cfg.projectRoot, 'b.md')}`, { batchSize: 5, type: 'feature' });
    expect(out).toContain('素材采集完成：2 个文本文件');
    expect(out).toContain('--batch-size 5');
    expect(out).toContain('--type feature');
  });
});
