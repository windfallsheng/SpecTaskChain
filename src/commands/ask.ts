// taskq ask：自然语言入口——意图识别 + 参数提取 + 精确执行
// 分工：宿主 AI 负责指代消解（「上面的内容」→ 文件路径），CLI 负责意图识别与执行
import { TaskQConfig } from '../core/config';
import { recognizeIntent } from '../core/intent';
import { clarifyCommand } from './clarify';
import { runCommand } from './run';
import { statusCommand } from './status';
import { reportCommand } from './report';
import { listCommand } from './list';
import { initCommand } from './init';
import { newCommand } from './new';

export function askCommand(cfg: TaskQConfig, input: string): string {
  const result = recognizeIntent(input);
  switch (result.intent) {
    case 'clarify':
      return clarifyCommand(cfg, { taskId: result.params.taskId, file: result.params.file });
    case 'run':
      return runCommand(cfg, {});
    case 'status':
      return statusCommand(cfg, {});
    case 'report':
      return reportCommand(cfg);
    case 'list':
      return listCommand(cfg);
    case 'new':
      // 提取任务描述（「建个任务：写文档」→ 写文档）；创建命名（叫 X 的/--name/--group）由意图识别带出
      const goalMatch = input.match(/任务[:：]?\s*(.+)$/);
      let goal = goalMatch ? goalMatch[1].trim() : input;
      if (result.params.group) {
        // 剥掉「放 X 模块」后缀，goal 只留任务本身
        goal = goal.replace(new RegExp(`[,，]?\\s*放?${result.params.group}模块$`), '').trim();
      }
      return newCommand(cfg, {
        goal: goal.slice(0, 60),
        draft: false,
        name: result.params.taskName,
        group: result.params.group,
      });
    case 'done':
      return `任务完成登记：taskq done ${result.params.taskId || '<task-id>'} --verdict "pass 评审结论"`;
    default:
      return `意图未识别：「${input}」\n\n可用命令：\n  taskq init / new / clarify / run / done / list / status / report / ask\n或直接说：\n  「建个任务：写三篇迁移文档」\n  「澄清上面的内容」\n  「跑队列」「看下进度」「出个报告」`;
  }
}
