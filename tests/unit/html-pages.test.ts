// 报告类 HTML 页面测试：CLARIFY.html（体检三档分组）+ REPORT.html（复盘状态分布）
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { renderClarifyHtml, ClarifyIssue } from '../../src/core/clarify';
import { clarifyCommand } from '../../src/commands/clarify';
import { generateReportHtml } from '../../src/core/report';
import { reportCommand } from '../../src/commands/report';
import { newCommand } from '../../src/commands/new';

const cfg = (root: string) => ({ projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') });

describe('CLARIFY.html：体检三档红黄灰分组', () => {
  const issues: ClarifyIssue[] = [
    { level: 'blocking', taskId: '01-a', message: '缺少必填项 output（三必填：goal/output/acceptance）' },
    { level: 'suggest', taskId: '02-b', message: '目标/正文含模糊词「做好」——不可验收' },
    { level: 'pending', taskId: '03-c', message: '规格标记为 draft' },
  ];

  it('三档分组齐全 + 对应色标', () => {
    const html = renderClarifyHtml(issues);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('阻塞');
    expect(html).toContain('建议');
    expect(html).toContain('待定');
    expect(html).toContain('border-left-color:#ef4444'); // 阻塞红
    expect(html).toContain('border-left-color:#f59e0b'); // 建议黄
    expect(html).toContain('border-left-color:#94a3b8'); // 待定灰
  });

  it('无问题时全绿页', () => {
    const html = renderClarifyHtml([]);
    expect(html).toContain('未发现表达不充分之处');
    expect(html).not.toContain('border-left-color');
  });

  it('消息特殊字符转义（注入不执行）', () => {
    const html = renderClarifyHtml([{ level: 'blocking', taskId: '01-a', message: '含 <script>alert(1)</script> 的表达' }]);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('clarifyCommand --html 落盘 queue/CLARIFY.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-clarify-html-'));
    newCommand(cfg(root), { goal: '写文档', type: 'doc', draft: true });
    const out = clarifyCommand(cfg(root), { html: true });
    expect(out).toContain('🩺 体检报告已生成');
    expect(existsSync(join(root, 'queue', 'CLARIFY.html'))).toBe(true);
  });
});

describe('REPORT.html：复盘状态分布与执行记录', () => {
  it('写盘 queue/REPORT.html + 状态分布 + 执行记录', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-report-html-'));
    newCommand(cfg(root), { goal: '写迁移手册', type: 'doc', draft: true });
    const p = generateReportHtml(cfg(root));
    expect(p).toBe(join(root, 'queue', 'REPORT.html'));
    const html = readFileSync(p, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('任务总数');
    expect(html).toContain('完成');
    expect(html).toContain('执行记录');
    expect(html).toContain('01-xieqianyishouce');
  });

  it('reportCommand --html 输出路径文案', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-report-cmd-'));
    newCommand(cfg(root), { goal: '写文档', type: 'doc', draft: true });
    const out = reportCommand(cfg(root), { html: true });
    expect(out).toContain('📊 HTML 执行报告已生成');
    expect(out).toContain('REPORT.html');
  });

  it('批次不存在时返回错误文案（不写盘）', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-report-404-'));
    const p = generateReportHtml(cfg(root), { batch: 'batch-999' });
    expect(p).toContain('❌ 批次「batch-999」不存在');
    expect(existsSync(join(root, 'queue', 'REPORT.html'))).toBe(false);
  });

  it('空队列也兜底：生成报告含「无匹配任务」', () => {
    const root = mkdtempSync(join(tmpdir(), 'stc-report-empty-'));
    const html = readFileSync(generateReportHtml(cfg(root)), 'utf-8');
    expect(html).toContain('（无匹配任务）');
  });
});
