// 帮助与引导体系测试：help 总览 / help guide 引导页 / help <命令> 单命令详情 / init 输出引导
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { helpText, guideText, commandDetail } from '../../src/core/help';
import { initCommand } from '../../src/commands/init';
import { TaskQConfig } from '../../src/core/config';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-help-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

describe('help 总览：命令表 + 目录布局 + 核心概念', () => {
  it('含用法与引导入口（guide / 单命令详情）', () => {
    const h = helpText();
    expect(h).toContain('taskq help guide');
    expect(h).toContain('taskq help <命令>');
  });
  it('命令表覆盖全部 13 个命令', () => {
    const h = helpText();
    for (const c of ['init', 'new', 'split', 'pipeline', 'clarify', 'run', 'execute', 'reset', 'done', 'list', 'status', 'report', 'ask']) {
      expect(h).toMatch(new RegExp(`^  ${c} `, 'm'));
    }
  });
  it('目录布局三类齐全（队列本体/产出落位/自组织区）', () => {
    const h = helpText();
    expect(h).toContain('项目目录布局（taskq 只管理 queue/，其余不碰）');
    expect(h).toContain('队列本体：批次/任务/状态账本（唯一管理区）');
    expect(h).toContain('产出落位：按 --type 自动归位（doc→docs/，research→research/…）');
    expect(h).toContain('用户自组织区：名字随你；素材指给 split/pipeline');
  });
  it('核心概念速览：验收三态 / 退出码 / 批次聚焦', () => {
    const h = helpText();
    expect(h).toContain('artifacts 产物 + checks 断言 + review 评审');
    expect(h).toContain('10 有任务接力 / 12 拦截');
    expect(h).toContain('--batch all 全批次');
  });
});

describe('help guide 引导页：三步 + 三类目录 + 概念 + FAQ', () => {
  it('上手三步闭环（init → new → clarify/run/done）', () => {
    const g = guideText();
    expect(g).toContain('taskq init');
    expect(g).toContain('taskq new "任务描述" --type doc');
    expect(g).toContain('taskq clarify → taskq run → taskq done');
    expect(g).toContain('taskq report 归档复盘');
  });
  it('三类目录完整展开（含 .taskchain 与类型映射）', () => {
    const g = guideText();
    expect(g).toContain('队列本体（taskq 唯一管理区）');
    expect(g).toContain('产出落位（按 --type 自动归位');
    expect(g).toContain('doc→docs/  research→research/  data→data/');
    expect(g).toContain('用户自组织区（自由命名，taskq 不碰）');
    expect(g).toContain('materials/ 素材（split/pipeline 入口）');
  });
  it('FAQ 覆盖高频疑问（docs 能删吗/12 拦截/换会话续跑/重跑/素材放哪）', () => {
    const g = guideText();
    expect(g).toContain('跑完任务多了个 docs/，能删吗');
    expect(g).toContain('run 被拦截（退出码 12）怎么办');
    expect(g).toContain('换会话/换工具怎么接着跑');
    expect(g).toContain('想重跑某个任务');
    expect(g).toContain('素材文档放哪');
  });
});

describe('help <命令> 单命令详情', () => {
  it('run 详情含退出码协议与定向参数', () => {
    const d = commandDetail('run');
    expect(d).toContain('无人值守接力执行');
    expect(d).toContain('--batch 批次');
    expect(d).toContain('10 有下一任务');
    expect(d).toContain('12 拦截');
  });
  it('init 详情含 5 SKILL 说明与 --update', () => {
    const d = commandDetail('init');
    expect(d).toContain('/taskq-ask 总入口 + /taskq-new /taskq-run /taskq-clarify /taskq-done');
    expect(d).toContain('--update');
  });
  it('13 个命令全有详情', () => {
    for (const c of ['init', 'new', 'split', 'pipeline', 'clarify', 'run', 'execute', 'reset', 'done', 'list', 'status', 'report', 'ask']) {
      expect(commandDetail(c)).not.toContain('未知命令');
    }
  });
  it('未知命令兜底给总览', () => {
    const d = commandDetail('foobar');
    expect(d).toContain('未知命令：foobar');
    expect(d).toContain('SpecTaskChain v');
  });
});

describe('init 输出引导：目录布局摘要 + guide 指向', () => {
  it('init 输出含三类目录摘要与完整引导入口', () => {
    const out = initCommand(makeCfg().projectRoot);
    expect(out).toContain('项目目录布局（taskq 只管理 queue/，其余不碰）');
    expect(out).toContain('队列本体（批次/任务/状态账本）');
    expect(out).toContain('产出落位：按 --type 自动归位');
    expect(out).toContain('用户自组织区：名字随你');
    expect(out).toContain('taskq help guide');
  });
});
