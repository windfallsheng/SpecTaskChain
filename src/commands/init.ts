// taskq init：初始化队列骨架（幂等）+ 生成宿主工具接力规则；--update 增量升级（对齐 speccore 惯例）
import { resolveConfig, ensureStructure } from '../core/config';
import { readVersion } from '../core/version';
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

export interface InitOptions {
  tools?: string[]; // 宿主工具（支持多个，逗号分隔传入）
  update?: boolean; // 增量升级：刷新已生成的工具规则到 CLI 当前版本 + 补骨架
}

/** 接力规则正文：教宿主 AI 如何驱动队列（退出码协议 / 验收三态 / 常用命令）。带版本标记，--update 据此刷新 */
function renderRuleSection(tool: string): string {
  return [
    RULE_ANCHOR,
    '',
    `> 由 \`taskq init --tools ${tool}\` 生成，规则版本 v${readVersion()}。`,
    '> CLI 升级后执行 `taskq init --update` 可把本文件刷新到最新版。',
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

/** 该工具的规则文件是否已生成（update 模式的扫描依据） */
function ruleExists(projectRoot: string, tool: string): boolean {
  const target = join(projectRoot, TOOL_RULES[tool]);
  if (!existsSync(target)) return false;
  if (tool === 'claude' || tool === 'codex') {
    return readFileSync(target, 'utf-8').includes(RULE_ANCHOR);
  }
  return true;
}

/** 过滤：指定工具（若传）∩ 已存在的规则 */
function resolveUpdateTargets(projectRoot: string, tools?: string[]): string[] {
  const all = Object.keys(TOOL_RULES);
  const candidates = tools && tools.length > 0 ? all.filter((t) => tools.includes(t)) : all;
  return candidates.filter((t) => ruleExists(projectRoot, t));
}

export function initCommand(cwd: string, opts: InitOptions = {}): string {
  const cfg = resolveConfig(cwd);
  ensureStructure(cfg);
  const lines = [
    '✅ 队列骨架已就绪（SpecTaskChain）',
    '',
    `  队列目录：${cfg.queueDir}`,
    '    tasks/                  ← 任务平铺（SPEC.md 三必填 + 正文自由）',
    '    .taskchain/state.json   ← 状态文件（断点续跑）',
    '    .taskchain/TASK_TYPES/  ← 自定义任务类型定义',
    '    .taskchain/ROLES/       ← 自定义执行角色（可带 applies-to 绑定任务类型/任务）',
    '    .taskchain/TEMPLATES/   ← 规格正文模板（{type}.md 类型级 / SPEC.md 通用）',
    '',
    '下一步：',
    '  taskq new "给三个仓库写迁移文档"   ← 对话成规格（AI 生成草案，你确认）',
    '  taskq clarify                        ← 随叫随到的体检（写完查一查）',
    '  taskq run                            ← 无人值守接力执行',
    '',
    'Chain = 接力（relay），不是依赖（dependency）。',
  ];
  const known = Object.keys(TOOL_RULES);
  const unknownTools = (opts.tools || []).filter((t) => !known.includes(t));

  // ── --update 增量升级模式（对齐 speccore：刷新已生成的规则到 CLI 当前版本）──
  if (opts.update) {
    const targets = resolveUpdateTargets(cfg.projectRoot, opts.tools);
    if (targets.length === 0) {
      lines.push(
        '',
        '  🔄 --update：未发现已生成的工具规则文件。',
        `     先用 taskq init --tools ${known.join('/')} 生成，再升级；或直接 init（幂等）重新生成。`
      );
    } else {
      const rels = targets.map((t) => writeToolRules(cfg.projectRoot, t));
      lines.push(
        '',
        `  🔄 已刷新 ${targets.length} 个宿主规则文件至 v${readVersion()}：`,
        ...rels.map((r) => `     ${r}`)
      );
    }
    if (unknownTools.length > 0) {
      lines.push('', `  ⚠️ 暂不支持的工具：${unknownTools.join(', ')}（支持：${known.join('/')}）`);
    }
    return lines.join('\n');
  }

  // ── 常规模式：--tools 生成宿主 AI 接力规则文件 ──
  if (opts.tools && opts.tools.length > 0) {
    for (const tool of opts.tools) {
      if (!known.includes(tool)) {
        lines.push('', `  ⚠️ 暂不支持的工具：${tool}（支持：${known.join('/')}）`);
        continue;
      }
      const rel = writeToolRules(cfg.projectRoot, tool);
      lines.push('', `  ✅ 已生成 ${tool} 的宿主接力规则：${rel}（重复执行 init 即刷新）`);
    }
  }
  return lines.join('\n');
}
