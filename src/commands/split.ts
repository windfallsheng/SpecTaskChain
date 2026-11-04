// taskq split：文档拆任务——拆分管「拆得对不对」，完善管「怎么算做完」，两道闸不混
// 边界（钉死）：拆分阶段只产出 goal 和初步内容，不碰验收三态——acceptance 留给逐个完善时用户亲自点头
import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { TaskQConfig } from '../core/config';

export interface SplitOptions {
  group?: string; // 拆入任务模块（可选，共享 spec 的院落）
  type?: string;  // 任务类型（缺省 general）
  auto?: boolean; // 非交互：拆分清单不拦停，直接往下走（交互模式默认停下问用户）
}

// 拆分输入防爆：单文档超长截断（超长文档建议按章节分段拆分，或让 AI 按需 Read 原文）
const MAX_SPLIT_CHARS = 30000;

/** 图片素材：截图入口——宿主 AI 视觉读取转文字清单，CLI 不直接拆图 */
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/** 拆分来源：存在的文件路径（读全文，超长截断）或纯文字（原样用）；图片路径 → 视觉读取接力 */
function loadSource(input: string): { source: string; content: string; isImage: boolean } {
  const abs = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (existsSync(abs) && statSync(abs).isFile()) {
    if (IMAGE_EXTS.includes(abs.slice(abs.lastIndexOf('.')).toLowerCase())) {
      return { source: abs, content: '', isImage: true };
    }
    const raw = readFileSync(abs, 'utf-8');
    const content =
      raw.length > MAX_SPLIT_CHARS
        ? raw.slice(0, MAX_SPLIT_CHARS) +
          `\n\n…（文档过长，已截断至 ${MAX_SPLIT_CHARS} 字符；建议按章节分段拆分，或让 AI 按需 Read 原文：${abs}）`
        : raw;
    return { source: abs, content, isImage: false };
  }
  const content =
    input.length > MAX_SPLIT_CHARS
      ? input.slice(0, MAX_SPLIT_CHARS) + `\n…（文字过长，已截断至 ${MAX_SPLIT_CHARS} 字符）`
      : input;
  return { source: '对话文字', content, isImage: false };
}

/**
 * 拆分指令组装：CLI 只负责读文档 + 钉边界，拆分本身是宿主 AI 的语义活
 * 复用接力协议：输出 [TASKQ_PROMPT] 块 + 退出码 10（宿主 AI 执行拆分）
 */
export function splitCommand(cfg: TaskQConfig, input: string, opts: SplitOptions): string {
  const { source, content, isImage } = loadSource(input);
  const type = opts.type || 'general';
  const groupHint = opts.group
    ? `任务统一拆入模块「${opts.group}」：落盘命令加 --group ${opts.group}（模块公共约束 CONSTRAINTS.md 稍后补）。`
    : '任务平铺落盘；若识别出共享前提的任务群，用 --group 聚合为模块级任务。';
  const lines: string[] = [];
  lines.push(`📄 拆分来源：${source}（${isImage ? '图片素材' : `${content.length} 字符`}）`);
  lines.push('');
  lines.push('[TASKQ_PROMPT]');
  lines.push('你是 SpecTaskChain 的任务拆分助手。把下面的素材拆分成任务草案，落盘到队列。');
  lines.push('');
  if (isImage) {
    lines.push('## 第 0 步：视觉读取（截图入口）');
    lines.push('');
    lines.push(`素材是图片：${source}。先视觉读取截图/图片，把里面写的条目逐条转成文字清单（忠实原文，不脑补缺失信息），再按下面的规则拆分。图片里看不清的内容标「（不清）」，留给用户确认时补。`);
    lines.push('');
  }
  lines.push('## 拆分规则（钉死的边界）');
  lines.push('');
  lines.push('1. **拆分管「拆得对不对」**：每个任务 = 英文 slug 目录名 + 一句话 goal + 正文初步内容（做什么、大致步骤、关键边界）。');
  lines.push(`2. **严禁编写 acceptance 验收三态**——「怎么算做完」是每个任务的第一公民，留到逐个完善阶段由用户亲自点头。正文里也不要写验收相关的内容。`);
  lines.push('3. 任务粒度适中：一个任务一件事，不拆太碎、不硬合并；重复或相近的任务合并描述。');
  lines.push('4. **模块级任务识别**（尽量拆分出明确的单独子任务和模块级任务）：');
  lines.push('   - 素材有标题层级（# 模块名 / ## 子项）→ 模块目录（--group 模块 slug）+ 子任务平铺；子项之间共享前提（同一目标/同一产物链）→ 聚成模块级任务');
  lines.push('   - 同级条目群共享明确前提 → 聚合为模块级任务（--group 聚合，模块公共约束稍后补 CONSTRAINTS.md）');
  lines.push('   - 彼此独立的条目 → 平铺为单独任务，不硬凑模块');
  lines.push('5. **混乱内容容错**（素材写得乱也能拆）：');
  lines.push('   - 先梳理条目骨架：编号（1. ①② / - *）、换行、表格行、连续短句都是潜在任务边界');
  lines.push('   - 同一话题的散点句子聚合成一个任务；跨话题混排的段落切开，各归各任务');
  lines.push('   - 实在无结构可依 → 按段落切，每段一个任务草案，拆分清单里标注「无结构原文，建议用户复核粒度」');
  lines.push(`6. 任务类型统一为 ${type}。`);
  lines.push(`7. ${groupHint}`);
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
  if (opts.auto) {
    lines.push('1. **非交互模式（--auto）**：不拦停——拆分清单随落盘输出即算确认，直接往下走；有疑问项（看不清/粒度存疑）在清单里标注，留给 clarify 阶段处理');
    lines.push('2. 输出拆分清单（目录名 + 一句话 goal + 模块归属）存档，提示用户可随时 `taskq clarify --chain` 体检 + `taskq list` 核对');
  } else {
    lines.push('1. 输出拆分清单（目录名 + 一句话 goal + 模块归属）给用户确认，问一句「拆分对不对，要不要调整」');
    lines.push('2. 提醒用户：`taskq clarify --chain` 体检 + `taskq list` 确认；确认无误后逐个补全验收三态');
  }
  lines.push('');
  lines.push('## 待拆分素材');
  lines.push('');
  lines.push(isImage ? `（图片素材：${source}——按第 0 步视觉读取后拆分）` : content.trim() || '（空文档）');
  lines.push('[TASKQ_PROMPT_END]');
  lines.push('');
  lines.push(`宿主 AI：按上面的规则拆分任务草案，落盘后输出清单${opts.auto ? '（非交互模式，清单即确认，直接往下走）' : '给用户确认'}。`);
  return lines.join('\n');
}
