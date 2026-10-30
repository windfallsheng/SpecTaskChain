// 上下文防爆测试：prompt 无上限必爆（Speccore 教训）——正文/留痕/约束/拆分输入超长一律截断 + 亮明原文路径
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { scanQueue, buildExecutionSequence } from '../../src/core/queue';
import { buildTaskPrompt } from '../../src/core/runner';
import { splitCommand } from '../../src/commands/split';
import { resolveReferences } from '../../src/core/references';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-guard-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造顶层任务，body 可定制 */
function makeTask(cfg: TaskQConfig, id: string, body: string): string {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/${id}.md
acceptance:
  artifacts:
    - path: docs/${id}.md
---
${body}`,
    'utf-8'
  );
  return dir;
}

/** 造模块 + 子任务，约束可定制 */
function makeModuleTask(cfg: TaskQConfig, constraints: string): { subDir: string; moduleDir: string } {
  const moduleDir = join(cfg.queueDir, 'batch-001', 'module-demo');
  const subDir = join(moduleDir, '01-sub');
  mkdirSync(subDir, { recursive: true });
  writeFileSync(
    join(subDir, 'SPEC.md'),
    `---
type: feature
goal: 实现子任务
output: src/
acceptance:
  artifacts:
    - path: src/a.ts
---
子任务正文`,
    'utf-8'
  );
  writeFileSync(join(moduleDir, 'CONSTRAINTS.md'), constraints, 'utf-8');
  return { subDir, moduleDir };
}

function findExec(cfg: TaskQConfig, id: string) {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  return buildExecutionSequence(queue).find((t) => t.spec.id === id)!;
}

describe('上下文防爆（截断 + 亮明原文路径）', () => {
  it('规格正文超长 → 截断头部 + 亮明 SPEC.md 路径 + 不吞尾部内容', () => {
    const cfg = makeCfg();
    const tailMarker = '★尾部独特标记★';
    makeTask(cfg, '01-longbody', '甲'.repeat(13000) + tailMarker);
    const prompt = buildTaskPrompt(findExec(cfg, '01-longbody'), cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('已截断');
    expect(prompt).toContain('Read 原文：');
    expect(prompt).toContain('SPEC.md');
    expect(prompt).not.toContain(tailMarker); // 截断后尾部不再注入（宿主 AI 按需 Read 原文）
  });

  it('执行留痕超长 → 保留最新进度尾部 + 标注前文省略', () => {
    const cfg = makeCfg();
    const dir = makeTask(cfg, '02-longprogress', '正文');
    const tailMarker = '★最新进度：接口方案已确认★';
    writeFileSync(join(dir, 'PROGRESS.md'), '旧进度记录。'.repeat(800) + tailMarker, 'utf-8');
    const prompt = buildTaskPrompt(findExec(cfg, '02-longprogress'), cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('前文省略');
    expect(prompt).toContain(tailMarker); // 断点续跑看的是「最新做到哪」，尾部必须保留
  });

  it('模块约束超长 → 截断 + 亮明 CONSTRAINTS.md 路径', () => {
    const cfg = makeCfg();
    makeModuleTask(cfg, '模块约束：'.repeat(3000));
    const prompt = buildTaskPrompt(findExec(cfg, '01-sub'), cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('已截断');
    expect(prompt).toContain('CONSTRAINTS.md');
  });

  it('短内容不受影响：正文/留痕/约束全量注入，无截断标注', () => {
    const cfg = makeCfg();
    const dir = makeTask(cfg, '03-short', '短正文');
    writeFileSync(join(dir, 'PROGRESS.md'), '短留痕', 'utf-8');
    const prompt = buildTaskPrompt(findExec(cfg, '03-short'), cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('短正文');
    expect(prompt).toContain('短留痕');
    expect(prompt).not.toContain('已截断');
    expect(prompt).not.toContain('前文省略');
  });
});

describe('引用注入聚合限额（对齐 speccore：单文件 + 总量双层）', () => {
  it('超过 6 个引用：第 7 个起内容略过，只亮路径供按需 Read', () => {
    const cfg = makeCfg();
    const refs = Array.from({ length: 7 }, (_, i) => `ref-${i}.md`);
    refs.forEach((f) => writeFileSync(join(cfg.projectRoot, f), `内容 ${f}`, 'utf-8'));
    const resolved = resolveReferences(refs.map((f) => `[${f}](${f})`).join('\n'), cfg.projectRoot);
    expect(resolved).toHaveLength(7);
    expect(resolved.filter((r) => r.content)).toHaveLength(6);
    const last = resolved[6];
    expect(last.content).toBeUndefined();
    expect(last.note).toContain('按需 Read');
    expect(last.note).toContain('ref-6.md');
  });

  it('总量超 20000 字符：三件 8K 文件只注入前两件', () => {
    const cfg = makeCfg();
    const body = '乙'.repeat(8192);
    ['c.md', 'd.md', 'e.md'].forEach((f) => writeFileSync(join(cfg.projectRoot, f), body, 'utf-8'));
    const resolved = resolveReferences('[c](c.md)\n[d](d.md)\n[e](e.md)', cfg.projectRoot);
    expect(resolved[0].content).toBeTruthy();
    expect(resolved[1].content).toBeTruthy();
    expect(resolved[2].content).toBeUndefined();
    expect(resolved[2].note).toContain('按需 Read');
  });

  it('预算外引用进 prompt：渲染 note 而非空段', () => {
    const cfg = makeCfg();
    const refs = Array.from({ length: 7 }, (_, i) => `x-${i}.md`);
    refs.forEach((f) => writeFileSync(join(cfg.projectRoot, f), `内容`, 'utf-8'));
    const dir = makeTask(cfg, '05-refs', refs.map((f) => `[${f}](${f})`).join('\n'));
    const prompt = buildTaskPrompt(findExec(cfg, '05-refs'), cfg.metaDir, cfg.projectRoot);
    expect(prompt).toContain('内容略过（已达引用注入预算');
  });
});

describe('拆分输入防爆', () => {
  it('输入文件超长 → 截断至 30000 字符 + 亮明原文路径', () => {
    const cfg = makeCfg();
    const longFile = join(cfg.projectRoot, 'prd.md');
    const tailMarker = '★文档尾部章节★';
    writeFileSync(longFile, '甲'.repeat(32000) + tailMarker, 'utf-8');
    const out = splitCommand(cfg, longFile, {});
    expect(out).toContain('已截断至 30000 字符');
    expect(out).toContain(longFile);
  });

  it('对话文字超长 → 同样截断（无路径标注）', () => {
    const cfg = makeCfg();
    const out = splitCommand(cfg, '乙'.repeat(32000), {});
    expect(out).toContain('已截断至 30000 字符');
  });

  it('短输入正常拆分，无截断标注', () => {
    const cfg = makeCfg();
    const shortFile = join(cfg.projectRoot, 'small.md');
    writeFileSync(shortFile, '# 标题\n## 任务一\n描述', 'utf-8');
    const out = splitCommand(cfg, shortFile, {});
    expect(out).not.toContain('已截断');
  });
});
