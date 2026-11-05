// taskq new：对话成规格（第一式）——落盘 draft 骨架 + 宿主 AI 接力生成完整草案
// 写规格三式：对话成规格 / 验收先行 / 渐进补全（draft 标记 = 渐进补全的通道）
// 命名机制 = 「对话成规格」的前半步：用户指定（--name）优先（中文转全拼 + frontmatter name 显示名），
// AI 生成草案时顺手续上显示名；目录名 = ASCII slug（机器身份），显示名 = name 字段（人类可读）
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig, writeLastUsedBatch } from '../core/config';
import { appendOpLog } from '../core/oplog';
import { renderSpec, parseDue } from '../core/task-spec';
import { ensureBatchConfig } from '../core/batch-config';
import { resolveTaskType, listBuiltinTypes } from '../core/task-type';
import { toSlug, hasCJK } from '../core/task-naming';
import { scanQueue, resolveDefaultBatch, QueueScan } from '../core/queue';
import { resolveSpecTemplate, templateSourceLabel } from '../core/task-template';

export interface NewOptions {
  name?: string;    // 任务名（英文直接作 slug；中文转全拼作 slug + 原样作显示名）
  type?: string;    // 任务类型
  draft?: boolean;  // 是否直接落盘 draft（跳过 AI 草案生成）
  group?: string;   // 任务模块（共享 spec 的院落；同样走 slug 化）
  batch?: string;   // 目标批次（batch-NNN / tasks；缺省 = 最新批次）
  priority?: string; // 优先级（P0/P1/P2 或自由值）
  tags?: string[];   // 标签（自由关键词；跨批次按主题筛选）
  estimate?: number; // 预估工时（小时）
  due?: string;      // 截止日期（YYYY-MM-DD 或「明天/下周一」口语）
  role?: string;    // 执行角色（内置或 .taskchain/ROLES/{role}.md；type 管形态，role 管专业）
  dependsOn?: string[]; // 依赖的上游任务 ID（多个；手动模式一步声明，执行按拓扑序排在它们后面）
  goal: string;     // 任务描述（用户原话）
}

/** 显示名：中文名（slug 与原名不同）才需要——目录名已可读时不重复写 */
function displayName(raw: string, slug: string): string | undefined {
  if (hasCJK(raw)) return raw.trim();
  if (slug !== raw.trim().toLowerCase()) return raw.trim();
  return undefined;
}

/** 撞名区分短 hash：同 slug 不同内容 → 不同 hash（内容决定，幂等不漂移）；6 位足够目录内区分 */
function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 6);
}

export function newCommand(cfg: TaskQConfig, opts: NewOptions): string {
  // 任务灵魂是描述：无描述不建占位任务（对齐 split 无素材拦截手势）
  if (!opts.goal || !opts.goal.trim()) {
    return '用法：taskq new <任务描述> [--group 模块名] [--batch 批次] [--priority 高|中|低] [--due 今天|明天|YYYY-MM-DD]\n\n示例：\n  taskq new "写三篇迁移文档，产出到 docs/"\n  taskq new "整理会议纪要" --group module-weekly-report --due 明天\n\n任务描述是必填——先想清楚要做什么，再入队。';
  }
  // 命名仪式第二步（英译接力）：--name 未指定且 goal 是纯中文 → 先要英文 slug。
  // CLI 不直连 LLM（确定性红线）：输出 [TASKQ_PROMPT] 接力，宿主 AI 英译后带 --name 续跑；
  // 拿不出英文可降级 --name 传拼音或中文（中文自动转全拼）。--name 一旦存在即名字已定，不再打断（幂等）。
  // 拦在 scanQueue 之前：零痕迹（不建目录、不写批次配置），宿主 AI 续跑前队列不动。
  if (!opts.name && hasCJK(opts.goal) && !/[a-zA-Z0-9]/.test(opts.goal)) {
    return [
      '[TASKQ_PROMPT]',
      `任务「${opts.goal}」缺英文目录名——请英译后带 --name 续跑：`,
      '',
      `  taskq new "${opts.goal}" --name "english-slug"`,
      '',
      '没有合适的英文时降级传拼音（如 --name "anquanshencha"）或直接传中文名（CLI 自动转全拼）。',
      '[TASKQ_PROMPT_END]',
    ].join('\n');
  }
  // 批次定位：--batch 指定；缺省 = 最新批次（新任务落最新批次，插队先跑）；
  // 旧式 tasks 是只读兼容容器（第 0 批），不在默认落点内——新任务一律进 batch-NNN，无则建 batch-001
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  if (opts.batch && !queue.batches.some((b) => b.id === opts.batch)) {
    return `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、') || '无（首个批次将自动创建 batch-001）'}`;
  }
  const batchId = opts.batch || resolveDefaultBatch(cfg, queue.batches.filter((b) => b.id !== 'tasks')) || 'batch-001';
  const tasksDir = join(cfg.queueDir, batchId);
  mkdirSync(tasksDir, { recursive: true });
  ensureBatchConfig(tasksDir); // 批次「脾气」落盘（幂等：已存在不覆盖）——batch-size/max-attempts/skip-draft 三把默认姿势
  const { readdirSync, statSync, existsSync } = require('fs');
  const typeDef = resolveTaskType(cfg.metaDir, opts.type || 'general');
  // 命名仪式：--name 优先；无 --name 从 goal 提取语义 slug（「整理会议纪要」→ zhenglihuiyijiyao）；
  // goal 提不出语义时用任务类型键兜底（doc/script/data…，类型即任务形态）——绝不落 'task' 哑名
  const goalSlug = toSlug(opts.goal);
  const slug = opts.name ? toSlug(opts.name) : goalSlug === 'task' ? typeDef.name : goalSlug;
  // 普通任务同 task- 前缀（参考模块 module- 前缀的效果）：目录名 = task-{slug}，task- 打头一眼区分于模块目录；
  // 不带序号、不关注目录顺序（扫描只认结构不认编号）；--name 已带 task- 前缀则尊重原样；
  // 重名（队列中已有同 ID）拼内容短 hash 区分——同 slug 不同内容自动错开，state 键永不撞车
  const takenIds = new Set<string>();
  for (const t of queue.tasks) takenIds.add(t.id);
  for (const m of queue.modules) for (const s of m.subtasks) takenIds.add(s.id);
  const seed = opts.name || opts.goal;
  const baseId = slug.startsWith('task-') ? slug : `task-${slug}`;
  let id = baseId;
  if (takenIds.has(id)) {
    id = `${baseId}-${shortHash(seed)}`;
    if (takenIds.has(id)) {
      return `❌ 目录名「${baseId}」已存在且内容 hash 仍撞车（同名同内容重复建）。换一个 --name，或先处理现有任务目录。`;
    }
  }
  const shownName = opts.name ? displayName(opts.name, slug) : undefined;

  if (opts.group) {
    // 任务模块：共享 spec 的院落——CONSTRAINTS.md + 第三层子任务（模块名同样 slug 化）
    // 命名仪式：CLI 生成时模块目录带 module- 前缀（一眼区分于任务目录）；用户手工建的模块目录不受此约束（扫描只认结构）；已带前缀不叠加
    const groupSlug = toSlug(opts.group);
    const modName = groupSlug.startsWith('module-') ? groupSlug : `module-${groupSlug}`;
    const groupShown = displayName(opts.group, groupSlug);
    const modDir = join(tasksDir, modName);
    mkdirSync(modDir, { recursive: true });
    const constraintsPath = join(modDir, 'CONSTRAINTS.md');
    if (!existsSync(constraintsPath)) {
      writeFileSync(
        constraintsPath,
        `# 模块公共约束${groupShown ? `（${groupShown}）` : ''}\n\n> 共享 spec：本模块所有子任务执行前都会重读并遵守这里的约束。\n`,
        'utf-8'
      );
    }
    // 模块内子任务同样无序号：目录名 = {slug}；与队列中已有 ID（含顶层任务）撞名时拼内容短 hash——
    // ID 是 state.json 键，跨层撞车会共享状态，绝不能裸撞
    let subName = slug;
    if (takenIds.has(subName)) {
      subName = `${slug}-${shortHash(seed)}`;
      if (takenIds.has(subName)) {
        return `❌ 子任务目录「${modName}/${slug}」已存在且内容 hash 仍撞车。换一个 --name，或先处理现有子任务。`;
      }
    }
    const subDir = join(modDir, subName);
    if (existsSync(subDir)) {
      return `❌ 子任务目录「${modName}/${subName}」已存在（名称撞车）。换一个 --name，或先处理现有子任务目录。`;
    }
    mkdirSync(subDir, { recursive: true });
    // 正文 = 规格模板骨架（覆盖链：任务级 → 类型级 → 通用 → 系统内置）
    const subTpl = resolveSpecTemplate(cfg.metaDir, subDir, typeDef.name);
    writeFileSync(
      join(subDir, 'SPEC.md'),
      renderSpec({
        type: opts.type || 'general',
        name: shownName,
        goal: opts.goal,
        output: opts.draft ? typeDef.outputDir : '',
        acceptance: { artifacts: [], checks: [], review: '' },
        createdAt: new Date().toISOString().slice(0, 10),
        priority: opts.priority,
        tags: opts.tags,
        estimate: opts.estimate,
        due: opts.due ? parseDue(opts.due) || opts.due : undefined,
        role: opts.role,
        dependsOn: opts.dependsOn,
        draft: true,
        body: subTpl.content,
      }),
      'utf-8'
    );
    writeLastUsedBatch(cfg, batchId); // 最近使用批次记忆：落盘即认领
    appendOpLog(cfg, { cmd: 'new', target: subName, batch: batchId, note: `入模块 ${modName}` }); // 操作轨迹：建任务留痕
    const lines = [
      `✅ 子任务已入模块「${modName}」${groupShown ? `（${groupShown}）` : ''} → 批次 ${batchId}（任务模块 = 共享 spec 的院落）`,
      '',
      `  子任务：${modName}/${subName}${subName !== slug ? `（撞名拼短 hash 区分，state 键各归各）` : ''}`,
      `  公共约束：${constraintsPath}（每次执行子任务前重读）`,
      '',
    ];
    if (!opts.draft) {
      lines.push(`[TASKQ_SPEC_DRAFT] 宿主 AI 请生成规格草案并写回 SPEC.md（补全 output/acceptance 三态），完成后提醒用户 \`taskq clarify --task ${subName}\` 确认。`);
      lines.push('规格三必填：goal / output / acceptance（产物门禁 + 断言门禁 + 评审门禁）。验收先行：怎么算做完，是必填第一公民。');
      lines.push('命名要求：若 frontmatter 无 name 字段，补一个显示名（\`name: 用户迁移文档\`，可中文）；目录名已是 ASCII slug，不要改目录名。');
    }
    return lines.join('\n');
  }

  const taskDir = join(tasksDir, id);
  if (existsSync(taskDir)) {
    return `❌ 任务目录「${id}」已存在（名称撞车）。换一个 --name，或先处理现有任务目录。`;
  }
  mkdirSync(taskDir, { recursive: true });
  // 正文 = 规格模板骨架（覆盖链：任务级 → 类型级 → 通用 → 系统内置）
  const tpl = resolveSpecTemplate(cfg.metaDir, taskDir, typeDef.name);
  writeFileSync(
    join(taskDir, 'SPEC.md'),
    renderSpec({
      type: opts.type || 'general',
      name: shownName,
      goal: opts.goal,
      output: opts.draft ? typeDef.outputDir : '',
      acceptance: { artifacts: [], checks: [], review: '' },
      createdAt: new Date().toISOString().slice(0, 10),
      priority: opts.priority,
      tags: opts.tags,
      estimate: opts.estimate,
      due: opts.due ? parseDue(opts.due) || opts.due : undefined,
      role: opts.role,
      dependsOn: opts.dependsOn,
      // 新任务恒定 draft 骨架起步：补全规格（clarify 通过）前，taskq run 拦截（--skip-draft 可强跑）
      draft: true,
      body: tpl.content,
    }),
    'utf-8'
  );
  writeLastUsedBatch(cfg, batchId); // 最近使用批次记忆：落盘即认领
  appendOpLog(cfg, { cmd: 'new', target: id, batch: batchId, note: opts.goal.slice(0, 40) }); // 操作轨迹：建任务留痕
  const lines = [
    `✅ 任务「${id}」${shownName ? `（${shownName}）` : ''}已入队 → 批次 ${batchId}（draft 态：等待规格补全，补全前 taskq run 会拦截）`,
    ...(id !== baseId ? [`  撞名拼短 hash 区分：${baseId} → ${id}（重名不打架，state 键各归各）`] : []),
    '',
    `  类型：${opts.type || 'general'}（${typeDef.code ? '代码任务' : '非代码任务'})`,
    `  可用类型：${listBuiltinTypes().join(' / ')}，自定义类型放 .taskchain/TASK_TYPES/{类型}.md`,
    `  正文模板：${templateSourceLabel(tpl.source, typeDef.name)}（已按此骨架落盘；自定义放 .taskchain/TEMPLATES/{类型}.md 或通用 SPEC.md）`,
    '',
  ];
  if (!opts.draft) {
    lines.push('[TASKQ_SPEC_DRAFT] 宿主 AI 请根据任务描述生成规格草案并写回 SPEC.md：');
    lines.push('  1. output 填产出位置；2. acceptance 填验收三态（artifacts 产物门禁 / checks 断言门禁 / review 评审门禁）；3. 正文按已落盘的模板骨架补全细节与边界（做什么、不做什么，可增删小节）。');
    lines.push('  命名要求：若 frontmatter 无 name 字段，补一个显示名（\`name: 用户迁移 文档\`，可中文）；目录名已是 ASCII slug，不要改目录名。');
    lines.push(`  写回后提醒用户确认：\`taskq clarify --task ${id}\`（随叫随到的体检）。`);
  }
  return lines.join('\n');
}
