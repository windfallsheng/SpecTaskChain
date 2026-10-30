// SpecTaskChain CLI：规格驱动的任务队列
// Chain = 接力（relay），不是依赖（dependency）——队列是第一公民，无人值守接力完成
import { resolveConfig, ensureStructure } from './core/config';
import { readVersion } from './core/version';
import { relayNext, batchRelay, renderBatchResult } from './core/runner';
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
import { pipelineCommand } from './commands/pipeline';

const VERSION = readVersion();

function helpText(): string {
  return [
    `SpecTaskChain v${VERSION} — 规格驱动的任务队列`,
    '',
    '用法：taskq <命令> [参数]',
    '',
    '命令：',
    '  init                      初始化队列骨架（queue/batch-001/ + .taskchain/）',
    '  new <描述> [--type doc] [--group 模块名] [--batch 批次] [--priority P1] [--tags  客户,线上] [--estimate 8] [--role coder]   建任务（对话成规格：AI 生成草案，你确认）',
    '  split <文档或文字> [--group 模块名] [--type 类型]   文档拆任务（只出 goal+初步内 容，不碰验收三态）',
    '  pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N]   端到端流水线（素材进→拆分→澄清→执行→收尾）',
    '  clarify [--task ID] [--file 路径] [--chain]  随叫随到的体检（写完查 / 建链查 / 翻车查）',
    '  run [--skip-draft] [--batch 批次|all]  无人值守接力执行（默认最新批次；输出下一任务 prompt）',
    '  execute [--batch-size N] [--skip-draft] [--batch 批次|all]  批次接力（一次领取 N 个任务的完整 prompt，默认 3；拦停语义同 run）',
    '  done <task-id> [--verdict "pass ..."]       验收登记（产物/断言/评审三态门禁）',
    '  list [--batch 批次] [--status todo|done|failed] [--type doc]   队列清单（按批次分组，三扇窗筛选）',
    '  status [--panel] [--batch 批次|all]  队列总览（默认聚焦最新批次；--panel 生成 HTML 可视化面板）',
    '  report [--batch 批次] [--status 状态] [--type 类型]   队列报告（执行留痕，有账可查）',
    '  ask "自然语言"            口语入口（「建个任务…」「澄清…」「跑队列」）',
    '',
    '理念：Spec 保证「做对」（验收先行），Chain 保证「干完」（接力 + 断点续跑）。',
    '批次：batch-NNN = 一次要做的全部任务。下次要用再建新批次（mkdir queue/batch-002），新任务自动落最新批次，run 默认跑最新批次。',
    '元数据（都可选，不写照样跑）：任务 SPEC.md 的 created-at/priority/tags/estimate/role；批次 BATCH.md 与模块 CONSTRAINTS.md 顶部的 name/purpose/created-at。',
    '执行角色（role，可选）：type 管形态，role 管专业——内置 generalist/document-writer/code-engineer/debug-engineer/test-engineer/security-reviewer/devops-engineer/data-analyst/research-analyst/presentation-designer（旧名兼容），自定义角色放 .taskchain/ROLES/{role}.md；未指定角色时 AI 按任务内容自动选择。',
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
        output = clarifyCommand(cfg, { taskId: flag('--task'), file: flag('--file'), chain: hasFlag('--chain') });
        break;
      case 'run': {
        // 退出码协议：0 队列清空 / 10 接力（宿主 AI 执行）/ 12 拦截（draft/模块缺共享 spec/doing 进行中/failed 需人工介入）——直接传播给宿主
        const result = relayNext(cfg, { skipDraft: hasFlag('--skip-draft'), batch: flag('--batch') });
        output = renderRunResult(result);
        process.exitCode = result.exitCode;
        break;
      }
      case 'execute': {
        // 批次接力：run 的批量化——一次领取 N 个任务的完整 prompt（默认 3），拦停语义与 run 一致
        const sizeRaw = flag('--batch-size');
        const size = sizeRaw !== undefined ? Number(sizeRaw) : undefined;
        const result = batchRelay(cfg, { batch: flag('--batch'), batchSize: size !== undefined && !isNaN(size) ? size : 3, skipDraft: hasFlag('--skip-draft') });
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
        output = reportCommand(cfg, { batch: flag('--batch'), status: flag('--status'), type: flag('--type') });
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
  } catch (e) {
    // 兜底：任何未预期异常都不裸奔堆栈，转友好报错 + 非零退出码
    output = `❌ 执行出错：${e instanceof Error ? e.message : String(e)}\n（提示：若报目录不存在，先运行 taskq init 初始化队列骨架）`;
    process.exitCode = 1;
  }
  process.stdout.write(output + '\n');
}

main();
