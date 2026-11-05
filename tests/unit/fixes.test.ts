// 修复回归测试：评审门禁负向判定 / ID 碰撞 / 原子写 / doing 占位 / failed 拦截 / 环拓扑 / glob 中间段 / 转义
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verdictPassed, runAcceptance } from '../../src/core/acceptance';
import { writeState, readState, TaskQConfig, TaskRunState } from '../../src/core/config';
import { newCommand } from '../../src/commands/new';
import { relayNext, markTaskState } from '../../src/core/runner';
import { scanQueue, buildExecutionSequence, findNextPending, DOING_TIMEOUT_MS } from '../../src/core/queue';
import { detectCycles, detectDuplicateNames, taskIdFromPath } from '../../src/core/clarify';
import { renderSpec, parseFrontmatter, buildSpec } from '../../src/core/task-spec';
import { generatePanelHtml } from '../../src/core/panel';
import { readVersion } from '../../src/core/version';
import { initCommand } from '../../src/commands/init';
import { resetCommand } from '../../src/commands/reset';

/** 造一个干净的临时队列配置 */
function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-fix-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 在 cfg 下造一个可执行任务（顶层） */
function makeTask(cfg: TaskQConfig, id: string, extra: string = ''): string {
  const dir = join(cfg.queueDir, 'tasks', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: 写文档
output: docs/
acceptance:
  artifacts:
    - path: docs/${id}.md
${extra}---
写文档`,
    'utf-8'
  );
  return dir;
}

describe('评审门禁：负向判定绝不误放', () => {
  it('verdictPassed：负向词一律不过（fail/不通过/未通过/不符合/✗/❌）', () => {
    expect(verdictPassed('fail 结构混乱')).toBe(false);
    expect(verdictPassed('不通过')).toBe(false);
    expect(verdictPassed('未通过')).toBe(false);
    expect(verdictPassed('不符合 规范')).toBe(false);
    expect(verdictPassed('✗ 有遗漏')).toBe(false);
    expect(verdictPassed('❌')).toBe(false);
  });

  it('verdictPassed：负向优先于正向（混写时判不过）', () => {
    expect(verdictPassed('fail 但整体符合')).toBe(false);
  });

  it('verdictPassed：正向词通过 / 空 verdict 向后兼容通过', () => {
    expect(verdictPassed('pass 结构清晰')).toBe(true);
    expect(verdictPassed('通过')).toBe(true);
    expect(verdictPassed('符合 要求')).toBe(true);
    expect(verdictPassed('✓')).toBe(true);
    expect(verdictPassed('✅')).toBe(true);
    expect(verdictPassed(undefined)).toBe(true);
    expect(verdictPassed('')).toBe(true);
  });

  it('verdictPassed：纯评语无结论词 → 不过（机器不猜）', () => {
    expect(verdictPassed('结构清晰完整')).toBe(false);
  });

  it('runAcceptance：review 非空 + verdict 负向 → 验收不过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-acc-'));
    writeFileSync(join(dir, 'doc.md'), '内容', 'utf-8');
    const r = runAcceptance(
      { artifacts: [{ path: 'doc.md' }], checks: [], review: '结构一致' },
      dir,
      'fail 缺字段'
    );
    expect(r.passed).toBe(false);
  });
});

describe('glob 产物门禁：* 可出现在任意路径段', () => {
  it('docs/*/plan.md 匹配一层子目录产物', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-glob-'));
    mkdirSync(join(dir, 'docs', 'migration'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'migration', 'plan.md'), '有内容', 'utf-8');
    const r = runAcceptance(
      { artifacts: [{ path: 'docs/*/plan.md' }], checks: [], review: '' },
      dir
    );
    expect(r.passed).toBe(true);
    expect(r.artifacts[0].matched).toBe(1);
  });

  it('docs/*/plan.md 不跨目录吞多级（两层的子目录产物不算命中）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-glob-'));
    mkdirSync(join(dir, 'docs', 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'a', 'b', 'plan.md'), '有内容', 'utf-8');
    const r = runAcceptance(
      { artifacts: [{ path: 'docs/*/plan.md' }], checks: [], review: '' },
      dir
    );
    expect(r.passed).toBe(false);
  });
});

describe('state.json：原子写 + 损坏备份', () => {
  it('writeState 落盘后无 .tmp 残留，内容完整', () => {
    const cfg = makeCfg();
    const tasks: Record<string, TaskRunState> = { '01-a': { status: 'done', attempts: 0 } };
    writeState(cfg, tasks);
    expect(existsSync(join(cfg.metaDir, 'state.json.tmp'))).toBe(false);
    const raw = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(raw.tasks['01-a'].status).toBe('done');
  });

  it('readState：损坏文件备份为 .bak 并回空状态（不抛异常）', () => {
    const cfg = makeCfg();
    mkdirSync(cfg.metaDir, { recursive: true });
    writeFileSync(join(cfg.metaDir, 'state.json'), '{损坏的 json', 'utf-8');
    const state = readState(cfg);
    expect(state).toEqual({});
    expect(existsSync(join(cfg.metaDir, 'state.json.bak'))).toBe(true);
  });
});

describe('taskq new：任务 ID 碰撞拒绝覆盖', () => {
  it('同 slug 再建 → 拼短 hash 不覆盖（ID 碰撞保护）', () => {
    const cfg = makeCfg();
    const dir = makeTask(cfg, 'task-xiewendang');
    writeFileSync(join(dir, 'SPEC.md'), '原文件内容', 'utf-8');
    const out = newCommand(cfg, { name: 'xiewendang', goal: '新任务', draft: true });
    // 撞名拼短 hash（sha1(name) 前 6 位）：新任务 task-xiewendang-7d56cb，原 task-xiewendang 不被覆盖
    expect(out).toContain('task-xiewendang-7d56cb');
    expect(out).toContain('撞名拼短 hash 区分');
    expect(readFileSync(join(dir, 'SPEC.md'), 'utf-8')).toBe('原文件内容');
    expect(readFileSync(join(cfg.queueDir, 'batch-001', 'task-xiewendang-7d56cb', 'SPEC.md'), 'utf-8')).toContain('新任务');
  });

  it('同名同内容重复建 → 第二次拼 hash、第三次报错提示换名', () => {
    const cfg = makeCfg();
    newCommand(cfg, { goal: '新任务', name: 'xinrenwu', draft: true });
    expect(newCommand(cfg, { goal: '新任务', name: 'xinrenwu', draft: true })).toContain('task-xinrenwu-');
    const third = newCommand(cfg, { goal: '新任务', name: 'xinrenwu', draft: true });
    expect(third).toContain('❌');
    expect(third).toContain('换一个 --name');
  });
});

describe('接力协议：doing 占位与 failed 拦截', () => {
  it('relayNext 输出 prompt 的同时占位 doing（带 doingAt），并发二跑返回 12', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-task-01');
    const first = relayNext(cfg);
    expect(first.exitCode).toBe(10);
    const st = readState(cfg)['01-task-01'];
    expect(st.status).toBe('doing');
    expect(st.doingAt).toBeTruthy();
    // 执行者未中断：第二个 run 不重复领取
    const second = relayNext(cfg);
    expect(second.exitCode).toBe(12);
    expect(second.summary).toContain('正在执行中');
  });

  it('孤儿 doing 超时 24h → findNextPending 重拾（续跑不靠人工改状态）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-task-01');
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    const state = {
      '01-task-01': { status: 'doing', attempts: 0, doingAt: new Date(Date.now() - DOING_TIMEOUT_MS - 1000).toISOString() },
    };
    expect(findNextPending(seq, state)).toBeTruthy();
  });

  it('failed 达上限 → relayNext 返回 12 需人工介入（不静默重跑）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-task-01');
    for (let i = 0; i < 3; i++) markTaskState(cfg, '01-task-01', 'failed', 'fail');
    const r = relayNext(cfg);
    expect(r.exitCode).toBe(12);
    expect(r.summary).toContain('需人工介入');
    expect(readState(cfg)['01-task-01'].attempts).toBe(3);
  });
});

describe('拓扑排序：环不阻断执行', () => {
  it('A↔B 循环依赖：序列仍完整含两者（按原序平铺）', () => {
    const cfg = makeCfg();
    const a = join(cfg.queueDir, 'tasks', '01-a');
    const b = join(cfg.queueDir, 'tasks', '02-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'SPEC.md'), '---\ngoal: A\noutput: docs/\ndepends-on:\n  - 02-b\nacceptance:\n  artifacts:\n    - path: docs/a.md\n---\nA', 'utf-8');
    writeFileSync(join(b, 'SPEC.md'), '---\ngoal: B\noutput: docs/\ndepends-on:\n  - 01-a\nacceptance:\n  artifacts:\n    - path: docs/b.md\n---\nB', 'utf-8');
    const seq = buildExecutionSequence(scanQueue(cfg.queueDir, cfg.metaDir));
    expect(seq.length).toBe(2);
    expect(seq.map((e) => e.spec.id).sort()).toEqual(['01-a', '02-b']);
  });

  it('detectCycles：A→B→A 报建议级环信号', () => {
    const cfg = makeCfg();
    const a = join(cfg.queueDir, 'tasks', '01-a');
    const b = join(cfg.queueDir, 'tasks', '02-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'SPEC.md'), '---\ngoal: A\noutput: docs/\ndepends-on:\n  - 02-b\nacceptance:\n  artifacts:\n    - path: docs/a.md\n---\nA', 'utf-8');
    writeFileSync(join(b, 'SPEC.md'), '---\ngoal: B\noutput: docs/\ndepends-on:\n  - 01-a\nacceptance:\n  artifacts:\n    - path: docs/b.md\n---\nB', 'utf-8');
    const issues = detectCycles(scanQueue(cfg.queueDir, cfg.metaDir));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].level).toBe('suggest');
    expect(issues[0].message).toContain('循环依赖');
  });
});

describe('clarify：跨层 ID 重复 → 阻塞', () => {
  it('模块子任务 ID 与顶层任务重复 → blocking（状态键共享风险）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-task-x');
    const subDir = join(cfg.queueDir, 'tasks', 'auth', '01-task-x');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'SPEC.md'),
      '---\ngoal: 子任务\noutput: src/\nacceptance:\n  artifacts:\n    - path: src/x.ts\n---\n子',
      'utf-8'
    );
    const issues = detectDuplicateNames(scanQueue(cfg.queueDir, cfg.metaDir));
    const dup = issues.find((i) => i.level === 'blocking');
    expect(dup).toBeTruthy();
    expect(dup!.message).toContain('共享状态');
  });
});

describe('规格渲染与路径处理', () => {
  it('renderSpec：多行 goal/name/review 折叠为单行（不产生坏 YAML）', () => {
    const out = renderSpec({
      goal: '第一行\n第二行',
      name: '显示\n名称',
      output: 'docs/',
      acceptance: { artifacts: [{ path: 'docs/x.md' }], checks: [], review: '结构\n一致' },
    });
    expect(out).toContain('goal: 第一行 第二行');
    expect(out).toContain('name: 显示 名称');
    expect(out).toContain('review: 结构 一致');
    // 渲染产物能被自己的解析器读回
    const { data } = parseFrontmatter(out);
    const spec = buildSpec('01-x', '/tmp/x', data, '', 'general');
    expect(spec.goal).toBe('第一行 第二行');
    expect(spec.acceptance.review).toBe('结构 一致');
  });

  it('taskIdFromPath：路径末段跨平台提取', () => {
    expect(taskIdFromPath('/a/b/01-task-01/SPEC.md')).toBe('01-task-01');
    expect(taskIdFromPath('/a/b/01-task-01')).toBe('01-task-01');
    expect(taskIdFromPath('01-task-01/SPEC.md')).toBe('01-task-01');
  });
});

describe('面板：HTML 转义防注入', () => {
  it('任务名/目标含 <script> 等 → 输出被转义', () => {
    const cfg = makeCfg();
    const dir = join(cfg.queueDir, 'tasks', '01-a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SPEC.md'),
      '---\ngoal: 目标<script>alert(1)</script>与"引号"\noutput: docs/\nacceptance:\n  artifacts:\n    - path: docs/a.md\n---\n正文',
      'utf-8'
    );
    const panelPath = generatePanelHtml(cfg);
    const html = readFileSync(panelPath, 'utf-8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;引号&quot;');
  });
});

describe('版本事实源与 init 工具参数', () => {
  it('readVersion 与 package.json 一致（唯一事实源）', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    expect(readVersion()).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('initCommand 带 --tools 不静默吞参数，生成规则并明示路径', () => {
    const out = initCommand(makeCfg().projectRoot, { tools: ['qoder'] });
    expect(out).toContain('已生成 qoder');
    expect(out).toContain('taskq-relay.md');
  });

  it('initCommand 不带 --tools 不出现该说明（原输出不受影响）', () => {
    const out = initCommand(makeCfg().projectRoot);
    expect(out).not.toContain('工具无关');
    expect(out).toContain('Chain = 接力（relay），不是依赖（dependency）。');
  });

  it('已有批次时 init/--update 不复活 batch-001（手动合并/删批次后不回流）', () => {
    const root = makeCfg().projectRoot;
    mkdirSync(join(root, 'queue', 'batch-002'), { recursive: true });
    initCommand(root); // 常规 init
    expect(existsSync(join(root, 'queue', 'batch-001'))).toBe(false);
    initCommand(root, { update: true }); // --update 同样不复活
    expect(existsSync(join(root, 'queue', 'batch-001'))).toBe(false);
  });

  it('队列完全没有批次区时 init 仍建 batch-001 起步（零起步不受影响）', () => {
    const root = makeCfg().projectRoot;
    initCommand(root);
    expect(existsSync(join(root, 'queue', 'batch-001'))).toBe(true);
  });

  it('initCommand --tools qoder 生成 .qoder/rules/taskq-relay.md（真实产出）', () => {
    const root = makeCfg().projectRoot;
    const out = initCommand(root, { tools: ['qoder'] });
    expect(out).toContain('taskq-relay.md');
    const p = join(root, '.qoder', 'rules', 'taskq-relay.md');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8');
    expect(content).toContain('接力协议');
    expect(content).toContain('[TASKQ_PROMPT]');
    expect(content).toContain('规则版本');
  });

  it('initCommand --tools qoder 同时生成 SKILL 薄包装入口（对齐 speccore ask）', () => {
    const root = makeCfg().projectRoot;
    const out = initCommand(root, { tools: ['qoder'] });
    expect(out).toContain('SKILL 入口');
    const p = join(root, '.agents', 'skills', 'taskq-ask', 'SKILL.md');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf-8');
    expect(content).toContain('name: taskq-ask');
    expect(content).toContain('taskq ask');
    expect(content).toContain('[TASKQ_PROMPT]');
    expect(content).toContain('allowed-tools');
    expect(content).toContain('SKILL 版本');
    // taskq-clarify 专属 SKILL 含澄清留痕守则（自动模式必写澄清记录）
    const clarifySkill = readFileSync(join(root, '.agents', 'skills', 'taskq-clarify', 'SKILL.md'), 'utf-8');
    expect(clarifySkill).toContain('澄清留痕');
    expect(clarifySkill).toContain('澄清记录');
  });

  it('旧版 taskq 总入口（≤0.2.8）在 init/--update 时自动迁移清理为 taskq-ask', () => {
    const root = makeCfg().projectRoot;
    // 模拟旧版：先生成 0.2.8 形态的 taskq 目录（含 SKILL.md）
    const legacyDir = join(root, '.agents', 'skills', 'taskq');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'SKILL.md'), 'name: taskq\n旧版总入口', 'utf-8');
    initCommand(root, { tools: ['qoder'] });
    expect(existsSync(legacyDir)).toBe(false); // 旧目录被清理，防幽灵入口
    expect(existsSync(join(root, '.agents', 'skills', 'taskq-ask', 'SKILL.md'))).toBe(true);
  });

  it('initCommand --tools claude/cursor 生成各自 skill 目录；windsurf 不生成（无 skill 约定）', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['claude', 'cursor', 'windsurf'] });
    expect(existsSync(join(root, '.claude', 'skills', 'taskq-ask', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'skills', 'taskq-ask', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.windsurf', 'skills'))).toBe(false);
  });

  it('initCommand --update 同步刷新已生成的 SKILL 至当前版本', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['qoder'] });
    const out = initCommand(root, { update: true });
    expect(out).toContain('SKILL 文件');
    expect(readFileSync(join(root, '.agents', 'skills', 'taskq-ask', 'SKILL.md'), 'utf-8')).toContain('SKILL 版本');
  });

  it('initCommand --tools claude 追加锚点块且重复执行不重复', () => {
    const root = makeCfg().projectRoot;
    writeFileSync(join(root, 'CLAUDE.md'), '# 项目说明\n\n现有内容\n', 'utf-8');
    initCommand(root, { tools: ['claude'] });
    initCommand(root, { tools: ['claude'] });
    const content = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(content.split('## taskq 接力协议').length - 1).toBe(1);
    expect(content).toContain('现有内容');
  });

  it('initCommand --tools 多工具数组全生成', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['qoder', 'cursor'] });
    expect(existsSync(join(root, '.qoder', 'rules', 'taskq-relay.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'rules', 'taskq-relay.md'))).toBe(true);
  });

  it('initCommand 未知工具报警告不落盘', () => {
    const root = makeCfg().projectRoot;
    const out = initCommand(root, { tools: ['nope'] });
    expect(out).toContain('暂不支持');
    expect(existsSync(join(root, '.nope'))).toBe(false);
  });

  it('initCommand --update 刷新已生成的规则至当前版本（对齐 speccore）', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['qoder'] });
    const out = initCommand(root, { update: true });
    expect(out).toContain('已刷新 1 个');
    expect(out).toContain('taskq-relay.md');
    expect(readFileSync(join(root, '.qoder', 'rules', 'taskq-relay.md'), 'utf-8')).toContain('规则版本');
  });

  it('initCommand --update 无已生成规则时给出引导', () => {
    const out = initCommand(makeCfg().projectRoot, { update: true });
    expect(out).toContain('未发现已生成的工具规则');
  });

  it('initCommand --update 指定工具只刷新该工具', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['qoder', 'cursor'] });
    const out = initCommand(root, { update: true, tools: ['qoder'] });
    expect(out).toContain('已刷新 1 个');
  });
});

describe('0.2.5：定向执行 + 重跑复位 + SKILL 矩阵', () => {
  /** batch-001 布局造顶层任务 */
  function makeBatchTask(cfg: TaskQConfig, id: string): string {
    const dir = join(cfg.queueDir, 'batch-001', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SPEC.md'),
      `---\ntype: doc\ngoal: 写文档\noutput: docs/\nacceptance:\n  artifacts:\n    - path: docs/${id}.md\n---\n写文档`,
      'utf-8'
    );
    return dir;
  }

  /** batch-001 布局造模块（带共享约束）+ 子任务 */
  function makeBatchModule(cfg: TaskQConfig, moduleId: string, subIds: string[]): string {
    const moduleDir = join(cfg.queueDir, 'batch-001', moduleId);
    for (const sub of subIds) {
      const subDir = join(moduleDir, sub);
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'SPEC.md'),
        `---\ntype: feature\ngoal: 实现子任务\noutput: src/\nacceptance:\n  artifacts:\n    - path: src/${sub}.ts\n---\n子任务正文`,
        'utf-8'
      );
    }
    writeFileSync(join(moduleDir, 'CONSTRAINTS.md'), '模块公共约束：统一使用 TypeScript。', 'utf-8');
    return moduleDir;
  }

  it('run --task 只领指定任务；不存在的 ID 明确报错不悄悄跑全量', () => {
    const cfg = makeCfg();
    makeBatchTask(cfg, '01-a');
    makeBatchTask(cfg, '02-b');
    const r = relayNext(cfg, { task: '02-b' });
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('02-b');
    const miss = relayNext(cfg, { task: '99-none' });
    expect(miss.exitCode).toBe(12);
    expect(miss.summary).toContain('定向目标不存在');
  });

  it('run --module 领模块全部子任务（序列被过滤到只剩该模块）', () => {
    const cfg = makeCfg();
    makeBatchTask(cfg, '01-a');
    makeBatchModule(cfg, 'module-demo', ['01-sub', '02-sub']);
    const r = relayNext(cfg, { module: 'module-demo' });
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('01-sub'); // 顶层任务被过滤掉，首个 pending 是模块子任务
  });

  it('reset 软复位：状态回 todo + attempts 清零，留痕保留（重跑=调整补充）', () => {
    const cfg = makeCfg();
    const dir = makeBatchTask(cfg, '01-a');
    writeState(cfg, { '01-a': { status: 'done', attempts: 2, verdict: 'pass 已验收' } });
    writeFileSync(join(dir, 'PROGRESS.md'), '阶段性留痕：已完成初稿');
    const out = resetCommand(cfg, '01-a');
    expect(out).toContain('已复位 1 个任务');
    expect(out).toContain('调整补充');
    const st = readState(cfg)['01-a'];
    expect(st.status).toBe('todo');
    expect(st.attempts).toBe(0);
    expect(existsSync(join(dir, 'PROGRESS.md'))).toBe(true);
  });

  it('reset --hard：连留痕 PROGRESS.md 清空（重跑=从头再来）', () => {
    const cfg = makeCfg();
    const dir = makeBatchTask(cfg, '01-a');
    writeState(cfg, { '01-a': { status: 'failed', attempts: 1 } });
    writeFileSync(join(dir, 'PROGRESS.md'), '旧的阶段留痕');
    const out = resetCommand(cfg, '01-a', { hard: true });
    expect(out).toContain('从头再来');
    expect(existsSync(join(dir, 'PROGRESS.md'))).toBe(false);
    expect(readState(cfg)['01-a'].status).toBe('todo');
  });

  it('reset 支持模块定向与 --all；目标不存在报错', () => {
    const cfg = makeCfg();
    makeBatchTask(cfg, '01-a');
    makeBatchModule(cfg, 'module-demo', ['01-sub', '02-sub']);
    writeState(cfg, { '01-a': { status: 'done', attempts: 1 }, '01-sub': { status: 'done', attempts: 1 }, '02-sub': { status: 'done', attempts: 1 } });
    expect(resetCommand(cfg, 'module-demo')).toContain('已复位 2 个任务');
    expect(readState(cfg)['01-sub'].status).toBe('todo');
    expect(readState(cfg)['01-a'].status).toBe('done'); // 模块外任务不动
    expect(resetCommand(cfg, '--all')).toContain('已复位 3 个任务');
    expect(resetCommand(cfg, '99-none')).toContain('找不到');
  });

  it('init --tools qoder 生成 5 个 SKILL：1 总入口 + 4 高频专属（下拉矩阵）', () => {
    const root = makeCfg().projectRoot;
    initCommand(root, { tools: ['qoder'] });
    const base = join(root, '.agents', 'skills');
    for (const name of ['taskq-ask', 'taskq-new', 'taskq-run', 'taskq-clarify', 'taskq-done']) {
      expect(existsSync(join(base, name, 'SKILL.md'))).toBe(true);
    }
    const sub = readFileSync(join(base, 'taskq-run', 'SKILL.md'), 'utf-8');
    expect(sub).toContain('name: taskq-run');
    expect(sub).toContain('taskq run');
    expect(sub).toContain('--task <id>');
    // 重跑分流：taskq-run 不只管接力，重新执行/从头再来有专属路径
    expect(sub).toContain('重新执行/重跑某个任务或模块');
    expect(sub).toContain('taskq reset --all --hard');
    expect(sub).toContain('重跑三态');
    const main = readFileSync(join(base, 'taskq-ask', 'SKILL.md'), 'utf-8');
    expect(main).toContain('/taskq-new /taskq-run /taskq-clarify /taskq-done');
    expect(main).toContain('taskq reset');
  });

  it('init --tools windsurf 不生成 SKILL（无 skill 约定，规则照常）', () => {
    const root = makeCfg().projectRoot;
    const out = initCommand(root, { tools: ['windsurf'] });
    expect(out).toContain('windsurf');
    expect(out).not.toContain('SKILL 入口');
    expect(existsSync(join(root, '.windsurf', 'rules', 'taskq-relay.md'))).toBe(true);
  });
});
