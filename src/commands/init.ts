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

/** 宿主工具 → SKILL 主入口路径（薄包装：意图透传 + 输出标记处理协议，对齐 speccore ask）。仅支持有项目级 skill 约定的工具 */
const TOOL_SKILLS: Record<string, string> = {
  qoder: '.agents/skills/taskq/SKILL.md',
  claude: '.claude/skills/taskq/SKILL.md',
  cursor: '.cursor/skills/taskq/SKILL.md',
};

/** 宿主工具 → skill 根目录（主入口 + 4 个高频专属都平铺在该目录下） */
const TOOL_SKILL_DIRS: Record<string, string> = {
  qoder: '.agents/skills',
  claude: '.claude/skills',
  cursor: '.cursor/skills',
};

const RULE_ANCHOR = '## taskq 接力协议（SpecTaskChain）';

export interface InitOptions {
  tools?: string[]; // 宿主工具（支持多个，逗号分隔传入）
  update?: boolean; // 增量升级：刷新已生成的工具规则到 CLI 当前版本 + 补骨架
}

/** 单个 SKILL 文件：薄包装（对齐 speccore ask 引擎 + 专属 skill 模式） */
interface SkillFile {
  rel: string;
  content: string;
}

/** SKILL frontmatter 骨架 */
function skillFm(name: string, desc: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: >',
    ...desc.split('\n').map((l) => `  ${l}`),
    'allowed-tools: ["Bash", "Read", "Write", "Edit"]',
    'disable-model-invocation: false',
    '---',
  ].join('\n');
}

/** 生成全部 SKILL 文件：1 个总入口（taskq）+ 4 个高频专属（new/run/clarify/done）。薄包装：透传 CLI，意图逻辑归 taskq ask */
function renderSkillFiles(tool: string): SkillFile[] {
  const v = readVersion();
  const base = TOOL_SKILL_DIRS[tool]; // 各工具 skill 根目录（qoder: .agents/skills / claude: .claude/skills / cursor: .cursor/skills）
  const rel = (name: string) => join(base, name, 'SKILL.md');
  const ver = `> 由 \`taskq init --tools ${tool}\` 生成，SKILL 版本 v${v}。CLI 升级后执行 \`taskq init --update\` 刷新。`;
  const noScope = '以下情况明确不触发（走正常 AI 对话）：解释代码逻辑、审查代码片段、讨论需求合理性、排查具体 bug、一般性技术咨询、算法实现、架构讨论、任何不涉及 taskq CLI 执行的请求。';

  const main: SkillFile = {
    rel: rel('taskq'),
    content: [
      skillFm('taskq', [
        'SpecTaskChain 任务队列总入口。仅在用户明确要求通过 taskq 命令行工具操作任务队列时触发：',
        '建任务（new，对话成规格）、文档拆任务（split）、端到端流水线（pipeline）、',
        '体检（clarify）、无人值守接力（run/execute）、验收登记（done）、重跑复位（reset）、',
        '队列查看（status/list/report）、初始化（init）。',
        '高频操作有专属入口：/taskq-new /taskq-run /taskq-clarify /taskq-done。',
        noScope,
      ].join('\n')),
      '',
      '# taskq — 任务队列执行引擎（薄包装，对齐 speccore ask）',
      '',
      '直接执行：execute_command("taskq ask \'用户原话\'")\n\n不要输出命令文本，不要自行分析意图，一切交给 taskq ask 做意图识别与参数提取；ask 识别不出时，按下方命令表直接执行对应命令。',
      '',
      ver,
      '',
      '## 意图 → 命令表（ask 未命中时兜底）',
      '',
      '| 用户意图 | 命令 |',
      '| :--- | :--- |',
      '| 建任务 | taskq new "描述" [--type doc] [--group 模块] [--batch 批次] [--role 角色] |',
      '| 文档拆任务 | taskq split <文档或文字> |',
      '| 端到端流水线 | taskq pipeline <描述/文件/目录> |',
      '| 体检 | taskq clarify [--task ID] [--chain] |',
      '| 接力执行 | taskq run [--batch 批次\|all] [--task ID] [--module 模块] / taskq execute --batch-size 3 |',
      '| 验收登记 | taskq done <id> --verdict "pass 理由" |',
      '| 重跑复位 | taskq reset <id\|模块\|批次\|--all> [--hard] |',
      '| 查看队列 | taskq status / taskq list / taskq report |',
      '',
      '## 输出标记处理',
      '',
      '- `[TASKQ_PROMPT]` … `[TASKQ_PROMPT_END]` → 按其中任务规格**立即执行**：产出写到指定路径，完成后 `taskq done <id> --verdict "pass 理由"`，同一会话继续 `taskq run` 接力下一个',
      '- `[TASKQ_SPEC_DRAFT]` → 按骨架写回 SPEC.md（frontmatter 三必填 goal/output/acceptance + 正文），写回后提醒用户 `taskq clarify --task <id>` 体检',
      '- `[TASKQ_PIPELINE]` … `[TASKQ_PIPELINE_END]` → 按剧本逐项执行',
      '- 退出码 10 → 已领取任务：按 prompt 执行 → done → 继续 run（同一会话优先）',
      '- 退出码 12 → 拦截（draft 未定稿 / doing 占位 / failed 需人工介入）→ 停下向用户说明原因',
      '- 退出码 0 → 队列清空',
      '- clarify 报告三档：⛔ 阻塞先处理（补 / 给默认值 / 标记 draft / 无视四选一）→ ⚠️ 建议 → 待定',
      '',
      '## 验收三闸（done 前机器核对，缺了不算完）',
      '',
      '1. artifacts 产物门禁（文件在不在）2. checks 断言门禁（命令退出码非 0 不算完）3. review 评审门禁（结论要覆盖）',
      '',
      '## 接力哲学',
      '',
      '队列是第一公民，链 = 接力（relay），不是依赖：干完一个、下一个接着来；换会话续跑 state.json 账本，无需重新交代。',
    ].join('\n'),
  };

  const sub = (name: string, title: string, trigger: string, exec: string, body: string[]): SkillFile => ({
    rel: rel(name),
    content: [
      skillFm(name, [trigger, '总入口 /taskq 兜底。', noScope].join('\n')),
      '',
      `# ${title}（薄包装，专属高频入口）`,
      '',
      exec,
      '',
      ver,
      '',
      ...body,
    ].join('\n'),
  });

  return [
    main,
    sub('taskq-new', 'taskq-new — 建任务', '仅在用户要新建任务（对话成规格）时触发。',
      '直接执行：execute_command("taskq new \'用户原话\'")——参数（--type/--group/--batch/--priority/--tags/--estimate/--role）由用户原话中提取，拿不准就只传原话交给 CLI 出草案。',
      ['`[TASKQ_SPEC_DRAFT]` → 按骨架写回 SPEC.md（frontmatter 三必填 goal/output/acceptance + 正文），写回后提醒用户 `taskq clarify --task <id>` 体检。',
       'draft 态任务 run 会拦截，补全 SPEC 才算定稿。']),
    sub('taskq-run', 'taskq-run — 接力执行', '仅在用户要跑队列/执行任务/继续接力时触发。',
      '直接执行：execute_command("taskq run")——定向用 --task <id> / --module <模块名> / --batch <批次|all>；批量领用 taskq execute --batch-size N。',
      ['`[TASKQ_PROMPT]` … `[TASKQ_PROMPT_END]` → **立即执行**：产出写到指定路径，完成后 `taskq done <id> --verdict "pass 理由"`，同一会话继续 `taskq run` 接力下一个。',
       '退出码 10 = 有任务领取（按上条执行）；退出码 12 = 拦截（draft/doing/failed），停下向用户说明原因；退出码 0 = 队列清空。',
       '执行中把进度写进任务目录 PROGRESS.md（每阶段一句），断点续跑时自动注入。']),
    sub('taskq-clarify', 'taskq-clarify — 体检', '仅在用户要体检/澄清/检查任务规格时触发。',
      '直接执行：execute_command("taskq clarify")——单任务 --task <id> / 全链 --chain / 指定文件 --file 路径。',
      ['报告三档：⛔ 阻塞先处理（补 / 给默认值 / 标记 draft / 无视四选一）→ ⚠️ 建议 → 待定。',
       '体检是随叫随到的：写完查 / 建链查 / 翻车查。']),
    sub('taskq-done', 'taskq-done — 验收登记', '仅在用户要验收任务/登记完成时触发。',
      '直接执行：execute_command("taskq done <id> --verdict \"pass 理由\"")。',
      ['验收三闸（机器核对，缺了不算完）：1. artifacts 产物门禁（文件在不在）2. checks 断言门禁（命令退出码非 0 不算完）3. review 评审门禁（结论要覆盖）。',
       '验收不过会提示第 N/3 次尝试，修正产出后重试 done。']),
  ];
}

/** 写全部 SKILL 文件（总入口 + 专属），返回生成的相对路径列表；无 skill 约定的工具（windsurf/trae/codex）跳过 */
function writeToolSkills(projectRoot: string, tool: string): string[] {
  if (!TOOL_SKILL_DIRS[tool]) return [];
  const files = renderSkillFiles(tool);
  for (const f of files) {
    const target = join(projectRoot, f.rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content + '\n', 'utf-8');
  }
  return files.map((f) => f.rel);
}

/** 该工具的 SKILL 文件是否已生成（update 模式的扫描依据，以总入口为准） */
function skillExists(projectRoot: string, tool: string): boolean {
  const rel = TOOL_SKILLS[tool];
  return !!rel && existsSync(join(projectRoot, rel));
}
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
    '`taskq status` `taskq list` `taskq clarify` `taskq report` `taskq new "描述"` `taskq reset <id|模块|批次|--all>`',
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
    '    batch-001/             ← 任务平铺（SPEC.md 三必填 + 正文自由）',
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
      const skillRels = targets.flatMap((t) => writeToolSkills(cfg.projectRoot, t));
      lines.push(
        '',
        `  🔄 已刷新 ${targets.length} 个宿主规则文件至 v${readVersion()}：`,
        ...rels.map((r) => `     ${r}`)
      );
      if (skillRels.length > 0) {
        lines.push(
          '',
          `  🔄 已刷新 ${skillRels.length} 个 SKILL 文件至 v${readVersion()}：`,
          ...skillRels.map((r) => `     ${r}`)
        );
      }
    }
    if (unknownTools.length > 0) {
      lines.push('', `  ⚠️ 暂不支持的工具：${unknownTools.join(', ')}（支持：${known.join('/')}）`);
    }
    return lines.join('\n');
  }

  // ── 常规模式：--tools 生成宿主 AI 接力规则 + SKILL（薄包装入口）──
  if (opts.tools && opts.tools.length > 0) {
    for (const tool of opts.tools) {
      if (!known.includes(tool)) {
        lines.push('', `  ⚠️ 暂不支持的工具：${tool}（支持：${known.join('/')}）`);
        continue;
      }
      const rel = writeToolRules(cfg.projectRoot, tool);
      const skillRels = writeToolSkills(cfg.projectRoot, tool);
      lines.push('', `  ✅ 已生成 ${tool} 的宿主接力规则：${rel}（重复执行 init 即刷新）`);
      if (skillRels.length > 0) {
        lines.push(`  ✅ 已生成 ${tool} 的 SKILL 入口 ${skillRels.length} 个（命令下拉可见 /taskq 及 /taskq-new /taskq-run /taskq-clarify /taskq-done；重复执行 init 即刷新）`);
      }
    }
  }
  return lines.join('\n');
}
