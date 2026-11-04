import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectOrchestration, parseBatchRef } from '../../src/core/intent';
import { askCommand } from '../../src/commands/ask';
import { parseRunRange, renderRunPlan } from '../../src/commands/run';
import { splitCommand } from '../../src/commands/split';
import { pipelineCommand } from '../../src/commands/pipeline';

const cfg = { projectRoot: '/proj', queueDir: '/proj/queue', metaDir: '/proj/queue/.taskchain' };

describe('detectOrchestration：复合意图编排（多动作词 + 时序词 → 编排步骤）', () => {
  it('「澄清所有任务并执行」→ clarify → execute 两步编排', () => {
    const orch = detectOrchestration('澄清所有任务，然后批量执行');
    expect(orch).not.toBeNull();
    expect(orch!.steps.map((s) => s.intent)).toEqual(['clarify', 'execute']);
    expect(orch!.steps[0].gate).toBe(true);
  });

  it('「先澄清再执行」：先字后的动作提到最前（执行前先澄清 → 澄清在前）', () => {
    const orch = detectOrchestration('执行前先澄清，然后接力');
    expect(orch).not.toBeNull();
    expect(orch!.steps.map((s) => s.intent)).toEqual(['clarify', 'execute']);
  });

  it('「拆分→澄清→执行」三段编排（语序 = 执行序）', () => {
    const orch = detectOrchestration('拆分 docs/prd.md，然后澄清，最后执行');
    expect(orch!.steps.map((s) => s.intent)).toEqual(['split', 'clarify', 'execute']);
  });

  it('批次/批量模板变量：「批次002 + 一次领 5 个」', () => {
    const orch = detectOrchestration('拆分素材，然后澄清并批量执行，批次002，一次领 5 个');
    expect(orch!.batchRef).toEqual({ kind: 'exact', id: 'batch-002' });
    expect(orch!.batchSize).toBe(5);
    expect(parseBatchRef('批次 2')).toEqual({ kind: 'exact', id: 'batch-002' });
  });

  it('全自动识别：「全自动/别停/不用问」→ auto 非交互', () => {
    expect(detectOrchestration('拆分并执行，全自动')!.auto).toBe(true);
    expect(detectOrchestration('拆分并执行，别停')!.auto).toBe(true);
    expect(detectOrchestration('拆分并执行').auto).toBe(false);
  });

  it('单动作或无序时词 → 不编排（null 走单意图）', () => {
    expect(detectOrchestration('澄清一下')).toBeNull();
    expect(detectOrchestration('澄清执行')).toBeNull(); // 无时序词
    expect(detectOrchestration('看下进度')).toBeNull();
  });

  it('同意图去重：「澄清并体检」算一步', () => {
    const orch = detectOrchestration('澄清并体检，然后执行');
    expect(orch!.steps.map((s) => s.intent)).toEqual(['clarify', 'execute']);
  });
});

describe('askCommand：编排剧本（pipeline 模式 + NEEDS_INFO）', () => {
  it('复合意图 → 输出编排剧本 + 退出码 10 接力', () => {
    const r = askCommand(cfg, '澄清所有任务，然后批量执行');
    expect(r.exitCode).toBe(10);
    expect(r.output).toContain('[TASKQ_ORCHESTRATE]');
    expect(r.output).toContain('体检澄清');
    expect(r.output).toContain('接力执行');
  });

  it('拆分缺素材 → NEEDS_INFO 提示（不猜素材）', () => {
    const r = askCommand(cfg, '拆分，然后澄清并执行');
    expect(r.output).toContain('[TASKQ_NEEDS_INFO]');
    expect(r.output).toContain('拆分步骤缺素材');
  });

  it('全自动 → 剧本声明非交互模式', () => {
    const r = askCommand(cfg, '拆分 docs/prd.md，然后澄清并执行，全自动');
    expect(r.output).toContain('非交互（全自动）');
    expect(r.output).toContain('拦停点自动通过');
  });

  it('单意图不编排仍正常：「跑队列」走接力', () => {
    const r = askCommand(cfg, '跑队列');
    expect(r.output).not.toContain('[TASKQ_ORCHESTRATE]');
  });
});

describe('parseRunRange：run 位置参数解析（preset / 范围 / 素材）', () => {
  it('无参 → 智能续跑（空对象）', () => {
    expect(parseRunRange([])).toEqual({});
  });

  it('单阶段 preset：clarify / 中文别名「体检」', () => {
    expect(parseRunRange(['clarify'])).toEqual({ from: 'clarify' });
    expect(parseRunRange(['体检'])).toEqual({ from: 'clarify' });
  });

  it('范围语法：clarify to execute / clarify..execute / clarify → execute', () => {
    expect(parseRunRange(['clarify', 'to', 'execute'])).toEqual({ from: 'clarify', to: 'execute' });
    expect(parseRunRange(['clarify..execute'])).toEqual({ from: 'clarify', to: 'execute' });
    expect(parseRunRange(['clarify', '→', 'execute'])).toEqual({ from: 'clarify', to: 'execute' });
  });

  it('split 带素材：run split <素材> → material 透传', () => {
    expect(parseRunRange(['split', 'docs/prd.md'])).toEqual({ from: 'split', material: 'docs/prd.md' });
  });

  it('未知词 → null（cli 层据此明确报错，不静默续跑）', () => {
    expect(parseRunRange(['胡说八道'])).toBeNull();
  });
});

describe('renderRunPlan：流水线剧本（拦停点 + 模式 + NEEDS_INFO）', () => {
  it('preset：从 clarify 推到 report（终点缺省最后阶段，四步含中间阶段）', () => {
    const out = renderRunPlan(cfg, { from: 'clarify' });
    expect(out).toContain('[TASKQ_RUN_PLAN]');
    expect(out).toContain('体检澄清');
    expect(out).toContain('拆分任务');
    expect(out).toContain('接力执行');
    expect(out).toContain('报告复盘');
    expect(out).toContain('阶段 1/4');
  });

  it('范围：clarify to execute 含中间阶段 split（共三步）', () => {
    const out = renderRunPlan(cfg, { from: 'clarify', to: 'execute' });
    expect(out).toContain('阶段 1/3');
    expect(out).toContain('拆分任务');
    expect(out).not.toContain('报告复盘');
  });

  it('split 无素材 → NEEDS_INFO；有素材 → 命令填充素材', () => {
    const need = renderRunPlan(cfg, { from: 'split' });
    expect(need).toContain('[TASKQ_NEEDS_INFO]');
    expect(need).toContain('taskq split <素材>');
    const filled = renderRunPlan(cfg, { from: 'split', material: 'docs/prd.md' });
    expect(filled).toContain('taskq split docs/prd.md');
    expect(filled).not.toContain('[TASKQ_NEEDS_INFO]');
  });

  it('--auto：非交互模式文案（拦停点自动通过）', () => {
    const out = renderRunPlan(cfg, { from: 'clarify', auto: true });
    expect(out).toContain('非交互（全自动）');
    expect(out).toContain('拦停点自动通过');
  });

  it('无效范围 → 错误提示', () => {
    const out = renderRunPlan(cfg, { from: 'report', to: 'clarify' });
    expect(out).toContain('阶段范围无效');
  });

  it('批量/批次填进执行命令（剧本声明与命令一致，不被宿主 AI 丢）', () => {
    const out = renderRunPlan(cfg, { from: 'execute', batch: 'batch-002', batchSize: 5 });
    expect(out).toContain('taskq execute --batch batch-002 --batch-size 5');
  });
});

describe('split：模块级拆分 + 混乱容错 + 截图入口 + 双模式', () => {
  it('模块级任务识别规则：标题层级 → 模块 + 子任务', () => {
    const out = splitCommand(cfg, '写文档', {});
    expect(out).toContain('模块级任务识别');
    expect(out).toContain('标题层级');
    expect(out).toContain('混乱内容容错');
  });

  it('截图入口：图片素材 → 第 0 步视觉读取（不直接拆图）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-img-'));
    const img = join(dir, 'tasks.png');
    writeFileSync(img, 'not-really-an-image', 'utf-8');
    const out = splitCommand(cfg, img, {});
    expect(out).toContain('图片素材');
    expect(out).toContain('第 0 步：视觉读取');
    expect(out).toContain('（不清）');
  });

  it('--auto：拆分清单不拦停直接往下走', () => {
    const out = splitCommand(cfg, '内容', { auto: true });
    expect(out).toContain('非交互模式（--auto）');
    expect(out).not.toContain('拆分对不对，要不要调整');
    const inter = splitCommand(cfg, '内容', {});
    expect(inter).toContain('拆分对不对，要不要调整');
  });
});

describe('pipeline：交互/非交互双模式 + 截图入口', () => {
  it('默认交互：拦停点停下问用户', () => {
    const out = pipelineCommand(cfg, '做登录系统', {});
    expect(out).toContain('交互（每个拦停点停下问用户）');
    expect(out).toContain('用户点头才进阶段 2');
  });

  it('--auto：拦停点 1/2 自动通过，拦停点 3 永不自动通过', () => {
    const out = pipelineCommand(cfg, '做登录系统', { auto: true });
    expect(out).toContain('非交互（--auto');
    expect(out).toContain('非交互模式自动通过');
    expect(out).toContain('永不自动通过');
  });

  it('图片素材：视觉读取第 0 步 + 图片章节', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-pl-img-'));
    const img = join(dir, 'shot.jpg');
    writeFileSync(img, 'fake', 'utf-8');
    const out = pipelineCommand(cfg, img, {});
    expect(out).toContain('图片');
    expect(out).toContain('第 0 步：视觉读取');
    expect(out).toContain('（不清）');
  });

  it('模块级与容错规则进阶段 1', () => {
    const out = pipelineCommand(cfg, '做登录系统', {});
    expect(out).toContain('模块级任务识别');
    expect(out).toContain('混乱内容容错');
  });
});
