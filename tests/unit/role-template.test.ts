// 用户覆盖系统测试：角色绑定（applies-to）与规格模板（覆盖链）
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { scanQueue } from '../../src/core/queue';
import { resolveTaskRole, resolveEffectiveRole, renderEffectiveRoleSegment, listBuiltinRoles, defaultRoleForType } from '../../src/core/task-role';
import { resolveSpecTemplate, templateSourceLabel } from '../../src/core/task-template';
import { parseFrontmatter, renderSpec } from '../../src/core/task-spec';
import { buildTaskPrompt } from '../../src/core/runner';
import { buildExecutionSequence } from '../../src/core/queue';
import { detectRoleConflicts, detectTaskIssues } from '../../src/core/clarify';
import { newCommand } from '../../src/commands/new';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-rt-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 写角色定义文件（frontmatter 可带嵌套 applies-to） */
function writeRole(metaDir: string, role: string, fm: Record<string, unknown>) {
  mkdirSync(join(metaDir, 'ROLES'), { recursive: true });
  const yamlValue = (v: unknown, indent = 0): string => {
    const pad = '  '.repeat(indent);
    if (Array.isArray(v)) return v.map((x) => `${pad}- ${x}`).join('\n');
    if (v && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, sv]) => `${pad}${k}:\n${yamlValue(sv, indent + 1)}`)
        .join('\n');
    }
    return String(v);
  };
  const items = Object.entries(fm)
    .map(([k, v]) => {
      const compound = Array.isArray(v) || (v && typeof v === 'object');
      const rendered = yamlValue(v);
      return compound
        ? `${k}:\n${rendered.split('\n').map((l) => `  ${l}`).join('\n')}`
        : `${k}: ${rendered}`;
    })
    .join('\n');
  writeFileSync(join(metaDir, 'ROLES', `${role}.md`), `---\n${items}\n---\n角色正文`, 'utf-8');
}

/** 造任务 SPEC（可带 role），返回目录 */
function makeTask(cfg: TaskQConfig, id: string, type = 'doc', role?: string): string {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: ${type}
goal: ${id} 的任务
output: docs/${id}.md
${role ? `role: ${role}\n` : ''}acceptance:
  artifacts:
    - path: docs/${id}.md
---
${id} 正文`,
    'utf-8'
  );
  return dir;
}

describe('角色绑定（applies-to）', () => {
  it('自定义角色同名覆盖内置：旧名 coder 归一后由 code-engineer.md 压过内置', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'code-engineer', { stance: '你是本项目的定制编码角色', focus: ['只写 Rust'], taboos: ['不写 JS'] });
    const def = resolveTaskRole(cfg.metaDir, 'coder');
    expect(def?.name).toBe('code-engineer');
    expect(def?.stance).toBe('你是本项目的定制编码角色');
    expect(def?.focus).toEqual(['只写 Rust']);
  });

  it('无任何声明与绑定：source auto（AI 自动选择，带类型建议）', () => {
    const cfg = makeCfg();
    const eff = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'doc' });
    expect(eff.source).toBe('auto');
    expect(eff.suggestion).toBe('document-writer');
    const seg = renderEffectiveRoleSegment(eff).join('\n');
    expect(seg).toContain('## 执行角色（自动选择）');
  });

  it('types 绑定命中：doc 类型自动套用审计角色', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'auditor', { stance: '你以审计视角执行', 'applies-to': { types: ['doc'] } });
    const eff = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'doc' });
    expect(eff.source).toBe('bound');
    expect(eff.def?.name).toBe('auditor');
  });

  it('显式 role 压过绑定：任务自带 role 优先（旧名走别名归一）', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'auditor', { stance: '审计', 'applies-to': { types: ['doc'] } });
    const eff = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'doc', role: 'doc-writer' });
    expect(eff.source).toBe('explicit');
    expect(eff.def?.name).toBe('document-writer');
  });

  it('tasks 精确绑定压过 types：同角色声明两类规则', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'polish', { stance: '润色', 'applies-to': { types: ['doc'], tasks: ['02-b'] } });
    writeRole(cfg.metaDir, 'auditor', { stance: '审计', 'applies-to': { types: ['doc'] } });
    // 01-a 走 types 命中：auditor 与 polish 都命中 doc → 冲突取字典序第一个（auditor）
    const effA = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'doc' });
    expect(effA.conflict).toBe(true);
    expect(effA.def?.name).toBe('auditor');
    // 02-b 走 tasks 精确命中：只有 polish 命中，无冲突
    const effB = resolveEffectiveRole(cfg.metaDir, { id: '02-b', type: 'doc' });
    expect(effB.def?.name).toBe('polish');
    expect(effB.conflict).toBeFalsy();
  });

  it('渲染绑定角色段：含来源标注与冲突提示', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'auditor', { stance: '审计', 'applies-to': { types: ['doc'] } });
    writeRole(cfg.metaDir, 'polish', { stance: '润色', 'applies-to': { types: ['doc'] } });
    const eff = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'doc' });
    const seg = renderEffectiveRoleSegment(eff).join('\n');
    expect(seg).toContain('## 执行角色');
    expect(seg).toContain('「auditor」');
    expect(seg).toContain('按角色绑定 applies-to 自动匹配');
    expect(seg).toContain('多个角色绑定了本任务的类型/ID');
  });

  it('绑定命中注入执行 prompt（任务无 role 字段）', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'auditor', { stance: '你以审计视角执行', 'applies-to': { types: ['doc'] } });
    makeTask(cfg, '01-a');
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const t = seq.find((s) => s.spec.id === '01-a');
    const prompt = buildTaskPrompt(t!, cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('## 执行角色');
    expect(prompt).toContain('「auditor」');
    expect(prompt).toContain('按角色绑定 applies-to 自动匹配');
  });

  it('clarify 冲突提示：同类型多角色绑定亮明', () => {
    const cfg = makeCfg();
    writeRole(cfg.metaDir, 'auditor', { stance: '审计', 'applies-to': { types: ['doc'] } });
    writeRole(cfg.metaDir, 'polish', { stance: '润色', 'applies-to': { types: ['doc'] } });
    makeTask(cfg, '01-a');
    const issues = detectRoleConflicts(scanQueue(cfg.queueDir, cfg.metaDir));
    expect(issues.some((i) => i.message.includes('角色绑定冲突') && i.message.includes('auditor'))).toBe(true);
  });
});

describe('AI 自动选择角色（内容驱动）', () => {
  it('旧名别名归一：coder/tester/ops/analyst/designer → 专业化新名', () => {
    expect(resolveTaskRole('/tmp/meta', 'coder')?.name).toBe('code-engineer');
    expect(resolveTaskRole('/tmp/meta', 'tester')?.name).toBe('test-engineer');
    expect(resolveTaskRole('/tmp/meta', 'ops')?.name).toBe('devops-engineer');
    expect(resolveTaskRole('/tmp/meta', 'analyst')?.name).toBe('research-analyst');
    expect(resolveTaskRole('/tmp/meta', 'designer')?.name).toBe('presentation-designer');
  });

  it('内置清单：10 个专业化角色，旧名不在清单', () => {
    const roles = listBuiltinRoles();
    expect(roles).toHaveLength(10);
    expect(roles).toContain('debug-engineer');
    expect(roles).toContain('data-analyst');
    expect(roles).not.toContain('coder');
    expect(roles).not.toContain('doc-writer');
  });

  it('类型默认映射：bugfix→debug-engineer、data→data-analyst、research→research-analyst', () => {
    expect(defaultRoleForType('bugfix')).toBe('debug-engineer');
    expect(defaultRoleForType('data')).toBe('data-analyst');
    expect(defaultRoleForType('research')).toBe('research-analyst');
    expect(defaultRoleForType('unknown-type')).toBe('generalist');
  });

  it('auto 段渲染：角色菜单 + 类型建议 + 写回固化建议', () => {
    const cfg = makeCfg();
    const eff = resolveEffectiveRole(cfg.metaDir, { id: '01-a', type: 'bugfix' });
    const seg = renderEffectiveRoleSegment(eff).join('\n');
    expect(seg).toContain('## 执行角色（自动选择）');
    expect(seg).toContain('debug-engineer（缺陷修复专家');
    expect(seg).toContain('类型建议：debug-engineer');
    expect(seg).toContain('写回 SPEC.md frontmatter 固化');
    // 菜单列出全部内置角色
    for (const name of listBuiltinRoles()) expect(seg).toContain(name);
  });

  it('执行 prompt：无 role 无绑定的任务注入自动选择段', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', 'research');
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const t = seq.find((s) => s.spec.id === '01-a');
    const prompt = buildTaskPrompt(t!, cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('## 执行角色（自动选择）');
    expect(prompt).toContain('类型建议：research-analyst');
  });

  it('clarify：未指定角色出自动选择 suggest（类型建议亮明）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', 'data');
    const queue = scanQueue(cfg.queueDir, cfg.metaDir);
    const t = queue.tasks.find((x) => x.id === '01-a')!;
    const issues = detectTaskIssues(t, cfg.projectRoot);
    expect(issues.some((i) => i.message.includes('未指定角色') && i.message.includes('data-analyst'))).toBe(true);
  });
});

describe('规格模板（覆盖链）', () => {
  it('系统内置：无任何自定义时按类型兜底，doc 含「内容大纲」', () => {
    const cfg = makeCfg();
    const tpl = resolveSpecTemplate(cfg.metaDir, join(cfg.queueDir, 'x'), 'doc');
    expect(tpl.source).toBe('builtin');
    expect(tpl.content).toContain('内容大纲');
  });

  it('类型级覆盖：TEMPLATES/doc.md 压过内置', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.metaDir, 'TEMPLATES'), { recursive: true });
    writeFileSync(join(cfg.metaDir, 'TEMPLATES', 'doc.md'), '## 我们的文档骨架\n\n- 客户视角章节', 'utf-8');
    const tpl = resolveSpecTemplate(cfg.metaDir, join(cfg.queueDir, 'x'), 'doc');
    expect(tpl.source).toBe('type');
    expect(tpl.content).toContain('我们的文档骨架');
    expect(templateSourceLabel(tpl.source, 'doc')).toContain('TEMPLATES/doc.md');
  });

  it('通用覆盖：TEMPLATES/SPEC.md 兜底所有类型（无类型级时）', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.metaDir, 'TEMPLATES'), { recursive: true });
    writeFileSync(join(cfg.metaDir, 'TEMPLATES', 'SPEC.md'), '## 统一骨架\n\n- 背景\n- 要点', 'utf-8');
    const tpl = resolveSpecTemplate(cfg.metaDir, join(cfg.queueDir, 'x'), 'bugfix');
    expect(tpl.source).toBe('generic');
    expect(tpl.content).toContain('统一骨架');
  });

  it('任务级最高：任务目录 TEMPLATE.md 压过一切', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.metaDir, 'TEMPLATES'), { recursive: true });
    writeFileSync(join(cfg.metaDir, 'TEMPLATES', 'doc.md'), '## 类型模板', 'utf-8');
    const taskDir = join(cfg.queueDir, 'batch-001', '01-a');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'TEMPLATE.md'), '## 这个任务专属的骨架', 'utf-8');
    const tpl = resolveSpecTemplate(cfg.metaDir, taskDir, 'doc');
    expect(tpl.source).toBe('task');
    expect(tpl.content).toContain('专属的骨架');
  });

  it('new 落盘：正文即模板骨架（doc 内置骨架入 SPEC）', () => {
    const cfg = makeCfg();
    const out = newCommand(cfg, { goal: '写一份周报', type: 'doc', draft: true });
    expect(out).toContain('已入队');
    const specPath = join(cfg.queueDir, 'batch-001', out.match(/(\d{2}-[a-z0-9-]+)/)![1], 'SPEC.md');
    expect(readFileSync(specPath, 'utf-8')).toContain('## 内容大纲');
    expect(out).toContain('正文模板：系统内置模板（doc 类型）');
  });

  it('new 落盘走类型级模板：TEMPLATES/doc.md 骨架入 SPEC + 来源亮明', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.metaDir, 'TEMPLATES'), { recursive: true });
    writeFileSync(join(cfg.metaDir, 'TEMPLATES', 'doc.md'), '## 我们的文档骨架\n\n- 客户视角章节', 'utf-8');
    const out = newCommand(cfg, { goal: '写一份周报', type: 'doc', draft: true });
    expect(out).toContain('正文模板：类型模板（.taskchain/TEMPLATES/doc.md）');
    const specPath = join(cfg.queueDir, 'batch-001', out.match(/(\d{2}-[a-z0-9-]+)/)![1], 'SPEC.md');
    expect(readFileSync(specPath, 'utf-8')).toContain('我们的文档骨架');
  });

  it('对话成规格 prompt：注入模板引导（不 --draft 时）', () => {
    const cfg = makeCfg();
    const out = newCommand(cfg, { goal: '写一份周报', type: 'doc' });
    expect(out).toContain('[TASKQ_SPEC_DRAFT]');
    expect(out).toContain('按已落盘的模板骨架补全');
  });
});
