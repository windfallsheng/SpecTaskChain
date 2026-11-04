// taskq pipeline：端到端流水线剧本——素材进（描述/文件/目录），任务出，执行完，账可查
// 五个阶段：采集（CLI 确定性完成）→ 拆分（宿主 AI）→ 澄清（用户点头）→ 执行（宿主 AI 接力）→ 收尾（复盘）
// CLI 只出剧本 + 采集素材，编排执行归宿主 AI（对齐 spec-once：宿主单会话按剧本调用现有命令，各阶段拦停点由宿主停下问人）
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { TaskQConfig } from '../core/config';

export interface PipelineOptions {
  batch?: string;     // 执行批次（缺省 = 最新批次）
  batchSize?: number; // 执行批大小（缺省 3）
  type?: string;      // 拆分出的任务类型（缺省 general）
  group?: string;     // 拆入任务模块（可选）
  auto?: boolean;     // 非交互：拦停点 1/2（拆分清单确认/体检门禁）自动通过，仅失败时停下（拦停点 3 永不停用）
}

/** 图片素材扩展名：截图入口——宿主 AI 视觉读取转文字清单 */
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/** 素材采集：目录（递归文本文件）/ 多文件（逗号分隔）/ 单文件 / 图片 / 纯文字 */
function collectSources(input: string): { files: { path: string; content: string }[]; images: string[]; plain: string } {
  const parts = input.split(/[,，]/).map((p) => p.trim()).filter(Boolean);
  const files: { path: string; content: string }[] = [];
  const images: string[] = [];
  const plainParts: string[] = [];

  const TEXT_EXTS = ['.md', '.txt', '.yaml', '.yml', '.json', '.ts', '.js', '.py', '.html'];
  const MAX_FILE_CHARS = 20000;  // 单文件截断上限
  const MAX_TOTAL_CHARS = 50000; // 素材总量上限

  const pushFile = (abs: string): void => {
    const ext = abs.slice(abs.lastIndexOf('.'));
    if (!TEXT_EXTS.includes(ext)) return;
    try {
      const raw = readFileSync(abs, 'utf-8');
      const content = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) + `\n\n…（文件过长，已截断至 ${MAX_FILE_CHARS} 字符）` : raw;
      files.push({ path: abs, content });
    } catch {
      // 读不了就跳过（二进制等），不进素材
    }
  };

  let total = 0;
  for (const part of parts) {
    if (total >= MAX_TOTAL_CHARS) break;
    const abs = isAbsolute(part) ? part : resolve(process.cwd(), part);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      // 目录：递归收集文本文件
      for (const entry of readdirSync(abs, { recursive: true }) as string[]) {
        if (total >= MAX_TOTAL_CHARS) break;
        const full = join(abs, entry);
        if (statSync(full).isFile()) pushFile(full);
        total = files.reduce((s, f) => s + f.content.length, 0);
      }
    } else if (existsSync(abs) && statSync(abs).isFile()) {
      if (IMAGE_EXTS.includes(abs.slice(abs.lastIndexOf('.')).toLowerCase())) {
        images.push(abs);
      } else {
        pushFile(abs);
      }
    } else {
      plainParts.push(part);
    }
    total = files.reduce((s, f) => s + f.content.length, 0);
  }
  return { files, images, plain: plainParts.join('\n').trim() };
}

/** 流水线剧本组装：输出 [TASKQ_PIPELINE] 块 + 素材全文，宿主 AI 按剧本编排执行；--auto 非交互双模式 */
export function pipelineCommand(cfg: TaskQConfig, input: string, opts: PipelineOptions): string {
  const { files, images, plain } = collectSources(input);
  const batchSize = Math.max(1, opts.batchSize || 3);
  const auto = opts.auto === true;
  const mode = auto ? '非交互（--auto，拦停点自动通过，仅失败停下）' : '交互（每个拦停点停下问用户）';
  const lines: string[] = [];
  lines.push('🏭 SpecTaskChain 端到端流水线：素材进 → 任务出 → 执行完 → 账可查');
  lines.push('');
  if (files.length) {
    lines.push(`📚 素材采集完成：${files.length} 个文本文件（共 ${files.reduce((s, f) => s + f.content.length, 0)} 字符）${images.length ? ` + ${images.length} 张图片` : ''}`);
  } else if (images.length) {
    lines.push(`🖼️ 素材为 ${images.length} 张图片（截图入口：宿主 AI 先视觉读取转文字清单再拆）`);
  } else {
    lines.push('📝 素材为纯文字描述（未检测到文件路径）');
  }
  lines.push('');
  lines.push('[TASKQ_PIPELINE]');
  lines.push(`你是 SpecTaskChain 流水线编排者。按下面的五阶段剧本推进（${mode}）。`);
  lines.push('');
  if (images.length) {
    lines.push('## 第 0 步：视觉读取（截图入口）');
    lines.push('');
    lines.push(`素材含图片：${images.join('、')}。先视觉读取每张截图/图片，把里面写的条目逐条转成文字清单（忠实原文，不脑补缺失信息），再进阶段 1 拆分。看不清的内容标「（不清）」，留给阶段 2 用户确认时补。`);
    lines.push('');
  }
  lines.push('## 阶段 1：拆分（宿主 AI 执行）');
  lines.push('');
  lines.push('把下方素材拆成任务草案，规则同 taskq split（钉死的边界）：');
  lines.push('');
  lines.push(`- 每个任务 = \`taskq new "一句话目标" --name {slug} --draft${opts.group ? ` --group ${opts.group}` : ''}${opts.type ? ` --type ${opts.type}` : ''}\` 落盘，再编辑 SPEC.md 正文写入初步内容`);
  lines.push('- **严禁编写 acceptance 验收三态**——「怎么算做完」留到阶段 2 由用户亲自点头');
  lines.push('- 任务粒度适中：一个任务一件事，不拆太碎、不硬合并');
  lines.push('- **模块级任务识别**：标题层级（# 模块 / ## 子项）→ 模块 + 子任务；共享前提的任务群 → --group 聚合为模块级任务；彼此独立的条目平铺为单独任务');
  lines.push('- **混乱内容容错**：先梳理条目骨架（编号/换行/表格行/连续短句），散点聚合、混排切开；无结构可依按段落切，清单标注建议复核');
  lines.push('');
  lines.push(`**拦停点 1**：输出拆分清单（目录名 + 一句话 goal + 模块归属）给用户确认，问「拆分对不对，要不要调整」——${auto ? '非交互模式自动通过（清单即确认，疑问项标注留给阶段 2 处理）' : '用户点头才进阶段 2'}。`);
  lines.push('');
  lines.push('## 阶段 2：澄清（用户亲自点头）');
  lines.push('');
  lines.push(`- 运行 taskq clarify --chain 链级体检，再对每个任务逐个补全：三必填齐了没、验收三态（产物/断言/评审）由用户亲自点头写`);
  lines.push('- 补全后再次 taskq clarify 全量体检，直到全绿（无 blocking）；机械项（补 output/acceptance 骨架/role/摘 draft）可 taskq fix --yes 一键应用');
  lines.push('');
  lines.push(`**拦停点 2**：clarify 非全绿不得进阶段 3——「怎么算做完」没定，无人值守就跑不起来。${auto ? '非交互模式：机械项直接 taskq fix --yes 应用，验收三态按拆分意图代拟后标注「待用户复核」，全绿即通过' : ''}`);
  lines.push('');
  lines.push(`## 阶段 3：执行（宿主 AI 接力，批次自动）`);
  lines.push('');
  lines.push(`- 运行 \`taskq execute --batch-size ${batchSize}\` 领取一批任务（输出批内每个任务的完整 prompt）`);
  lines.push('- 按顺序执行：每个完成即 `taskq done <id> --verdict "..."`，批内全部完成后再次 `taskq execute` 取下一批，直到退出码 0');
  lines.push('- 批内任一任务 failed（3 次验收不过）即停下，处理后从 execute 重新进入');
  lines.push('');
  lines.push('**拦停点 3**：任务失败需人工介入——机器不假装能自动修复，把问题亮给用户。（两种模式都停，永不自动通过）');
  lines.push('');
  lines.push('## 阶段 4：收尾（复盘）');
  lines.push('');
  lines.push('- 运行 `taskq report` 输出队列报告（执行留痕，有账可查），交给用户');
  lines.push('');
  lines.push('## 素材全文');
  lines.push('');
  if (files.length) {
    for (const f of files) {
      lines.push(`### 文件：${f.path}`);
      lines.push('');
      lines.push(f.content.trim() || '（空文件）');
      lines.push('');
    }
  }
  if (images.length) {
    for (const img of images) {
      lines.push(`### 图片：${img}`);
      lines.push('');
      lines.push('（图片素材——按第 0 步视觉读取后转文字清单）');
      lines.push('');
    }
  }
  if (plain) {
    lines.push('### 文字描述');
    lines.push('');
    lines.push(plain);
    lines.push('');
  }
  if (!files.length && !images.length && !plain) {
    lines.push('（无素材——请用户提供文件路径、目录、图片或文字描述后重跑）');
    lines.push('');
  }
  lines.push('[TASKQ_PIPELINE_END]');
  lines.push('');
  lines.push(`宿主 AI：按剧本编排执行。阶段 1 拆分前先把素材读完（图片先视觉读取）；拦停点行为：${mode}。批次目标：${opts.batch || '最新批次'}。`);
  return lines.join('\n');
}
