// 可执行性风险检测（exec 档）：AI 能力圈边界的确定性信号检测
import { describe, it, expect } from 'vitest';
import { detectExecRisks, detectTaskIssues, renderClarifyReport } from '../../src/core/clarify';
import { TaskSpec } from '../../src/core/task-spec';

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

describe('detectExecRisks：AI 能力圈信号', () => {
  it('认证凭据：登录/扫码/验证码 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('发布版本并扫码登录后台确认', ''));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].level).toBe('exec');
    expect(issues[0].message).toContain('认证凭据');
  });

  it('权限审批：审批/管理员权限 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('提交部署申请并等审批', ''));
    expect(issues[0]?.message).toContain('权限审批');
  });

  it('物理动作：邮寄/盖章/签字 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('把合同打印出来盖章后邮寄给客户', ''));
    expect(issues[0]?.message).toContain('物理动作');
  });

  it('平台账号：公众号后台/企业微信 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('写一篇推文发布到公众号后台', ''));
    expect(issues[0]?.message).toContain('平台账号');
  });

  it('资金合规：付款/报销/合同签署 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('生成报销单并提交财务付款', ''));
    expect(issues[0]?.message).toContain('资金合规');
  });

  it('外部等待：等审批通过/等对方回复 → exec 档', () => {
    const issues = detectExecRisks(makeSpec('发送报价后等对方回复', ''));
    expect(issues[0]?.message).toContain('外部等待');
  });

  it('同类别多词命中只报一次（去重）', () => {
    const issues = detectExecRisks(makeSpec('先扫码登录再人脸识别认证', ''));
    const auth = issues.filter((i) => i.message.includes('认证凭据'));
    expect(auth.length).toBe(1);
  });

  it('多类别并存 → 各报一次', () => {
    const issues = detectExecRisks(makeSpec('扫码登录后台后，把合同盖章邮寄出去', ''));
    const labels = issues.map((i) => i.level);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(labels.every((l) => l === 'exec')).toBe(true);
  });

  it('纯 AI 可做任务（写文档/代码）→ 零命中', () => {
    const issues = detectExecRisks(makeSpec('写三篇迁移文档到 docs/', ''));
    expect(issues).toEqual([]);
  });

  it('正文命中同样生效（动作型要求藏在正文）', () => {
    const issues = detectExecRisks(makeSpec('准备上线材料', '4. 全部完成后登录企业微信后台发送全员通知'));
    expect(issues.some((i) => i.message.includes('认证凭据') || i.message.includes('平台账号'))).toBe(true);
  });

  it('每条 exec issue 自带方案菜单：≥2 方案 + 谁来做（ai/human/both）+ 怎么做', () => {
    const issues = detectExecRisks(makeSpec('扫码登录后台，把合同盖章邮寄出去', ''));
    expect(issues.length).toBeGreaterThanOrEqual(2); // 认证凭据 + 物理动作
    for (const issue of issues) {
      expect(issue.options).toBeDefined();
      expect(issue.options!.length).toBeGreaterThanOrEqual(2);
      for (const o of issue.options!) {
        expect(['ai', 'human', 'both']).toContain(o.who);
        expect(o.title.length).toBeGreaterThan(0);
        expect(o.how.length).toBeGreaterThan(0);
      }
    }
  });

  it('六类信号方案菜单全齐（每条都覆盖「AI 能直接做」的方案）', () => {
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
      expect(issue?.options?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('message 精简为风险本质（方案不在 message 里，避免终端一行太长）', () => {
    const issue = detectExecRisks(makeSpec('发布版本并扫码登录后台确认', ''))[0];
    expect(issue.message).toContain('认证凭据');
    expect(issue.message).toContain('AI 无账号');
    expect(issue.message).not.toContain('建议'); // 旧版单条建议已升级为 options 菜单
  });

  it('终端渲染：✅ 推荐置顶（评分+理由），其余按分跟排（谁来做图标 + 方案名 + 怎么做）', () => {
    const issues = detectExecRisks(makeSpec('发布版本并扫码登录后台确认', ''));
    const report = renderClarifyReport(issues);
    expect(report).toContain('🤖 可执行性风险');
    expect(report).toContain('✅ 推荐');
    expect(report).toContain('9/10');
    expect(report).toContain('推荐理由');
    expect(report).toContain('补测试凭据');
    expect(report).toContain('换自动化通道');
    expect(report).toContain('API token');
    expect(report).toContain('方案菜单'); // 底部处理方式提示语
    expect(report).toContain('--decide'); // 判断题通道提示
    expect(report).toContain('澄清留痕'); // 澄清动作可追溯：记录改了啥、选了哪个方案
    expect(report).toContain('澄清记录'); // 正文留痕章节约定
    expect(report).toContain('fix-log'); // CLI 机械修留痕
    // 推荐行必须排在方案区首行（置顶语义），三个方案评分递减
    const lines = report.split('\n');
    const recLine = lines.findIndex((l) => l.includes('✅ 推荐'));
    const firstOpt = lines.findIndex((l) => l.includes('/10'));
    expect(recLine).toBeGreaterThan(0);
    expect(recLine).toBe(firstOpt);
    const scores = lines.filter((l) => l.includes('/10')).map((l) => Number(l.match(/(\d+)\/10/)![1]));
    expect(scores).toEqual([9, 8, 7]);
  });

  it('澄清留痕闭环：「## 澄清记录」章节为空报 suggest，有实质条目不报', () => {
    const empty = detectTaskIssues(makeSpec('写周报', '## 任务背景\n写周报背景\n\n## 澄清记录\n'));
    expect(empty.some((i) => i.message.includes('「## 澄清记录」章节为空'))).toBe(true);
    const filled = detectTaskIssues(makeSpec('写周报', '## 任务背景\n写周报背景\n\n## 澄清记录\n\n1. 原模糊点：无数据来源\n   - 应用：方案 A（用 git 日志）\n'));
    expect(filled.some((i) => i.message.includes('「## 澄清记录」章节为空'))).toBe(false);
    const none = detectTaskIssues(makeSpec('写周报', '## 任务背景\n写周报背景\n'));
    expect(none.some((i) => i.message.includes('「## 澄清记录」章节为空'))).toBe(false);
  });
});
