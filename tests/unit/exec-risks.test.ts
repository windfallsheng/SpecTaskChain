// 可执行性风险检测（exec 档）：AI 能力圈边界的确定性信号检测
import { describe, it, expect } from 'vitest';
import { detectExecRisks } from '../../src/core/clarify';
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
});
