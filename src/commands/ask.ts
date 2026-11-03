// taskq ask：自然语言入口——意图识别 + 参数提取 + 精确执行
// 分工：宿主 AI 负责指代消解（「上面的内容」→ 文件路径），CLI 负责意图识别与执行
// 返回结构携带 exitCode：接力类意图（run/execute/split/pipeline）必须把退出码传播给宿主，标记 + 退出码双保险
import { TaskQConfig } from '../core/config';
import { recognizeIntent } from '../core/intent';
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

export function askCommand(cfg: TaskQConfig, input: string): AskResult {
  const result = recognizeIntent(input);
  switch (result.intent) {
    case 'clarify':
      return { output: clarifyCommand(cfg, { taskId: result.params.taskId, file: result.params.file }), exitCode: 0 };
    case 'run': {
      // 直调 relayNext 拿退出码（runCommand 只返回文本会丢失接力信号）
      const r = relayNext(cfg, {});
      return { output: renderRunResult(r), exitCode: r.exitCode };
    }
    case 'execute': {
      // 批次大小走意图识别（「一次领 5 个」→ 5），未识别时 undefined 走默认 3
      const r = batchRelay(cfg, { batchSize: result.params.batchSize });
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
    case 'status':
      return { output: statusCommand(cfg, {}), exitCode: 0 };
    case 'report':
      return { output: reportCommand(cfg), exitCode: 0 };
    case 'list':
      return { output: listCommand(cfg), exitCode: 0 };
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
      return {
        output: newCommand(cfg, {
          goal: goal.slice(0, 60),
          draft: false,
          name: result.params.taskName,
          group: result.params.group,
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
      return { output: `意图未识别：「${input}」\n\n可用命令：\n  taskq init / new / split / pipeline / clarify / run / execute / reset / done / list / status / report / ask\n或直接说：\n  「建个任务：写三篇迁移文档」\n  「拆分任务：写三篇迁移文档」\n  「澄清上面的内容」\n  「跑队列」「批量执行」「跑流水线」「重跑 34-cshidaima」「从头再来」「看下进度」「出个报告」`, exitCode: 0 };
  }
}
