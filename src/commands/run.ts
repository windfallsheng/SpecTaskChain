// taskq run：阶段流水线推进器（参考 speccore run 精髓）
// 无参 = 智能续跑：断点面板（队列统计 + 下一步）前置，再接单任务接力——从当前阶段自然往下
// 带阶段参数 = preset/范围剧本：clarify → split → execute → report，宿主 AI 按剧本接力推进
// --auto = 全自动闸口：拦停点自动通过；范围含 split 且无素材 → NEEDS_INFO 提示
import { TaskQConfig } from '../core/config';
import { relayNext, NextTaskInfo, queueSummary } from '../core/runner';

export interface RunOptions {
  skipDraft?: boolean; // 强跑 draft 任务
  batch?: string;      // 批次聚焦（batch-NNN / tasks / all；缺省 = 最新批次）
}

// ========== 阶段表（run 流水线的推进域）==========
// 验收登记（done）在执行阶段逐个完成，不入阶段表——「怎么算做完」由任务自己的验收三态钉死
interface RunPhase {
  id: string;
  aliases: string[];   // preset 直呼别名（英文 + 中文口语）
  label: string;
  command: string;     // 剧本步骤命令（<素材> 占位由素材参数填充）
  gate: boolean;       // 拦停点（交互模式停下问用户；--auto 自动通过）
  explanation: string;
}

const PHASES: RunPhase[] = [
  {
    id: 'clarify',
    aliases: ['clarify', '体检', '澄清', '检查'],
    label: '体检澄清',
    command: 'taskq clarify',
    gate: true,
    explanation: 'taskq clarify 全量体检；有 blocking 先 taskq fix --yes 应用机械修复（补 output/acceptance 骨架/摘 draft），非全绿不往下走',
  },
  {
    id: 'split',
    aliases: ['split', '拆分', '切分', '拆'],
    label: '拆分任务',
    command: 'taskq split <素材>',
    gate: true,
    explanation: '素材（文档/目录/纯文字/截图）拆成任务草案（单独任务 + 模块级任务）；拆分清单给用户确认',
  },
  {
    id: 'execute',
    aliases: ['execute', '执行', '接力', '跑'],
    label: '接力执行',
    command: 'taskq execute',
    gate: false,
    explanation: 'taskq execute 批量接力，宿主 AI 循环续跑直到队列清空（退出码 0）；批内每个任务完成即 taskq done <id> --verdict "..." 登记验收',
  },
  {
    id: 'report',
    aliases: ['report', '报告', '报表', '复盘'],
    label: '报告复盘',
    command: 'taskq report',
    gate: false,
    explanation: 'taskq report 输出队列报告（执行留痕，有账可查）',
  },
];

/** 阶段词消解：英文/中文别名 → 阶段 id；不匹配返回 undefined */
function resolvePhase(word: string): string | undefined {
  const w = word.toLowerCase().trim();
  return PHASES.find((p) => p.aliases.some((a) => a.toLowerCase() === w))?.id;
}

export interface RunRange {
  from?: string;     // 起始阶段 id
  to?: string;       // 终点阶段 id（缺省 = 最后一个阶段 report）
  material?: string; // split 阶段的素材（「run split docs/prd.md」位置参数带的素材）
}

/**
 * 位置参数解析：无参 → {}（智能续跑）；单阶段 → preset；A to B → 范围；
 * 阶段后带素材（run split <素材>）→ material 填进剧本。解析失败返回 null（调用方按无参续跑处理）
 */
export function parseRunRange(args: string[]): RunRange | null {
  const joined = args.join(' ').trim();
  if (!joined) return {};
  const range = joined.match(/^(.+?)\s*(?:to|[.]{2}|->|→)\s*(.+)$/i);
  if (range) {
    const from = resolvePhase(range[1].trim());
    const to = resolvePhase(range[2].trim());
    if (!from || !to) return null;
    return { from, to };
  }
  const m = joined.match(/^(\S+)\s+(.+)$/);
  const head = m ? m[1] : joined;
  const from = resolvePhase(head);
  if (!from) return null;
  return { from, material: m ? m[2].trim() : undefined };
}

/** 断点面板：队列统计 + 下一步（无参智能续跑的前置依据，speccore「断点面板 + 软停」的 taskq 形态） */
export function renderRunPanel(cfg: TaskQConfig, opts: { batch?: string } = {}): string {
  const lines: string[] = [];
  lines.push('📍 断点面板（智能续跑：从当前状态往下走，不用告诉 CLI 从哪开始）');
  lines.push('');
  lines.push(queueSummary(cfg, { batch: opts.batch }));
  return lines.join('\n');
}

/** 流水线剧本：阶段序列 + 命令 + 拦停点 + 模式（宿主 AI 按剧本接力推进） */
export function renderRunPlan(cfg: TaskQConfig, opts: { from: string; to?: string; auto?: boolean; material?: string; batch?: string; batchSize?: number }): string {
  const fromIdx = PHASES.findIndex((p) => p.id === opts.from);
  const toIdx = opts.to ? PHASES.findIndex((p) => p.id === opts.to) : PHASES.length - 1;
  if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) {
    return `❌ 阶段范围无效：「${opts.from}」→「${opts.to || ''}」。可用阶段：${PHASES.map((p) => p.aliases[0]).join(' / ')}（范围写法：clarify to execute）`;
  }
  const steps = PHASES.slice(fromIdx, toIdx + 1);
  const mode = opts.auto ? '非交互（全自动）' : '交互（默认）';
  const lines: string[] = [];
  lines.push(`🏃 已编排「${steps.map((s) => s.label).join(' → ')}」流水线（${steps.length} 步，${mode}）`);
  if (opts.batch) lines.push(`📍 批次：${opts.batch}`);
  if (opts.batchSize) lines.push(`🔢 批量：一次领取 ${opts.batchSize} 个任务`);
  lines.push('');
  lines.push('[TASKQ_RUN_PLAN]');
  lines.push('你是 SpecTaskChain 流水线推进者。按下面的阶段依次推进，每步用对应 CLI 命令执行，每步完成才能进下一步。');
  lines.push('');
  for (const s of steps) {
    let cmd = s.command;
    if (s.id === 'split' && opts.material) cmd = `taskq split ${opts.material}`;
    if (s.id === 'execute') {
      // 批量/批次填进执行命令（剧本头部已声明，命令也要带上才不被宿主 AI 丢）
      cmd = `taskq execute${opts.batch ? ` --batch ${opts.batch}` : ''}${opts.batchSize ? ` --batch-size ${opts.batchSize}` : ''}`;
    }
    lines.push(`阶段 ${steps.indexOf(s) + 1}/${steps.length}：${s.label}${s.gate ? '（拦停点）' : ''}`);
    lines.push(`  - ${s.explanation}`);
    lines.push(`  - 命令：${cmd}`);
    lines.push('');
  }
  lines.push('执行约定：');
  lines.push('- 退出码 10 = 接力继续；12 = 停下（draft 未补全 / doing 进行中 / failed 需人工介入），把情况亮给用户');
  if (opts.auto) {
    lines.push('- 非交互模式（--auto）：拦停点自动通过不打断；仅退出码 12（失败）时停下报告');
  } else {
    lines.push('- 交互模式：每个拦停点停下问用户，点头才继续；非拦停点步骤直接连跑');
  }
  lines.push('[/TASKQ_RUN_PLAN]');
  // split 阶段缺素材 → NEEDS_INFO（拆分没有素材落不了盘，不猜）
  if (steps.some((s) => s.id === 'split') && !opts.material) {
    lines.push('');
    lines.push('[TASKQ_NEEDS_INFO]');
    lines.push('拆分步骤缺素材，无法落盘：');
    lines.push('- 素材（必填）：文档路径 / 目录 / 纯文字任务清单 / 截图（宿主 AI 先视觉读取截图转成文字清单再拆）');
    lines.push('示例：');
    lines.push('  taskq run split docs/prd.md');
    lines.push('  taskq run "拆分这段清单：写周报邮件 / 整理会议纪要 / 复盘故障" to report');
    lines.push('[/TASKQ_NEEDS_INFO]');
  }
  return lines.join('\n');
}

/** 渲染接力结果（CLI 输出文本；退出码由调用方传播：0 清空 / 10 接力 / 12 draft 拦截） */
export function renderRunResult(result: NextTaskInfo): string {
  if (result.exitCode === 0) {
    return result.summary;
  }
  if (result.exitCode === 12) {
    return result.summary;
  }
  // 接力模式：输出 prompt 块（宿主 AI 执行）
  return `${result.summary}\n\n[TASKQ_PROMPT]\n${result.prompt}\n[TASKQ_PROMPT_END]\n\n宿主 AI：执行上面的任务，完成后运行 \`taskq done ${result.task.spec.id} --verdict "pass 评审结论"\` 登记验收，再 \`taskq run\` 接力下一个。`;
}

export function runCommand(cfg: TaskQConfig, opts: RunOptions): string {
  return renderRunResult(relayNext(cfg, { skipDraft: opts.skipDraft, batch: opts.batch }));
}
