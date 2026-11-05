// SpecTaskChain CLI：规格驱动的任务队列
// Chain = 接力（relay），不是依赖（dependency）——队列是第一公民，无人值守接力完成
import { resolveConfig, ensureStructure } from './core/config';
import { parseDue } from './core/task-spec';
import { readVersion } from './core/version';
import { helpText, guideText, commandDetail } from './core/help';
import { generateGuideHtml } from './core/guide';
import { relayNext, batchRelay, renderBatchResult } from './core/runner';
import { initCommand } from './commands/init';
import { newCommand } from './commands/new';
import { clarifyCommand } from './commands/clarify';
import { fixCommand } from './commands/fix';
import { renderRunResult, runCommand, parseRunRange, renderRunPanel, renderRunPlan } from './commands/run';
import { doneCommand } from './commands/done';
import { resetCommand } from './commands/reset';
import { statusCommand } from './commands/status';
import { reportCommand } from './commands/report';
import { historyCommand } from './commands/history';
import { listCommand } from './commands/list';
import { askCommand } from './commands/ask';
import { splitCommand } from './commands/split';
import { pipelineCommand } from './commands/pipeline';

const VERSION = readVersion();

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rest = args.slice(1);
  const cwd = process.cwd();
  const cfg = resolveConfig(cwd);
  let output = '';

  const flag = (name: string): string | undefined => {
    const idx = rest.indexOf(name);
    return idx >= 0 ? rest[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => rest.includes(name);
  // 有值旗标：其后一个元素是值，不属于位置参数；布尔旗标（--auto/--skip-draft/--draft 等）不吞后邻元素
  // （否则 `run clarify --batch-size 4` 的 4 会漏进位置参数被当成 split 素材）
  const VALUE_FLAGS = ['--name', '--type', '--group', '--priority', '--tags', '--estimate', '--due', '--role', '--batch', '--task', '--module', '--batch-size', '--file', '--verdict', '--spent', '--tools', '--status'];
  const positionalArgs = (arr: string[]): string[] =>
    arr.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(arr[i - 1])));

  try {
    switch (cmd) {
      case 'init': {
        const toolsRaw = flag('--tools') || '';
        output = initCommand(cwd, {
          tools: toolsRaw.split(',').map((s) => s.trim()).filter(Boolean),
          update: hasFlag('--update'),
        });
        break;
      }
      case 'new': {
        const goal = positionalArgs(rest).join(' ');
        const estRaw = flag('--estimate');
        const est = estRaw !== undefined ? Number(estRaw) : undefined;
        output = newCommand(cfg, {
          goal,
          name: flag('--name'),
          type: flag('--type'),
          draft: hasFlag('--draft'),
          group: flag('--group'),
          batch: flag('--batch'),
          priority: flag('--priority'),
          tags: flag('--tags')?.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          estimate: est !== undefined && !isNaN(est) ? est : undefined,
          due: flag('--due'),
          role: flag('--role'),
        });
        // 英译接力请求（[TASKQ_PROMPT]）无论 --draft 都 exit 10；否则不带 --draft 时请求宿主 AI 接力生成规格草案（与 split 同协议）
        // （goal 为空已被 newCommand 拦截，提示用法不是接力信号，不设退出码）
        if (output.includes('[TASKQ_PROMPT')) process.exitCode = 10;
        else if (goal.trim() && !hasFlag('--draft')) process.exitCode = 10;
        break;
      }
      case 'split': {
        // 文档拆任务：CLI 读文档 + 钉边界，拆分是宿主 AI 的语义活（退出码 10 接力）
        const input = positionalArgs(rest).join(' ').trim();
        if (!input) {
          output = '用法：taskq split <文件路径或文字> [--group 模块名] [--type 类型]\n\n示例：\n  taskq split docs/prd.md --group auth\n  taskq split "写三篇迁移文档，再加一篇回滚手册"';
          break;
        }
        output = splitCommand(cfg, input, { group: flag('--group'), type: flag('--type'), auto: hasFlag('--auto') });
        process.exitCode = 10; // 宿主 AI 接力：执行拆分 prompt
        break;
      }
      case 'clarify':
        output = clarifyCommand(cfg, { taskId: flag('--task'), file: flag('--file'), chain: hasFlag('--chain'), html: hasFlag('--html'), noReport: hasFlag('--no-report'), forceReport: hasFlag('--report'), decide: hasFlag('--decide') });
        break;
      case 'fix':
        // 体检处方的执行者：A 档机械修（output/acceptance 骨架/role/摘 draft）；TTY 下逐项确认，非 TTY 只提示（--yes 授权应用）
        output = fixCommand(cfg, { taskId: flag('--task'), dryRun: hasFlag('--dry-run'), yes: hasFlag('--yes'), noOverwrite: hasFlag('--no-overwrite'), forceOverwrite: hasFlag('--overwrite') });
        break;
      case 'run': {
        // 阶段流水线推进器：无参 = 智能续跑（断点面板 + 单任务接力）；
        // 带阶段参数 = preset/范围剧本（clarify to execute），--auto 非交互闸口
        const positional = positionalArgs(rest);
        if (positional.length) {
          const range = parseRunRange(positional);
          if (!range) {
            // 位置参数非空但解析不出阶段：明确报错，绝不静默退化成智能续跑（防误触发接力）
            output = '❌ 无法识别 run 阶段参数：' + positional.join(' ') + '\n\n可用阶段：clarify（体检/澄清）/ split（拆分/拆）/ execute（执行/接力/跑）/ report（报告/复盘）\n\n示例：\n  taskq run clarify\n  taskq run clarify to execute\n  taskq run split docs/prd.md --auto\n  taskq run            # 无参 = 智能续跑';
            break;
          }
          if (range.from) {
            output = renderRunPanel(cfg, { batch: flag('--batch') }) + '\n\n' + renderRunPlan(cfg, {
              from: range.from,
              to: range.to,
              auto: hasFlag('--auto'),
              material: range.material,
              batch: flag('--batch'),
              batchSize: flag('--batch-size') !== undefined && !isNaN(Number(flag('--batch-size'))) ? Number(flag('--batch-size')) : undefined,
            });
            process.exitCode = 10; // 剧本交给宿主 AI 接力推进
            break;
          }
        }
        // 退出码协议：0 队列清空 / 10 接力（宿主 AI 执行）/ 12 拦截（draft/模块缺共享 spec/doing 进行中/failed 需人工介入）——直接传播给宿主
        const result = relayNext(cfg, { skipDraft: hasFlag('--skip-draft'), batch: flag('--batch'), task: flag('--task'), module: flag('--module'), noReport: hasFlag('--no-report'), forceReport: hasFlag('--report') });
        output = renderRunPanel(cfg, { batch: flag('--batch') }) + '\n\n' + renderRunResult(result);
        process.exitCode = result.exitCode;
        break;
      }
      case 'execute': {
        // 批次接力：run 的批量化——一次领取 N 个任务的完整 prompt（默认 3），拦停语义与 run 一致
        const sizeRaw = flag('--batch-size');
        const size = sizeRaw !== undefined ? Number(sizeRaw) : undefined;
        // batchSize 只传「显式提供」的值；未提供传 undefined → batchRelay 内部走批次配置（BATCH.yaml）→ 系统默认的优先级链
        const result = batchRelay(cfg, { batch: flag('--batch'), batchSize: size !== undefined && !isNaN(size) ? size : undefined, skipDraft: hasFlag('--skip-draft'), task: flag('--task'), module: flag('--module'), noReport: hasFlag('--no-report'), forceReport: hasFlag('--report') });
        output = renderBatchResult(result);
        process.exitCode = result.exitCode;
        break;
      }
      case 'pipeline': {
        // 端到端流水线：素材进（描述/文件/目录）→ 拆分 → 澄清 → 执行 → 收尾（编排归宿主 AI，退出码 10 接力）
        const input = positionalArgs(rest).join(' ').trim();
        if (!input) {
          output = '用法：taskq pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N]\n\n示例：\n  taskq pipeline docs/新需求.md\n  taskq pipeline "做一套登录系统，含注册、找回密码、后台审计" --type feature';
          break;
        }
        const sizeRaw = flag('--batch-size');
        const size = sizeRaw !== undefined ? Number(sizeRaw) : undefined;
        output = pipelineCommand(cfg, input, { batch: flag('--batch'), batchSize: size !== undefined && !isNaN(size) ? size : undefined, type: flag('--type'), group: flag('--group'), auto: hasFlag('--auto') });
        process.exitCode = 10;
        break;
      }
      case 'reset': {
        // 重跑复位：目标 = 任务ID / 模块ID / batch-NNN / --all；--hard 连留痕 PROGRESS.md 清空
        // --all 是旗标形式的目标（resetCommand 内部认 '--all'|'all'），不能只从非 -- 位置参数里找
        const target = rest.find((a) => !a.startsWith('--')) || (hasFlag('--all') ? '--all' : '');
        if (!target) {
          output = '用法：taskq reset <task-id|模块ID|batch-NNN|--all> [--hard]\n\n示例：\n  taskq reset 34-cshidaima\n  taskq reset module-yingxiaomokuai\n  taskq reset --all --hard';
          break;
        }
        output = resetCommand(cfg, target, { hard: hasFlag('--hard') });
        break;
      }
      case 'done': {
        const taskId = rest.find((a) => !a.startsWith('--')) || '';
        const spentRaw = flag('--spent');
        const spent = spentRaw !== undefined ? Number(spentRaw) : undefined;
        output = doneCommand(cfg, { taskId, verdict: flag('--verdict'), spent: spent !== undefined && !isNaN(spent) ? spent : undefined });
        break;
      }
      case 'list':
        output = listCommand(cfg, { batch: flag('--batch'), status: flag('--status'), type: flag('--type') });
        break;
      case 'status':
        output = statusCommand(cfg, { panel: hasFlag('--panel'), batch: flag('--batch') });
        break;
      case 'report':
        output = reportCommand(cfg, { batch: flag('--batch'), status: flag('--status'), type: flag('--type'), html: hasFlag('--html') });
        break;
      case 'history': {
        // 操作轨迹：时间线回放（默认最近 30 条；--limit 0 = 全量；--batch/--task/--since 三把过滤）
        const limitRaw = flag('--limit');
        const limit = limitRaw !== undefined && !isNaN(Number(limitRaw)) ? Number(limitRaw) : 30;
        const sinceRaw = flag('--since');
        output = historyCommand(cfg, {
          batch: flag('--batch'),
          task: flag('--task'),
          since: sinceRaw ? parseDue(sinceRaw) || sinceRaw : undefined, // 口语日期（今天/昨天/前天）→ YYYY-MM-DD
          limit: limit || undefined,
        });
        break;
      }
      case 'ask': {
        const input = rest.join(' ');
        if (input) {
          const r = askCommand(cfg, input);
          output = r.output;
          process.exitCode = r.exitCode || 0; // 接力类意图（run/execute/split/pipeline）必须传播退出码给宿主
        } else {
          output = helpText();
        }
        break;
      }
      case 'help':
      case '--help':
      case '-h':
      case undefined: {
        // help [guide|<命令>] [--html]：总览 → 引导页 / 单命令详情；--html 生成 HTML 引导页
        if (hasFlag('--html')) {
          const guidePath = generateGuideHtml(cfg);
          output = `📖 HTML 引导页已生成：${guidePath}\n\n双击打开即可看：上手三步 + 目录布局 + 命令速查 + 常见问题。`;
        } else if (rest[0] === 'guide') output = guideText();
        else if (rest[0] && !rest[0].startsWith('-')) output = commandDetail(rest[0]);
        else output = helpText();
        break;
      }
      case '--version':
      case '-v':
        output = VERSION;
        break;
      default:
        output = `未知命令：${cmd}\n\n${helpText()}`;
    }
  } catch (e) {
    // 兜底：任何未预期异常都不裸奔堆栈，转友好报错 + 非零退出码
    output = `❌ 执行出错：${e instanceof Error ? e.message : String(e)}\n（提示：若报目录不存在，先运行 taskq init 初始化队列骨架）`;
    process.exitCode = 1;
  }
  process.stdout.write(output + '\n');
}

main();
