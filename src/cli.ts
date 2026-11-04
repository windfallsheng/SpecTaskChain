// SpecTaskChain CLI：规格驱动的任务队列
// Chain = 接力（relay），不是依赖（dependency）——队列是第一公民，无人值守接力完成
import { resolveConfig, ensureStructure } from './core/config';
import { readVersion } from './core/version';
import { helpText, guideText, commandDetail } from './core/help';
import { generateGuideHtml } from './core/guide';
import { relayNext, batchRelay, renderBatchResult } from './core/runner';
import { initCommand } from './commands/init';
import { newCommand } from './commands/new';
import { clarifyCommand } from './commands/clarify';
import { fixCommand } from './commands/fix';
import { renderRunResult, runCommand } from './commands/run';
import { doneCommand } from './commands/done';
import { resetCommand } from './commands/reset';
import { statusCommand } from './commands/status';
import { reportCommand } from './commands/report';
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
        const paramFlags = ['--name', '--type', '--group', '--priority', '--tags', '--estimate', '--role'];
        const goal = rest.filter((a) => !a.startsWith('--') && !paramFlags.includes(a) && (rest.indexOf(a) === 0 || !rest[rest.indexOf(a) - 1].startsWith('--'))).join(' ');
        const estRaw = flag('--estimate');
        const est = estRaw !== undefined ? Number(estRaw) : undefined;
        output = newCommand(cfg, {
          goal: goal || '未命名任务',
          name: flag('--name'),
          type: flag('--type'),
          draft: hasFlag('--draft'),
          group: flag('--group'),
          priority: flag('--priority'),
          tags: flag('--tags')?.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          estimate: est !== undefined && !isNaN(est) ? est : undefined,
          role: flag('--role'),
        });
        // 不带 --draft 时请求宿主 AI 接力生成规格草案——与 split 同协议：退出码 10
        if (!hasFlag('--draft')) process.exitCode = 10;
        break;
      }
      case 'split': {
        // 文档拆任务：CLI 读文档 + 钉边界，拆分是宿主 AI 的语义活（退出码 10 接力）
        const input = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--'))).join(' ').trim();
        if (!input) {
          output = '用法：taskq split <文件路径或文字> [--group 模块名] [--type 类型]\n\n示例：\n  taskq split docs/prd.md --group auth\n  taskq split "写三篇迁移文档，再加一篇回滚手册"';
          break;
        }
        output = splitCommand(cfg, input, { group: flag('--group'), type: flag('--type') });
        process.exitCode = 10; // 宿主 AI 接力：执行拆分 prompt
        break;
      }
      case 'clarify':
        output = clarifyCommand(cfg, { taskId: flag('--task'), file: flag('--file'), chain: hasFlag('--chain'), html: hasFlag('--html'), noReport: hasFlag('--no-report'), forceReport: hasFlag('--report') });
        break;
      case 'fix':
        // 体检处方的执行者：A 档机械修（output/acceptance 骨架/role/摘 draft）；TTY 下逐项确认，非 TTY 只提示（--yes 授权应用）
        output = fixCommand(cfg, { taskId: flag('--task'), dryRun: hasFlag('--dry-run'), yes: hasFlag('--yes'), noOverwrite: hasFlag('--no-overwrite'), forceOverwrite: hasFlag('--overwrite') });
        break;
      case 'run': {
        // 退出码协议：0 队列清空 / 10 接力（宿主 AI 执行）/ 12 拦截（draft/模块缺共享 spec/doing 进行中/failed 需人工介入）——直接传播给宿主
        const result = relayNext(cfg, { skipDraft: hasFlag('--skip-draft'), batch: flag('--batch'), task: flag('--task'), module: flag('--module'), noReport: hasFlag('--no-report'), forceReport: hasFlag('--report') });
        output = renderRunResult(result);
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
        const input = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--'))).join(' ').trim();
        if (!input) {
          output = '用法：taskq pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N]\n\n示例：\n  taskq pipeline docs/新需求.md\n  taskq pipeline "做一套登录系统，含注册、找回密码、后台审计" --type feature';
          break;
        }
        const sizeRaw = flag('--batch-size');
        const size = sizeRaw !== undefined ? Number(sizeRaw) : undefined;
        output = pipelineCommand(cfg, input, { batch: flag('--batch'), batchSize: size !== undefined && !isNaN(size) ? size : undefined, type: flag('--type'), group: flag('--group') });
        process.exitCode = 10;
        break;
      }
      case 'reset': {
        // 重跑复位：目标 = 任务ID / 模块ID / batch-NNN / --all；--hard 连留痕 PROGRESS.md 清空
        const target = rest.find((a) => !a.startsWith('--')) || '';
        if (!target) {
          output = '用法：taskq reset <task-id|模块ID|batch-NNN|--all> [--hard]\n\n示例：\n  taskq reset 34-cshidaima\n  taskq reset module-yingxiaomokuai\n  taskq reset --all --hard';
          break;
        }
        output = resetCommand(cfg, target, { hard: hasFlag('--hard') });
        break;
      }
      case 'done': {
        const taskId = rest.find((a) => !a.startsWith('--')) || '';
        output = doneCommand(cfg, { taskId, verdict: flag('--verdict') });
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
