// taskq init：初始化队列骨架（幂等）+ 可选生成宿主工具接力规则
import { resolveConfig, ensureStructure } from '../core/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

/** 宿主工具 → 接力规则文件路径（相对项目根）。claude/codex 为追加式，其余为独立规则文件 */
const TOOL_RULES: Record<string, string> = {
  qoder: '.qoder/rules/taskq-relay.md',
  claude: 'CLAUDE.md',
  cursor: '.cursor/rules/taskq-relay.md',
  windsurf: '.windsurf/rules/taskq-relay.md',
  trae: '.trae/rules/taskq-relay.md',
  codex: 'AGENTS.md',
};

const RULE_ANCHOR = '## taskq 接力协议（SpecTaskChain）';

/** 接力规则正文：教宿主 AI 如何驱动队列（退出码协议 / 验收三态 / 常用命令） */
function renderRuleSection(tool: string): string {
  return [
    RULE_ANCHOR,
    '',
    `> 由 \`taskq init --tools ${tool}\` 生成，重复执行即刷新。`,
    '',
    '**队列是第一公民，链 = 接力（relay），不是依赖。**',
    '',
    '### 宿主操作协议',
    '1. `taskq run` 领取下一任务：退出码 10 → 执行输出的 `[TASKQ_PROMPT]` 块',
    '2. 完成后按 SPEC.md 验收三态核对（artifacts 产物 / asserts 断言 / review 评审），再 `taskq done <id> --verdict "pass ..."`',
    '3. 退出码 12 = 拦截（draft 未定稿 / doing 进行中 / failed 需人工介入）→ 停下向用户报告',
    '4. 退出码 0 = 队列清空',
    '',
    '### SPEC.md 三必填（frontmatter）',
    'goal（任务目标）/ output（产物路径）/ acceptance（验收三态）',
    '',
    '### 常用命令',
    '`taskq status` `taskq list` `taskq clarify` `taskq report` `taskq new "描述"`',
  ].join('\n');
}

/** 写工具规则：追加式（claude/codex）按锚点替换旧块，独立式直接覆盖写 */
function writeToolRules(projectRoot: string, tool: string): string {
  const rel = TOOL_RULES[tool];
  const target = join(projectRoot, rel);
  const section = renderRuleSection(tool);
  if (tool === 'claude' || tool === 'codex') {
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    if (existing.includes(RULE_ANCHOR)) {
      // 已有旧块 → 整体替换（块延伸到下一个标题前）
      const start = existing.indexOf(RULE_ANCHOR);
      const rest = existing.slice(start + RULE_ANCHOR.length);
      const m = /\n(?:#{1,2} )/.exec(rest);
      const end = m ? start + RULE_ANCHOR.length + m.index : existing.length;
      writeFileSync(target, existing.slice(0, start) + section + existing.slice(end).replace(/^\n+/, '\n'), 'utf-8');
    } else {
      writeFileSync(target, (existing.trimEnd() ? existing.trimEnd() + '\n\n' : '') + section + '\n', 'utf-8');
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, section + '\n', 'utf-8');
  }
  return rel;
}

export function initCommand(cwd: string, opts: { tools?: string; update?: boolean } = {}): string {
  const cfg = resolveConfig(cwd);
  ensureStructure(cfg);
  const lines = [
    '✅ 队列骨架已就绪（SpecTaskChain）',
    '',
    `  队列目录：${cfg.queueDir}`,
    '    tasks/                  ← 任务平铺（SPEC.md 三必填 + 正文自由）',
    '    .taskchain/state.json   ← 状态文件（断点续跑）',
    '    .taskchain/TASK_TYPES/  ← 自定义任务类型定义',
    '',
    '下一步：',
    '  taskq new "给三个仓库写迁移文档"   ← 对话成规格（AI 生成草案，你确认）',
    '  taskq clarify                        ← 随叫随到的体检（写完查一查）',
    '  taskq run                            ← 无人值守接力执行',
    '',
    'Chain = 接力（relay），不是依赖（dependency）。',
  ];
  // --tools：生成宿主 AI 接力规则文件（重复执行即刷新）
  if (opts.tools) {
    const known = Object.keys(TOOL_RULES);
    if (!known.includes(opts.tools)) {
      lines.push('', `  ⚠️ 暂不支持的工具：${opts.tools}（支持：${known.join('/')}）`);
    } else {
      const rel = writeToolRules(cfg.projectRoot, opts.tools);
      lines.push('', `  ✅ 已生成 ${opts.tools} 的宿主接力规则：${rel}（重复执行 init 即刷新）`);
    }
  }
  // --update：不存在的参数——init 幂等，重复执行即更新，正面回应而非静默吞掉
  if (opts.update) {
    lines.push('', '  已收到 --update：init 是幂等的，重复执行即更新骨架与工具规则，无需 --update 参数。');
  }
  return lines.join('\n');
}
