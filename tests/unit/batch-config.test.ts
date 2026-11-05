// BATCH.yaml 批次配置：系统默认 / 三级兜底 / 优先级链 / 幂等落盘
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQConfig, ensureStructure } from '../../src/core/config';
import { parseBatchConfig, readBatchConfig, locateBatchConfig, renderBatchConfig, ensureBatchConfig, SYSTEM_BATCH_DEFAULTS, BATCH_CONFIG_VERSION, BATCH_CONFIG_FILE, BATCH_CONFIG_DIR } from '../../src/core/batch-config';
import { batchRelay, relayNext } from '../../src/core/runner';
import { doneCommand } from '../../src/commands/done';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-bcfg-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

/** 造一个顶层任务（可选 draft） */
function makeTask(cfg: TaskQConfig, id: string, extra: { draft?: boolean } = {}): void {
  const dir = join(cfg.queueDir, 'batch-001', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SPEC.md'),
    `---
type: doc
goal: ${id} 的任务
output: docs/${id}.md
${extra.draft ? 'draft: true\n' : ''}acceptance:
  artifacts:
    - path: docs/${id}.md
---
写 ${id} 的文档
`,
    'utf-8'
  );
}

describe('parseBatchConfig：字段级兜底', () => {
  it('正常解析：五键全生效', () => {
    const c = parseBatchConfig('version: 1\nbatch-size: 5\nmax-attempts: 2\nskip-draft: true\nreports: false\noverwrite: false\n');
    expect(c['batch-size']).toBe(5);
    expect(c['max-attempts']).toBe(2);
    expect(c['skip-draft']).toBe(true);
    expect(c.reports).toBe(false);
    expect(c.overwrite).toBe(false);
  });

  it('reports/overwrite 缺省/非布尔 → 回落系统默认 true（默认会生成报告、默认会覆盖）', () => {
    expect(parseBatchConfig('batch-size: 2\n').reports).toBe(true);
    expect(parseBatchConfig('reports: 随便写的\n').reports).toBe(true);
    expect(parseBatchConfig("reports: 'true'\n").reports).toBe(true);
    expect(parseBatchConfig('batch-size: 2\n').overwrite).toBe(true);
    expect(parseBatchConfig('overwrite: 随便写的\n').overwrite).toBe(true);
  });

  it('单个字段异常只回落该字段，其余照常生效（用户手改一半也要尊重）', () => {
    const c = parseBatchConfig('batch-size: 5\nmax-attempts: -1\nskip-draft: 随便写的\n');
    expect(c['batch-size']).toBe(5); // 正常字段保留
    expect(c['max-attempts']).toBe(SYSTEM_BATCH_DEFAULTS['max-attempts']); // 负数回落默认
    expect(c['skip-draft']).toBe(false); // 非布尔回落默认
  });

  it('0 / 非数 / 空文本全部回落系统默认', () => {
    expect(parseBatchConfig('batch-size: 0\n')).toEqual(SYSTEM_BATCH_DEFAULTS);
    expect(parseBatchConfig('batch-size: abc\n')).toEqual(SYSTEM_BATCH_DEFAULTS);
    expect(parseBatchConfig('')).toEqual(SYSTEM_BATCH_DEFAULTS);
  });
});

describe('readBatchConfig / locateBatchConfig：文件级兜底', () => {
  it('文件缺失 → 系统默认（静默回落）', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.queueDir, 'batch-001'), { recursive: true });
    expect(readBatchConfig(join(cfg.queueDir, 'batch-001'))).toEqual(SYSTEM_BATCH_DEFAULTS);
  });

  it('从任务目录向上爬升找到所属批次配置', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 7\n', 'utf-8');
    // 任务目录 queue/batch-001/01-a 向上两级到批次目录
    const c = locateBatchConfig(join(cfg.queueDir, 'batch-001', '01-a'), cfg.queueDir);
    expect(c['batch-size']).toBe(7);
  });

  it('队列根也找不到 → 系统默认', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const c = locateBatchConfig(join(cfg.queueDir, 'batch-001', '01-a'), cfg.queueDir);
    expect(c).toEqual(SYSTEM_BATCH_DEFAULTS);
  });
});

describe('renderBatchConfig / ensureBatchConfig：模板与幂等', () => {
  it('模板含 version 戳 + 五键 + 详细注释', () => {
    const t = renderBatchConfig();
    expect(t).toContain(`version: ${BATCH_CONFIG_VERSION}`);
    expect(t).toContain('batch-size: 3');
    expect(t).toContain('max-attempts: 3');
    expect(t).toContain('skip-draft: false');
    expect(t).toContain('reports: true');
    expect(t).toContain('overwrite: true');
    expect(t).toContain('优先级链'); // 注释讲清覆盖关系
    expect(t).toContain('taskq execute --batch-size'); // 注释讲清临时覆盖命令
    expect(t).toContain('--no-report'); // 注释讲清报告开关的临时覆盖
    expect(t).toContain('--no-overwrite'); // 注释讲清覆盖开关的临时指令
    expect(t).toContain('sources/SPEC.md'); // 注释讲清覆盖前的归档落点
  });

  it('overrides 定制首版配置', () => {
    const t = renderBatchConfig({ 'batch-size': 9 });
    expect(t).toContain('batch-size: 9');
    expect(t).toContain('max-attempts: 3'); // 未覆盖的取系统默认
  });

  it('ensureBatchConfig 幂等：已存在绝不覆盖用户手改', () => {
    const cfg = makeCfg();
    const batchDir = join(cfg.queueDir, 'batch-001');
    mkdirSync(batchDir, { recursive: true });
    expect(ensureBatchConfig(batchDir)).toBe(true); // 首次生成 → config/BATCH.yaml
    const cfgPath = join(batchDir, BATCH_CONFIG_DIR, BATCH_CONFIG_FILE);
    expect(existsSync(cfgPath)).toBe(true);
    writeFileSync(cfgPath, 'batch-size: 11\n', 'utf-8'); // 用户手改
    expect(ensureBatchConfig(batchDir)).toBe(false); // 二次调用跳过
    expect(readFileSync(cfgPath, 'utf-8')).toBe('batch-size: 11\n'); // 手改保留
  });

  it('ensureBatchConfig 迁移：旧位置（批次根 BATCH.yaml）内容原样搬入 config/，旧文件移除', () => {
    const cfg = makeCfg();
    const batchDir = join(cfg.queueDir, 'batch-001');
    mkdirSync(batchDir, { recursive: true });
    // 旧版本（≤0.2.23）的落盘地：批次根 BATCH.yaml，用户手改过
    writeFileSync(join(batchDir, BATCH_CONFIG_FILE), 'batch-size: 13\nskip-draft: true\n', 'utf-8');
    expect(ensureBatchConfig(batchDir)).toBe(true); // 迁移执行
    const cfgPath = join(batchDir, BATCH_CONFIG_DIR, BATCH_CONFIG_FILE);
    expect(readFileSync(cfgPath, 'utf-8')).toBe('batch-size: 13\nskip-draft: true\n'); // 内容原样
    expect(existsSync(join(batchDir, BATCH_CONFIG_FILE))).toBe(false); // 旧文件已移除
    expect(readBatchConfig(batchDir)['batch-size']).toBe(13); // 读新位置生效
  });

  it('双位置并存 → config/ 优先', () => {
    const cfg = makeCfg();
    const batchDir = join(cfg.queueDir, 'batch-001');
    mkdirSync(join(batchDir, BATCH_CONFIG_DIR), { recursive: true });
    writeFileSync(join(batchDir, BATCH_CONFIG_DIR, BATCH_CONFIG_FILE), 'batch-size: 3\n', 'utf-8');
    writeFileSync(join(batchDir, BATCH_CONFIG_FILE), 'batch-size: 17\n', 'utf-8'); // 旧位置残留
    expect(readBatchConfig(batchDir)['batch-size']).toBe(3); // 新位置胜出
    expect(locateBatchConfig(join(batchDir, '01-x'), cfg.queueDir)['batch-size']).toBe(3);
  });
});

describe('batchRelay 优先级链：CLI > 批次配置 > 系统默认', () => {
  it('无 CLI 无配置 → 系统默认领 3 个', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c', '04-d'].forEach((id) => makeTask(cfg, id));
    const r = batchRelay(cfg, {});
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b', '03-c']);
  });

  it('批次配置 batch-size: 2 → 领 2 个（CLI 未给）', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c'].forEach((id) => makeTask(cfg, id));
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 2\n', 'utf-8');
    const r = batchRelay(cfg, {});
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b']);
  });

  it('CLI --batch-size 3 覆盖批次配置 2', () => {
    const cfg = makeCfg();
    ['01-a', '02-b', '03-c'].forEach((id) => makeTask(cfg, id));
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 2\n', 'utf-8');
    const r = batchRelay(cfg, { batchSize: 3 });
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b', '03-c']);
  });

  it('批次配置 skip-draft: true → draft 任务照领', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    makeTask(cfg, '02-b');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'skip-draft: true\n', 'utf-8');
    const r = batchRelay(cfg, {});
    expect(r.exitCode).toBe(10);
    expect(r.tasks.map((t) => t.spec.id)).toEqual(['01-a', '02-b']);
  });

  it('无配置时 draft 仍拦停（默认姿势不变）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    const r = batchRelay(cfg, {});
    expect(r.exitCode).toBe(12);
    expect(r.summary).toContain('draft');
  });

  it('relayNext 单任务模式同样吃批次配置（skip-draft）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'skip-draft: true\n', 'utf-8');
    const r = relayNext(cfg, {});
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('01-a');
  });

  it('relayNext 定向执行：上游未完成亮明依赖警告，依赖摘要跨 filter 仍注入', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-up');
    makeTask(cfg, '02-down');
    // 下游声明 depends-on 上游
    writeFileSync(
      join(cfg.queueDir, 'batch-001', '02-down', 'SPEC.md'),
      `---
type: doc
goal: 02-down 的任务
output: docs/02-down.md
depends-on:
  - 01-up
acceptance:
  artifacts:
    - path: docs/02-down.md
---
写 02-down 的文档`,
      'utf-8'
    );
    const r = relayNext(cfg, { task: '02-down' });
    expect(r.exitCode).toBe(10);
    expect(r.task.spec.id).toBe('02-down');
    expect(r.summary).toContain('依赖未完成仍定向执行');
    expect(r.summary).toContain('01-up');
    expect(r.prompt).toContain('## 上游依赖完成摘要'); // 摘要跨 filter 仍注入
    expect(r.prompt).toContain('未完成的上游不该轮到下游执行'); // 上游 todo → 防御提示
  });
});

describe('done 验收上限：max-attempts 配置生效', () => {
  it('max-attempts: 1 → 第一次验收失败即标记 failed', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a'); // 产出 docs/01-a.md 不存在 → 验收必不过
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'max-attempts: 1\n', 'utf-8');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail 不合格' });
    expect(out).toContain('已达尝试上限（1 次）');
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(state.tasks['01-a'].status).toBe('failed');
  });

  it('max-attempts: 5 → 第一次失败回 todo 可重试（attempts=1，verdict 不污染）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'max-attempts: 5\n', 'utf-8');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'pass 看起来不错' });
    expect(out).toContain('第 1/5 次尝试');
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    // failed 只属于达上限：未达上限回 todo，接力能再次领取
    expect(state.tasks['01-a'].status).toBe('todo');
    expect(state.tasks['01-a'].attempts).toBe(1);
    expect(state.tasks['01-a'].verdict).toBeUndefined(); // AI 评审文本不写进失败状态（机器判定优先）
  });

  it('max-attempts: 2 → 第 2 次失败才标记 failed', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'max-attempts: 2\n', 'utf-8');
    doneCommand(cfg, { taskId: '01-a', verdict: 'fail' }); // 第 1 次：回 todo
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail' }); // 第 2 次：达上限
    expect(out).toContain('已达尝试上限（2 次）');
    const state = JSON.parse(readFileSync(join(cfg.metaDir, 'state.json'), 'utf-8'));
    expect(state.tasks['01-a'].status).toBe('failed');
    expect(state.tasks['01-a'].attempts).toBe(2);
    // 达上限后接力拦停（exit 12）且提示准确
    const r = relayNext(cfg, {});
    expect(r.exitCode).toBe(12);
    expect(r.summary).toContain('达尝试上限 2 次');
  });

  it('draft 任务 done 拦截：先补全规格再验收（门禁不空跑）', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a', { draft: true });
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'pass' });
    expect(out).toContain('draft 态');
    expect(out).toContain('clarify');
    // 拦截发生在写 state 之前：state.json 未创建或其中无该任务
    const statePath = join(cfg.metaDir, 'state.json');
    expect(!existsSync(statePath) || !JSON.parse(readFileSync(statePath, 'utf-8')).tasks['01-a']).toBe(true);
  });

  it('未达上限回 todo 后，接力能再次领取同一任务', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    doneCommand(cfg, { taskId: '01-a', verdict: 'fail' }); // 失败回 todo
    const r = relayNext(cfg, {});
    expect(r.exitCode).toBe(10); // 未被 failed 拦停，可再次接力
    expect(r.task.spec.id).toBe('01-a');
  });

  it('无配置 → 系统默认 3 次', () => {
    const cfg = makeCfg();
    makeTask(cfg, '01-a');
    const out = doneCommand(cfg, { taskId: '01-a', verdict: 'fail 不合格' });
    expect(out).toContain('第 1/3 次尝试');
  });
});

describe('ensureStructure 建批次自动落配置', () => {
  it('新队列 init 后 batch-001 自带 config/BATCH.yaml', () => {
    const cfg = makeCfg();
    ensureStructure(cfg);
    expect(existsSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR, BATCH_CONFIG_FILE))).toBe(true);
  });

  it('已有批次旧位置配置 → 迁移到 config/；已有新位置 → 不动', () => {
    const cfg = makeCfg();
    mkdirSync(join(cfg.queueDir, 'batch-001'), { recursive: true });
    writeFileSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE), 'batch-size: 21\n', 'utf-8');
    ensureStructure(cfg);
    const cfgPath = join(cfg.queueDir, 'batch-001', BATCH_CONFIG_DIR, BATCH_CONFIG_FILE);
    expect(readFileSync(cfgPath, 'utf-8')).toBe('batch-size: 21\n'); // 迁移后内容不变
    expect(existsSync(join(cfg.queueDir, 'batch-001', BATCH_CONFIG_FILE))).toBe(false); // 旧文件移除
    ensureStructure(cfg); // 再跑不动
    expect(readFileSync(cfgPath, 'utf-8')).toBe('batch-size: 21\n');
  });
});


describe('plan-format：计划落盘形态配置', () => {
  it('默认 html（md+html 双生）；合法值 md/none 生效；非法值回落 html', () => {
    expect(parseBatchConfig('')['plan-format']).toBe('html');
    expect(parseBatchConfig('plan-format: md')['plan-format']).toBe('md');
    expect(parseBatchConfig('plan-format: none')['plan-format']).toBe('none');
    expect(parseBatchConfig('plan-format: pdf')['plan-format']).toBe('html');
    expect(parseBatchConfig('plan-format: 3')['plan-format']).toBe('html');
  });
  it('renderBatchConfig 模板含 plan-format 键与注释', () => {
    const tpl = renderBatchConfig();
    expect(tpl).toContain('plan-format: html');
    expect(tpl).toContain('计划落盘形态');
    const tpl2 = renderBatchConfig({ 'plan-format': 'none' });
    expect(tpl2).toContain('plan-format: none');
  });
});
