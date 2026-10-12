import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { splitCommand } from '../../src/commands/split';

const cfg = { projectRoot: '/proj', queueDir: '/proj/queue', metaDir: '/proj/queue/.taskchain' };

describe('split：文档拆任务——拆分管「拆得对不对」，不碰验收三态', () => {
  it('文字输入：输出拆分 prompt 块 + 文档全文', () => {
    const out = splitCommand(cfg, '写三篇迁移文档，再加一篇回滚手册', {});
    expect(out).toContain('[TASKQ_PROMPT]');
    expect(out).toContain('[TASKQ_PROMPT_END]');
    expect(out).toContain('写三篇迁移文档，再加一篇回滚手册');
    expect(out).toContain('📄 拆分来源：对话文字');
  });

  it('文件输入：读取文件全文进 prompt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stc-split-'));
    const file = join(dir, 'prd.md');
    writeFileSync(file, '# PRD\n\n功能 A\n功能 B\n', 'utf-8');
    const out = splitCommand(cfg, file, {});
    expect(out).toContain('📄 拆分来源：' + file);
    expect(out).toContain('# PRD');
    expect(out).toContain('功能 B');
  });

  it('边界钉死：严禁编写 acceptance 验收三态', () => {
    const out = splitCommand(cfg, '随便写点什么', {});
    expect(out).toContain('严禁编写 acceptance 验收三态');
    expect(out).toContain('不添加任何 acceptance 字段');
    expect(out).toContain('draft: true 保留');
  });

  it('落盘方式：--draft 落盘 + 用户确认清单', () => {
    const out = splitCommand(cfg, '内容', {});
    expect(out).toContain('--name {slug} --draft');
    expect(out).toContain('拆分对不对，要不要调整');
    expect(out).toContain('taskq clarify --chain');
  });

  it('模块模式：--group 落盘命令带模块参数', () => {
    const out = splitCommand(cfg, '内容', { group: 'auth' });
    expect(out).toContain('--group auth');
    expect(out).toContain('模块「auth」');
  });

  it('类型透传：任务类型统一声明', () => {
    const out = splitCommand(cfg, '内容', { type: 'doc' });
    expect(out).toContain('任务类型统一为 doc');
  });
});
