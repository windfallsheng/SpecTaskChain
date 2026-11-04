// taskq ask：自然语言入口——意图识别 + 参数提取 + 精确执行
// 分工：宿主 AI 负责指代消解（「上面的内容」→ 文件路径），CLI 负责意图识别与执行
// 返回结构携带 exitCode：接力类意图（run/execute/split/pipeline）必须把退出码传播给宿主，标记 + 退出码双保险
import { TaskQConfig } from '../core/config';
import { recognizeIntent, detectOrchestration, BatchRef, Orchestration, OrchestrationStep } from '../core/intent';
import { scanQueue } from '../core/queue';
import { resolveBatchRef, renderBatchCandidates } from '../core/batch-resolve';
import { clarifyCommand } from './clarify';
import { relayNext, batchRelay, renderBatchResult } from '../core/runner';
import { renderRunResult } from './run';
import { statusCommand } from './status';
import { reportCommand } from './report';
import { listCommand } from './list';
import { initCommand } from './init';
import { newCommand } from './new';
import { resetCommand } from './reset';
import { splitCommand } from './split';
import { pipelineCommand } from './pipeline';

export interface AskResult {
  output: string;
  exitCode: number;
}

/** 批次裁决：BatchRef（精确编号 / 相对位次 / 特征短语）→ 真实批次 ID；未决亮候选清单不瞎猜 */
function settleBatch(cfg: TaskQConfig, ref?: BatchRef): { id?: string; blocked?: string; note?: string } {
  // 空引用也裁决：默认「最近使用批次」（state 记忆）> 最新批次——用户没明说就回最近干活的地方
  const r = resolveBatchRef(cfg, scanQueue(cfg.queueDir, cfg.metaDir), ref);
  if (!r.id) return r.candidates ? { blocked: renderBatchCandidates(r) } : {};
  const note = r.note && r.matchedBy !== 'exact' && r.matchedBy !== 'default' ? r.note.replace(`→ ${r.id}`, '') : undefined;
  return { id: r.id, note };
}

export function askCommand(cfg: TaskQConfig, input: string): AskResult {
  // 复合意图编排优先（参考 speccore ask 模式4：多动作词 + 时序词 → pipeline 编排）；
  // 命中即输出编排剧本（宿主 AI 按序接力），不再走单意图——「澄清并执行」不会丢段
  const orch = detectOrchestration(input);
  if (orch) {
    return { output: renderOrchestration(cfg, input, orch), exitCode: 10 };
  }
  const result = recognizeIntent(input);
  switch (result.intent) {
    case 'clarify':
      return { output: clarifyCommand(cfg, { taskId: result.params.taskId, file: result.params.file }), exitCode: 0 };
    case 'run': {
      // 批次引用先行裁决（「预算那批」→ 语义定位；未决亮候选清单，不瞎猜）
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      // 直调 relayNext 拿退出码（runCommand 只返回文本会丢失接力信号）
      const r = relayNext(cfg, { batch: settled.id });
      return { output: renderRunResult(r), exitCode: r.exitCode };
    }
    case 'execute': {
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      // 批次大小走意图识别（「一次领 5 个」→ 5），未识别时 undefined 走默认 3
      const r = batchRelay(cfg, { batch: settled.id, batchSize: result.params.batchSize });
      return { output: renderBatchResult(r), exitCode: r.exitCode };
    }
    case 'pipeline': {
      // 提取素材（「跑流水线 docs/新需求.md」→ docs/新需求.md）；无素材给用法（流水线需要入口素材，不猜）
      const m = input.match(/^(?:跑|走|开)?(?:端到端|一条龙|流水线)(?:一把|一下|吧)?[:：]?\s*(.+)$/);
      const target = m ? m[1].trim() : '';
      if (!target) {
        return { output: '用法：taskq pipeline <描述或文件或目录>\n\n示例：\n  taskq pipeline docs/新需求.md\n  taskq pipeline "做一套登录系统，含注册、找回密码、后台审计" --type feature', exitCode: 0 };
      }
      return { output: pipelineCommand(cfg, target, {}), exitCode: 10 };
    }
    case 'split': {
      // 提取拆分输入（「拆分任务：写三篇迁移文档」→ 写三篇迁移文档）；无素材或裸词回溯（「拆分任务」→「任务」）给用法
      const m = input.match(/^(?:拆分|切分)(?:任务|文档)?[:：]?\s*(.+)$/);
      const target = m ? m[1].trim() : '';
      if (!target || /^(任务|文档)$/.test(target)) {
        return { output: '用法：taskq split <文件路径或文字> [--group 模块名]\n\n示例：\n  taskq split docs/prd.md --group auth\n  taskq split "写三篇迁移文档，再加一篇回滚手册"', exitCode: 0 };
      }
      return { output: splitCommand(cfg, target, { group: result.params.group }), exitCode: 10 };
    }
    case 'init':
      return { output: initCommand(cfg.projectRoot), exitCode: 0 };
    case 'status': {
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      return { output: statusCommand(cfg, { batch: settled.id }), exitCode: 0 };
    }
    case 'report': {
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      return { output: reportCommand(cfg, { batch: settled.id }), exitCode: 0 };
    }
    case 'list': {
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      return { output: listCommand(cfg, { batch: settled.id }), exitCode: 0 };
    }
    case 'new': {
      // 提取任务描述（「建个任务：写文档」→ 写文档）；创建命名（叫 X 的/--name/--group）由意图识别带出
      const goalMatch = input.match(/任务[:：]?\s*(.+)$/);
      let goal = goalMatch ? goalMatch[1].trim() : input;
      if (result.params.group) {
        // 先剥「建 X 模块」前缀再剥「放 X 模块」后缀，goal 只留任务本身；剥完为空用模块名兼底
        // （顺序不能反：「建个认证模块」若先剥后缀会剩「建个」残渣）
        goal = goal.replace(new RegExp(`^(?:建|加|创建|新增|添加)(?:个|一个)?${result.params.group}模块[:：，,]?\\s*`), '').trim();
        goal = goal.replace(new RegExp(`[,，]?\\s*(?:放|放入)?${result.params.group}模块$`), '').trim();
        if (!goal) goal = `${result.params.group}模块`;
      }
      const settled = settleBatch(cfg, result.params.batchRef);
      if (settled.blocked) return { output: settled.blocked, exitCode: 0 };
      return {
        output: newCommand(cfg, {
          goal: goal.slice(0, 60),
          draft: false,
          name: result.params.taskName,
          group: result.params.group,
          batch: settled.id,
        }),
        exitCode: 0,
      };
    }
    case 'done':
      return { output: `任务完成登记：taskq done ${result.params.taskId || '<task-id>'} --verdict "pass 评审结论"`, exitCode: 0 };
    case 'reset': {
      // 目标来自专向提取（taskId 兼容），无目标时不执行只给用法（复位全队列是重操作，绝不猜测）
      const target = result.params.target || result.params.taskId;
      if (!target) {
        return { output: '重跑复位：请指定目标——任务ID / 模块ID / batch-NNN / --all（可选 --hard 连留痕清空=从头再来）。\n\n示例：\n  taskq reset 34-cshidaima\n  taskq reset module-yingxiaomokuai\n  taskq reset --all --hard', exitCode: 0 };
      }
      return { output: resetCommand(cfg, target, { hard: result.params.hard }), exitCode: 0 };
    }
    default:
      return { output: `意图未识别：「${input}」\n\n可用命令：\n  taskq init / new / split / pipeline / clarify / run / execute / reset / done / list / status / report / ask\n或直接说：\n  「建个任务：写三篇迁移文档」\n  「拆分任务：写三篇 迁移文档」\n  「澄清上面的内容」\n  「跑队列」「批量执行」「跑流水线」「重跑 34-cshidaima」「从头再来」「看下进度」「出个报告」`, exitCode: 0 };
  }
}

// ========== 编排剧本（参考 speccore ask 模式4：steps + 拦停点 + confirm 开关）==========

/** 编排步骤 → CLI 命令（模板变量填充：批次/批量；批次 ID 由语义层裁决后传入） */
function stepCommand(batchId: string, orch: Orchestration, step: OrchestrationStep): string {
  const batch = batchId ? ` --batch ${batchId}` : '';
  const size = orch.batchSize ? ` --batch-size ${orch.batchSize}` : '';
  switch (step.intent) {
    case 'clarify': return 'taskq clarify';
    case 'split': return 'taskq split <素材路径或文字>';
    case 'new': return `taskq new <任务目标>${batch}`;
    case 'fix': return 'taskq fix --yes';
    case 'execute': return `taskq execute${batch}${size}`;
    case 'report': return `taskq report${batch}`;
    case 'done': return 'taskq done <task-id>（执行阶段逐任务验收登记，无需 --all）';
    default: return 'taskq help';
  }
}

/** split 步骤素材缺失检测：剥掉动作词/时序词/批量语后，剩不下可拆的「东西」→ 触发 NEEDS_INFO */
function splitMissingMaterial(input: string): boolean {
  const stripped = input
    .replace(/澄清|体检|检查|拆分|切分|拆任务|新建|建任务|创建任务|加任务|修复|执行|接力|跑起来|报告|复盘|归档|验收/g, ' ')
    .replace(/然后|接着|最后|之后|并且|还要|同时/g, ' ')
    .replace(/(?:全自动|自动完成|自动跑|别停|不用问|不需要确认|一路到底|无需确认|批次\s*0*\d{1,3}|batch-\d{3}|(?:一次领|每批|每一批|批量(?:执行|跑|接力)|领|跑)\s*(?:\d+|[一二两三四五六七八九十])?\s*个)/g, ' ')
    .replace(/[\s，,。？?！!：:、的了吗呢吧把和与及先再并]+/g, ' ')
    .trim();
  return stripped.length < 6;
}

/** 编排剧本：输出 [TASKQ_ORCHESTRATE] 块，宿主 AI 按序接力；拦停点随交互/非交互双态变化 */
export function renderOrchestration(cfg: TaskQConfig, input: string, orch: Orchestration): string {
  const mode = orch.auto ? '非交互（全自动）' : '交互（默认）';
  const settled = settleBatch(cfg, orch.batchRef);
  const batchId = settled.id || '';
  const lines: string[] = [];
  lines.push(`🎯 已编排「${orch.steps.map((s) => s.label).join(' → ')}」流程（${orch.steps.length} 步，${mode}）`);
  if (batchId) lines.push(`📍 批次：${batchId}${settled.note ? `——${settled.note}` : ''}`);
  if (orch.batchSize) lines.push(`🔢 批量：一次领取 ${orch.batchSize} 个任务`);
  lines.push('');
  lines.push('[TASKQ_ORCHESTRATE]');
  lines.push('你是 SpecTaskChain 编排执行者。按下面的步骤依次推进，每步用对应 CLI 命令执行，每步完成才能进下一步。');
  lines.push('');
  for (const s of orch.steps) {
    lines.push(`步骤 ${s.order}/${orch.steps.length}：${s.label}${s.gate ? '（拦停点）' : ''}`);
    lines.push(`  - ${s.explanation}`);
    lines.push(`  - 命令：${stepCommand(batchId, orch, s)}`);
    lines.push('');
  }
  lines.push('执行约定：');
  lines.push('- 退出码 10 = 接力继续；12 = 停下（draft 未补全 / doing 进行中 / failed 需人工介入），把情况亮给用户');
  if (orch.auto) {
    lines.push('- 非交互模式（用户原话要求全自动）：拦停点自动通过不打断；仅退出码 12（失败）时停下报告');
  } else {
    lines.push('- 交互模式：每个拦停点停下问用户，点头才继续；非拦停点步骤直接连跑');
  }
  lines.push('[/TASKQ_ORCHESTRATE]');
  if (settled.blocked) {
    lines.push('');
    lines.push(settled.blocked);
  }
  if (orch.steps.some((s) => s.intent === 'split') && splitMissingMaterial(input)) {
    lines.push('');
    lines.push('[TASKQ_NEEDS_INFO]');
    lines.push('拆分步骤缺素材，无法落盘：');
    lines.push('- 素材（必填）：文档路径 / 目录 / 纯文字任务清单 / 截图（宿主 AI 先视觉读取截图转成文字清单再拆）');
    lines.push('示例：');
    lines.push('  taskq ask "拆分 docs/prd.md，澄清，然后执行，全自动"');
    lines.push('  taskq ask "拆分这段清单：写周报邮件 / 整理会议纪要 / 复盘故障，然后澄清并执行"');
    lines.push('[/TASKQ_NEEDS_INFO]');
  }
  return lines.join('\n');
}
