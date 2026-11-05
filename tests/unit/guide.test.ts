// HTML 引导页测试：init 自动生成 + help guide --html 再生成，内容章节完整
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { guideHtml, generateGuideHtml } from '../../src/core/guide';
import { TaskQConfig } from '../../src/core/config';

function makeCfg(): TaskQConfig {
  const root = mkdtempSync(join(tmpdir(), 'stc-guide-'));
  return { projectRoot: root, queueDir: join(root, 'queue'), metaDir: join(root, 'queue', '.taskchain') };
}

describe('HTML 引导页：内容章节与写盘', () => {
  it('含五大章节 + 版本号 + 文档链接', () => {
    const html = guideHtml(makeCfg());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('上手三步');
    expect(html).toContain('项目目录布局');
    expect(html).toContain('命令速查');
    expect(html).toContain('核心概念');
    expect(html).toContain('常见问题');
    expect(html).toMatch(/v\d+\.\d+\.\d+/);
    expect(html).toContain('github.com/windfallsheng/SpecTaskChain');
  });

  it('可视化页面节互链四页（GUIDE/PANEL/CLARIFY/REPORT）', () => {
    const html = guideHtml(makeCfg());
    expect(html).toContain('可视化页面');
    expect(html).toContain('PANEL.html');
    expect(html).toContain('status --panel');
    expect(html).toContain('CLARIFY.html');
    expect(html).toContain('clarify --html');
    expect(html).toContain('REPORT.html');
    expect(html).toContain('report --html');
  });

  it('命令速查表覆盖全部 13 个命令入口', () => {
    const html = guideHtml(makeCfg());
    for (const cmd of ['init', 'new', 'split', 'pipeline', 'clarify', 'run', 'execute', 'reset', 'done', 'list', 'status', 'report', 'ask']) {
      expect(html).toContain(`taskq ${cmd}`);
    }
  });

  it('三类目录说明齐全（队列本体/产出落位映射/用户自组织区）', () => {
    const html = guideHtml(makeCfg());
    expect(html).toContain('队列本体');
    expect(html).toContain('产出总仓');
    expect(html).toContain('用户自组织区');
    // 镜像落位抽查
    expect(html).toContain('outputs/{批次}/{任务目录}/');
    expect(html).toContain('outputs/{批次}/{模块}/{子任务}/');
    expect(html).toContain('materials/');
  });

  it('generateGuideHtml 写盘 queue/reports/GUIDE.html 且可读', () => {
    const cfg = makeCfg();
    const p = generateGuideHtml(cfg);
    expect(p).toBe(join(cfg.queueDir, 'reports', 'GUIDE.html'));
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf-8').startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('路径含特殊字符时 HTML 转义（注入不执行）', () => {
    const cfg = makeCfg();
    const html = guideHtml({ queueDir: `${cfg.queueDir} <script>alert(1)</script>` });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });
});
