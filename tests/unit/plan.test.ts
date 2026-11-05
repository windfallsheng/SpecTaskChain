// 执行计划 + 下游接力预告：依赖拓扑显性化 + 上下游全景
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig } from '../../src/core/config';
import { scanQueue, buildExecutionSequence } from '../../src/core/queue';
import { buildPlanModel, renderPlan, renderPlanBrief, renderPlanFrontmatter, parsePlanFrontmatter, planSlug } from '../../src/core/plan';
import { planCommand, resolvePlans, planBeforeExecute } from '../../src/commands/plan';
import { relayNext } from '../../src/core/runner';
import { buildTaskPrompt, detectSuspectedUpstreams } from '../../src/core/runner';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-plan-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造任务 SPEC：deps = depends-on；artifacts = 产出清单；body 可引用上游产物 */
function makeTask(cfg: TaskQConfig, id: string, opts: { deps?: string[]; artifacts?: string[]; body?: string } = {}): void {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  const depsYaml = opts.deps?.length ? `depends-on:\n${opts.deps.map((d) => `  - ${d}`).join('\n')}\n` : '';
  const artsYaml = opts.artifacts?.length
    ? `  artifacts:\n${opts.artifacts.map((a) => `    - path: ${a}`).join('\n')}\n`
    : '  review: 覆盖三节\n';
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---\ntype: doc\ngoal: ${id} 的任务\noutput: docs/${id}.md\n${depsYaml}acceptance:\n${artsYaml}---\n${opts.body || ''}`,
    'utf-8'
  );
}

describe('执行计划：依赖拓扑显性化', () => {
  it('buildPlanModel：顺序 / 上下游反查 / 关键路径 / 依赖边数', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a');
    makeTask(cfg, 'b', { deps: ['a'] });
    makeTask(cfg, 'c', { deps: ['a'] });
    makeTask(cfg, 'd', { deps: ['b', 'c'] });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const model = buildPlanModel(seq, {});
    expect(model.entries.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(model.depEdges).toBe(4); // b→a、c→a、d→b、d→c 共 4 条边
    expect(model.criticalPath).toEqual(['a', 'b', 'd']);
    const entryA = model.entries.find((e) => e.id === 'a')!;
    expect([...entryA.dependents].sort()).toEqual(['b', 'c']);
    // 模块分组：无模块 → 全部归「（独立）」
    expect(model.byModule.get('（独立）')!.map((e) => e.id)).toHaveLength(4);
  });

  it('renderPlan 输出依赖边与关键路径；renderPlanBrief 输出全景摘要', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b', { deps: ['a'] });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const model = buildPlanModel(seq, {});
    const text = renderPlan(model, { batch: 'batch-001' });
    expect(text).toContain('批次 batch-001');
    expect(text).toContain('← 依赖: a');
    expect(text).toContain('关键路径');
    expect(text).toContain('a → b');
    const brief = renderPlanBrief(model);
    expect(brief).toContain('2 任务');
    expect(brief).toContain('2 待做');
    expect(brief).toContain('1 条依赖边');
    expect(brief).toContain('接下来：a → b');
  });
});

describe('下游接力预告：上游服务下游', () => {
  it('有人 depends-on 我 → prompt 含下游段 + 它引用的产物路径', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'up', { artifacts: ['data/all.csv'] });
    makeTask(cfg, 'down', { deps: ['up'], body: '基于总表 data/all.csv 做分析' });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const up = seq.find((e) => e.spec.id === 'up')!;
    const down = seq.find((e) => e.spec.id === 'down')!;
    const prompt = buildTaskPrompt(up, cfg.metaDir, cfg.projectRoot, { deps: [], state: {}, dependents: [down] });
    expect(prompt).toContain('下游接力预告');
    expect(prompt).toContain('down');
    expect(prompt).toContain('data/all.csv');
  });

  it('无人依赖 → 无下游段；有上游依赖 → 上游摘要段仍在', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'up', { artifacts: ['data/all.csv'] });
    makeTask(cfg, 'down', { deps: ['up'], body: '基于 data/all.csv 分析' });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const up = seq.find((e) => e.spec.id === 'up')!;
    const down = seq.find((e) => e.spec.id === 'down')!;
    const solo = buildTaskPrompt(up, cfg.metaDir, cfg.projectRoot, undefined);
    expect(solo).not.toContain('下游接力预告');
    const withUpstream = buildTaskPrompt(down, cfg.metaDir, cfg.projectRoot, { deps: [up], state: {} });
    expect(withUpstream).toContain('上游依赖完成摘要');
    expect(withUpstream).toContain('data/all.csv');
  });
});

describe('疑似上游推导：引用他人产物却未声明 depends-on', () => {
  it('detectSuspectedUpstreams：多上游命中，按 owner 分组、路径去重', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['data/a.csv'] });
    makeTask(cfg, 'b', { artifacts: ['data/b.csv', 'data/b2.csv'] });
    makeTask(cfg, 'c', { body: '基于 data/a.csv 与 data/b.csv、data/b.csv 汇总' });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const c = seq.find((e) => e.spec.id === 'c')!;
    const got = detectSuspectedUpstreams(c, seq);
    expect(got.map((g) => g.owner).sort()).toEqual(['a', 'b']);
    expect(got.find((g) => g.owner === 'b')!.paths).toEqual(['data/b.csv']);
  });

  it('已声明 depends-on / 引用自己产物 / 引用无主文件 → 一律豁免', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['data/a.csv'] });
    makeTask(cfg, 'b', { deps: ['a'], body: '基于 data/a.csv 分析' });
    makeTask(cfg, 'c', { artifacts: ['docs/c.md'], body: '引用自己 docs/c.md 与无主 docs/free.md' });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    expect(detectSuspectedUpstreams(seq.find((e) => e.spec.id === 'b')!, seq)).toEqual([]);
    expect(detectSuspectedUpstreams(seq.find((e) => e.spec.id === 'c')!, seq)).toEqual([]);
  });

  it('prompt 含疑似上游段：点名产物归属与判断规则；无疑似时无该段', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'up', { artifacts: ['data/all.csv'] });
    makeTask(cfg, 'down', { body: '基于 data/all.csv 出周报' });
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const down = seq.find((e) => e.spec.id === 'down')!;
    const suspected = detectSuspectedUpstreams(down, seq);
    expect(suspected).toHaveLength(1);
    const prompt = buildTaskPrompt(down, cfg.metaDir, cfg.projectRoot, { deps: [], state: {}, suspected });
    expect(prompt).toContain('疑似上游（未声明 depends-on）');
    expect(prompt).toContain('data/all.csv');
    expect(prompt).toContain('任务 up');
    expect(prompt).toContain('判断规则');
    const up = seq.find((e) => e.spec.id === 'up')!;
    expect(buildTaskPrompt(up, cfg.metaDir, cfg.projectRoot, undefined)).not.toContain('疑似上游');
  });
});

describe('命名计划：一等资产（frontmatter 机读 / 形态配置 / 列表与详情）', () => {
  it('planCommand --name 落盘 plans/{slug}.md，frontmatter 携带 tasks 机读锚点', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b', { deps: ['a'] });
    makeTask(cfg, 'c');
    
    const out = planCommand(cfg, { name: '周报冲刺', tasks: ['a', 'b'] });
    expect(out).toContain('计划已落盘');
    expect(out).toContain('taskq run --plans');
    const md = readFileSync(join(cfg.queueDir, 'batch-001', 'overview', 'plans', 'zhoubaochongci.md'), 'utf-8');
    expect(md).toContain('plan-name: 周报冲刺');
    expect(md).toContain('tasks: [a, b]');
    expect(md).toContain('# 📋 计划：周报冲刺');
    // 范围圈定生效：c 不在计划里（断言 goal 而非序号——序号/时间戳含「3.」会造成毫秒级 flaky）
    expect(md).not.toContain('c 的任务');
  });

  it('--format html 伴生同院 HTML 页；none 不落盘', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    
    const outHtml = planCommand(cfg, { name: '蓝图', tasks: ['a'], format: 'html' });
    expect(outHtml).toContain('HTML 页');
    const html = readFileSync(join(cfg.queueDir, 'batch-001', 'overview', 'plans', 'lantu.html'), 'utf-8');
    expect(html).toContain('📋 计划：蓝图');
    expect(html).toContain('PingFang SC');
    const cfg2 = makeCfg();
    makeTask(cfg2, 'a');
    const outNone = planCommand(cfg2, { name: '一次性', tasks: ['a'], format: 'none' });
    expect(outNone).toContain('plan-format: none');
    expect(!existsSync(join(cfg2.queueDir, 'batch-001', 'overview', 'plans'))).toBe(true);
  });

  it('--list 列计划资产；--show 渲染详情带状态', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b', { deps: ['a'] });
    
    planCommand(cfg, { name: '甲计划', tasks: ['a'] });
    planCommand(cfg, { name: '乙计划', tasks: ['a', 'b'], format: 'html' });
    const list = planCommand(cfg, { list: true });
    expect(list).toContain('命名计划（批次 batch-001，共 2 个）');
    expect(list).toContain('jiajihua');
    expect(list).toContain('yijihua');
    expect(list).toContain('md+html');
    expect(list).toContain('taskq plan --show');
    const show = planCommand(cfg, { show: 'yijihua' });
    expect(show).toContain('📋 执行计划');
    expect(show).toContain('a');
    expect(show).toContain('b');
    expect(show).toContain('← 依赖: a');
    // 不存在报错提示
    const miss = planCommand(cfg, { show: '不存在' });
    expect(miss).toContain('❌ 计划「不存在」不存在');
  });

  it('resolvePlans：多计划任务并集 + 缺失名明确报错', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a');
    makeTask(cfg, 'b');
    makeTask(cfg, 'c');
    
    planCommand(cfg, { name: '甲', tasks: ['a', 'b'] });
    planCommand(cfg, { name: '乙', tasks: ['b', 'c'] });
    const r = resolvePlans(cfg, 'batch-001', ['jia', 'yi']);
    expect(r.missing).toEqual([]);
    expect([...r.taskIds].sort()).toEqual(['a', 'b', 'c']);
    const bad = resolvePlans(cfg, 'batch-001', ['jia', '幽灵']);
    expect(bad.missing).toEqual(['幽灵']);
  });

  it('relayNext 按 taskIds（--plans 效果）只领计划内任务', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b', { deps: ['a'] });
    makeTask(cfg, 'c');
    
    const r = relayNext(cfg, { taskIds: ['b', 'a'] });
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('a'); // 计划内拓扑序第一个，c 不在计划内
  });

  it('planBeforeExecute：批量执行默认先计划；定向或 --no-plan 跳过', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b');
    const note = planBeforeExecute(cfg, 'batch-001', {}).text;
    expect(note).toContain('📋 执行计划');
    expect(note).toContain('计划已落盘');
    // 默认 md + html 双生：底稿与 HTML 伴生页都在
    expect(existsSync(join(cfg.queueDir, 'batch-001', 'overview', 'PLAN.md'))).toBe(true);
    expect(existsSync(join(cfg.queueDir, 'batch-001', 'overview', 'PLAN.html'))).toBe(true);
    // 定向执行：用户已指定范围，不重复仪式
    expect(planBeforeExecute(cfg, 'batch-001', { directed: true }).text).toBe('');
    // 显式 --no-plan 强制跳过
    expect(planBeforeExecute(cfg, 'batch-001', { noPlan: true }).text).toBe('');
  });

  it('planBeforeExecute：已有计划沿用不重列（谋已定不再重谋）；--replan 强制重列', () => {
    const cfg = makeCfg();
    makeTask(cfg, 'a', { artifacts: ['docs/a.md'] });
    makeTask(cfg, 'b');
    // 第一次：无计划 → 落盘
    const first = planBeforeExecute(cfg, 'batch-001', {}).text;
    expect(first).toContain('📋 执行计划');
    const planPath = join(cfg.queueDir, 'batch-001', 'overview', 'PLAN.md');
    // 人为改动计划（模拟用户审阅调整），再执行应沿用不覆盖，且按计划 frontmatter tasks 锁定执行范围
    writeFileSync(planPath, '---\nplan-name: 全景计划（用户审阅版）\ntasks: [a]\n---\n人工调整过的计划', 'utf-8');
    const reuse = planBeforeExecute(cfg, 'batch-001', {});
    expect(reuse.text).toContain('沿用批次现有执行计划');
    expect(reuse.text).toContain('按计划圈定任务集执行（1 个任务）');
    expect(reuse.planTaskIds).toEqual(['a']);
    expect(readFileSync(planPath, 'utf-8')).toContain('人工调整过的计划');
    // --replan 强制重列 → 覆盖回机器版
    const replan = planBeforeExecute(cfg, 'batch-001', { replan: true });
    expect(replan.text).toContain('📋 执行计划');
    expect(readFileSync(planPath, 'utf-8')).not.toContain('人工调整过的计划');
  });

  it('planBeforeExecute：队列为空谋无可谋，跳过仪式不落计划', () => {
    const cfg = makeCfg();
    const r = planBeforeExecute(cfg, undefined, {});
    expect(r.text).toBe('');
    expect(r.planTaskIds).toBeUndefined();
    expect(existsSync(join(cfg.queueDir, 'batch-001', 'overview'))).toBe(false);
  });

  it('planBeforeExecute：计划生成异常降级为警告，不阻断接力主流程', () => {
    // queueDir 指向一个文件 → scanQueue readdirSync 抛 ENOTDIR → 被仪式兜住
    const cfg = makeCfg();
    const badPath = join(cfg.projectRoot, 'not-a-dir');
    writeFileSync(badPath, 'x', 'utf-8');
    const note = planBeforeExecute({ ...cfg, queueDir: badPath }, 'batch-001', {}).text;
    expect(note).toContain('计划生成失败');
    expect(note).toContain('不影响任务接力');
  });

  it('renderPlanFrontmatter/parsePlanFrontmatter 往返一致', () => {
    
    const fm = renderPlanFrontmatter({ name: '预算季度版', tasks: ['a', 'b'], modules: ['module-x'], createdAt: '2026-11-05T00:00:00.000Z' });
    const back = parsePlanFrontmatter(fm + '\n\n正文');
    expect(back!.name).toBe('预算季度版');
    expect(back!.tasks).toEqual(['a', 'b']);
    expect(back!.modules).toEqual(['module-x']);
    expect(back!.createdAt).toBe('2026-11-05T00:00:00.000Z');
    expect(planSlug('预算季度版')).toBe('yusuanjiduban');
    expect(parsePlanFrontmatter('没有 frontmatter')).toBeNull();
  });
});
