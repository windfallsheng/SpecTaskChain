// taskq split：文档拆任务——拆分管「拆得对不对」，完善管「怎么算做完」，两道闸不混
// 边界（钉死）：拆分阶段只产出 goal 和初步内容，不碰验收三态——acceptance 留给逐个完善时用户亲自点头
import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { TaskQConfig } from '../core/config';

export interface SplitOptions {
  group?: string; // 拆入任务模块（可选，共享 spec 的院落）
  type?: string;  // 任务类型（缺省 general）
}

/** 拆分来源：存在的文件路径（读全文）或纯文字（原样用） */
function loadSource(input: string): { source: string; content: string } {
  const abs = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (existsSync(abs) && statSync(abs).isFile()) {
    return { source: abs, content: readFileSync(abs, 'utf-8') };
  }
  return { source: '对话文字', content: input };
}

/**
 * 拆分指令组装：CLI 只负责读文档 + 钉边界，拆分本身是宿主 AI 的语义活
 * 复用接力协议：输出 [TASKQ_PROMPT] 块 + 退出码 10（宿主 AI 执行拆分）
 */
export function splitCommand(cfg: TaskQConfig, input: string, opts: SplitOptions): string {
  const { source, content } = loadSource(input);
  const type = opts.type || 'general';
  const groupHint = opts.group
    ? `任务统一拆入模块「${opts.group}」：落盘命令加 --group ${opts.group}（模块公共约束 CONSTRAINTS.md 稍后补）。`
    : '任务平铺落盘（任务之间若共享前提，可提示用户用 --group 聚合为模块）。';
  const lines: string[] = [];
  lines.push(`📄 拆分来源：${source}（${content.length} 字符）`);
  lines.push('');
  lines.push('[TASKQ_PROMPT]');
  lines.push('你是 SpecTaskChain 的任务拆分助手。把下面的文档拆分成任务草案，落盘到队列。');
  lines.push('');
  lines.push('## 拆分规则（钉死的边界）');
  lines.push('');
  lines.push('1. **拆分管「拆得对不对」**：每个任务 = 英文 slug 目录名 + 一句话 goal + 正文初步内容（做什么、大致步骤、关键边界）。');
  lines.push(`2. **严禁编写 acceptance 验收三态**——「怎么算做完」是每个任务的第一公民，留到逐个完善阶段由用户亲自点头。正文里也不要写验收相关的内容。`);
  lines.push('3. 任务粒度适中：一个任务一件事，不拆太碎、不硬合并；重复或相近的任务合并描述。');
  lines.push(`4. 任务类型统一为 ${type}。`);
  lines.push(`5. ${groupHint}`);
  lines.push('');
  lines.push('## 落盘方式');
  lines.push('');
  lines.push('对每个任务依次执行：');
  lines.push('');
  lines.push('1. `taskq new "一句话目标" --name {slug} --draft`' + (opts.group ? ` --group ${opts.group}` : ''));
  lines.push('2. 编辑该任务 SPEC.md 的正文，写入初步内容；**保持 frontmatter 不动**（draft: true 保留，不添加任何 acceptance 字段）。');
  lines.push('');
  lines.push('## 完成后');
  lines.push('');
  lines.push('1. 输出拆分清单（目录名 + 一句话 goal）给用户确认，问一句「拆分对不对，要不要调整」');
  lines.push('2. 提醒用户：`taskq clarify --chain` 体检 + `taskq list` 确认；确认无误后逐个补全验收三态');
  lines.push('');
  lines.push('## 待拆分文档');
  lines.push('');
  lines.push(content.trim() || '（空文档）');
  lines.push('[TASKQ_PROMPT_END]');
  lines.push('');
  lines.push('宿主 AI：按上面的规则拆分任务草案，落盘后输出清单给用户确认。');
  return lines.join('\n');
}
