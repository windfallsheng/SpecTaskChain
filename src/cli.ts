// SpecTaskChain CLI：规格驱动的任务队列
// Chain = 接力（relay），不是依赖（dependency）——队列是第一公民，无人值守接力完成
import { resolveConfig, ensureStructure } from './core/config';
import { relayNext } from './core/runner';
import { initCommand } from './commands/init';
import { newCommand } from './commands/new';
import { clarifyCommand } from './commands/clarify';
import { renderRunResult, runCommand } from './commands/run';
import { doneCommand } from './commands/done';
import { statusCommand } from './commands/status';
import { reportCommand } from './commands/report';
import { listCommand } from './commands/list';
import { askCommand } from './commands/ask';
import { splitCommand } from './commands/split';

const VERSION = '0.1.1';

function helpText(): string {
  return [
    `SpecTaskChain v${VERSION} — 规格驱动的任务队列`,
    '',
    '用法：taskq <命令> [参数]',
    '',
    '命令：',
    '  init                      初始化队列骨架（queue/ + .taskchain/）',
    '  new <描述> [--type doc] [--group 模块名]   建任务（对话成规格：AI 生成草案，你确认）',
    '  split <文档或文字> [--group 模块名] [--type 类型]   文档拆任务（只出 goal+初步内容，不碰验收三态）',
    '  clarify [--task ID] [--file 路径]           随叫随到的体检（写完查 / 建链查 / 翻车查）',
    '  run [--skip-draft]        无人值守接力执行（输出下一任务 prompt）',
    '  done <task-id> [--verdict "pass ..."]       验收登记（产物/断言/评审三态门禁）',
    '  list                      队列清单',
    '  status [--panel]          队列总览（--panel 生成 HTML 可视化面板）',
    '  report                    队列报告（执行留痕，有账可查）',
    '  ask "自然语言"            口语入口（「建个任务…」「澄清…」「跑队列」）',
    '',
    '理念：Spec 保证「做对」（验收先行），Chain 保证「干完」（接力 + 断点续跑）。',
    '规格轻而有骨：frontmatter 三必填（goal/output/acceptance）+ 正文自由。',
  ].join('\n');
}

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

  switch (cmd) {
    case 'init':
      output = initCommand(cwd);
      break;
    case 'new': {
      const goal = rest.filter((a) => !a.startsWith('--') && !['--name', '--type', '--group'].includes(a) && (rest.indexOf(a) === 0 || !rest[rest.indexOf(a) - 1].startsWith('--'))).join(' ');
      output = newCommand(cfg, {
        goal: goal || '未命名任务',
        name: flag('--name'),
        type: flag('--type'),
        draft: hasFlag('--draft'),
        group: flag('--group'),
      });
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
      output = clarifyCommand(cfg, { taskId: flag('--task'), file: flag('--file'), chain: hasFlag('--chain') });
      break;
    case 'run': {
      // 退出码协议：0 队列清空 / 10 接力（宿主 AI 执行）/ 12 draft 拦截——直接传播给宿主
      const result = relayNext(cfg, { skipDraft: hasFlag('--skip-draft') });
      output = renderRunResult(result);
      process.exitCode = result.exitCode;
      break;
    }
    case 'done': {
      const taskId = rest.find((a) => !a.startsWith('--')) || '';
      output = doneCommand(cfg, { taskId, verdict: flag('--verdict') });
      break;
    }
    case 'list':
      output = listCommand(cfg);
      break;
    case 'status':
      output = statusCommand(cfg, { panel: hasFlag('--panel') });
      break;
    case 'report':
      output = reportCommand(cfg);
      break;
    case 'ask': {
      const input = rest.join(' ');
      output = input ? askCommand(cfg, input) : helpText();
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      output = helpText();
      break;
    case '--version':
    case '-v':
      output = VERSION;
      break;
    default:
      output = `未知命令：${cmd}\n\n${helpText()}`;
  }
  process.stdout.write(output + '\n');
}

main();
