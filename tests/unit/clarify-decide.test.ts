// 判断题通道（--decide）与 decisions 留痕：推荐/评分数据层 + 已决跳过 + frontmatter 写回
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { detectExecRisks, renderClarifyHtml } from '../../src/core/clarify';
import { TaskSpec, parseFrontmatter, buildSpec, renderSpec } from '../../src/core/task-spec';
import { applyDecision, clarifyCommand } from '../../src/commands/clarify';
import { newCommand } from '../../src/commands/new';

function makeSpec(goal: string, body = ''): TaskSpec {
  return {
    id: '01-test',
    dir: '/tmp/01-test',
    type: 'general',
    goal,
    output: 'docs/',
    acceptance: { artifacts: [], checks: [], review: '' },
    dependsOn: [],
    draft: false,
    body,
  };
}

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

/** 递归找队列里的 SPEC.md（任务目录位置随 slug 生成，不可预知） */
function findSpecs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...findSpecs(p));
    else if (e.name === 'SPEC.md') out.push(p);
  }
  return out;
}

describe('数据层：六信号推荐与评分', () => {
  it('六类信号都有唯一 ✅ 推荐方案：recommended 唯一、评分最高、带理由', () => {
    const cases: [string, string][] = [
      ['发布版本并扫码登录后台确认', '认证凭据'],
      ['提交部署申请并等审批', '权限审批'],
      ['把合同打印出来盖章后邮寄给客户', '物理动作'],
      ['写一篇推文发布到公众号后台', '平台账号'],
      ['生成报销单并提交财务付款', '资金合规'],
      ['发送报价后等对方回复', '外部等待'],
    ];
    for (const [goal, label] of cases) {
      const issue = detectExecRisks(makeSpec(goal, ''))[0];
      expect(issue?.message).toContain(label);
      const recs = (issue?.options || []).filter((o) => o.recommended);
      expect(recs.length, label).toBe(1);
      expect(recs[0].reason?.length, label).toBeGreaterThan(0);
      const scores = (issue?.options || []).map((o) => o.score || 0);
      expect(Math.max(...scores), label).toBe(recs[0].score);
    }
  });

  it('HTML 渲染：推荐卡带 rec 类 + ✅ 徽章 + 评分 + 理由', () => {
    const issues = detectExecRisks(makeSpec('发布版本并扫码登录后台确认', ''));
    const html = renderClarifyHtml(issues);
    expect(html).toContain('class="opt rec"');
    expect(html).toContain('rec-tag');
    expect(html).toContain('✅ 推荐');
    expect(html).toContain('9/10');
    expect(html).toContain('推荐理由');
  });
});

describe('已决跳过：decisions 留痕后不再报', () => {
  it('已决类别跳过，其他类别照报', () => {
    const spec = makeSpec('扫码登录后台后把合同盖章邮寄出去', '');
    spec.decisions = ['认证凭据→补测试凭据'];
    const issues = detectExecRisks(spec);
    expect(issues.some((i) => i.message.includes('认证凭据'))).toBe(false);
    expect(issues.some((i) => i.message.includes('物理动作'))).toBe(true);
  });
});

describe('decisions frontmatter 往返', () => {
  it('buildSpec 解析 decisions 列表，renderSpec 写回', () => {
    const { data, body } = parseFrontmatter(`---
type: general
goal: 扫码登录
output: docs/
acceptance:
  review: r
decisions:
  - 认证凭据→补测试凭据
---

正文内容`);
    const spec = buildSpec('01-t', '/tmp/01-t', data, body, 'general');
    expect(spec.decisions).toEqual(['认证凭据→补测试凭据']);
    const out = renderSpec({
      type: spec.type, goal: spec.goal, output: spec.output, acceptance: spec.acceptance,
      decisions: spec.decisions, body: spec.body,
    });
    expect(out).toContain('decisions:');
    expect(out).toContain('  - 认证凭据→补测试凭据');
  });
});

describe('applyDecision：决策留痕写回', () => {
  it('追加 decisions 到 frontmatter，正文与未知字段一字不碰，原文件归档 sources/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tq-decide-'));
    const specPath = join(dir, 'SPEC.md');
    writeFileSync(specPath, '---\ntype: general\ngoal: 扫码登录\ncustom-field: 保留我\noutput: docs/\nacceptance:\n  review: r\n---\n\n正文第一行\n正文第二行\n', 'utf-8');
    expect(applyDecision(specPath, '认证凭据→补测试凭据')).toBe(true);
    const after = readFileSync(specPath, 'utf-8');
    expect(after).toContain('decisions:');
    expect(after).toContain('  - 认证凭据→补测试凭据');
    expect(after).toContain('custom-field: 保留我');
    expect(after).toContain('正文第一行\n正文第二行');
    expect(existsSync(join(dir, 'sources', 'SPEC.md'))).toBe(true);
    // 幂等：同条目不重复写
    expect(applyDecision(specPath, '认证凭据→补测试凭据')).toBe(false);
    // 追加第二条在列表末尾
    expect(applyDecision(specPath, '物理动作→换数字化替代')).toBe(true);
    const after2 = readFileSync(specPath, 'utf-8');
    expect(after2.indexOf('认证凭据→补测试凭据')).toBeLessThan(after2.indexOf('物理动作→换数字化替代'));
    expect((after2.match(/  - /g) || []).length).toBe(2);
  });

  it('无 frontmatter 的文件返回 false 不落盘', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tq-decide-nofm-'));
    const specPath = join(dir, 'SPEC.md');
    writeFileSync(specPath, '没有 frontmatter 的正文\n', 'utf-8');
    expect(applyDecision(specPath, '认证凭据→补测试凭据')).toBe(false);
    expect(readFileSync(specPath, 'utf-8')).toBe('没有 frontmatter 的正文\n');
  });
});

describe('clarify --decide 判断题通道（非 TTY）', () => {
  it('非交互终端只提示不等待：给出报告 + 提示回终端裁决', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-decide-'));
    newCommand(cfg(root), { goal: '发布版本并扫码登录后台确认', name: 'fabubanbenbingsaomadengl', type: 'general', draft: true });
    const out = clarifyCommand(cfg(root), { decide: true });
    expect(out).toContain('判断题通道需要交互终端');
    expect(out).toContain('--decide');
    expect(out).toContain('✅ 推荐');
  });

  it('无 exec 风险时直接回「没有待裁决」', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-decide-clean-'));
    newCommand(cfg(root), { goal: '写三篇迁移文档', name: 'xiesanpianqianyiwendang', type: 'doc', draft: true });
    const out = clarifyCommand(cfg(root), { decide: true });
    expect(out).toContain('没有待裁决的可执行性风险');
  });

  it('采纳写回后，下次体检跳过已决信号（端到端）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-decide-e2e-'));
    newCommand(cfg(root), { goal: '发布版本并扫码登录后台确认', name: 'fabubanbenbingsaomadengl', type: 'general', draft: true });
    const specs = findSpecs(join(root, 'queue'));
    expect(specs.length).toBe(1);
    expect(applyDecision(specs[0], '认证凭据→补测试凭据')).toBe(true);
    const out = clarifyCommand(cfg(root), {});
    expect(out).not.toContain('认证凭据');
  });
});
