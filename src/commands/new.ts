// taskq new：对话成规格（第一式）——落盘 draft 骨架 + 宿主 AI 接力生成完整草案
// 写规格三式：对话成规格 / 验收先行 / 渐进补全（draft 标记 = 渐进补全的通道）
// 命名机制 = 「对话成规格」的前半步：用户指定（--name）优先（中文转全拼 + frontmatter name 显示名），
// AI 生成草案时顺手续上显示名；目录名 = ASCII slug（机器身份），显示名 = name 字段（人类可读）
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { renderSpec } from '../core/task-spec';
import { ensureBatchConfig } from '../core/batch-config';
import { resolveTaskType, listBuiltinTypes } from '../core/task-type';
import { toSlug, hasCJK } from '../core/task-naming';
import { scanQueue, latestBatchId, QueueScan } from '../core/queue';
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
  role?: string;    // 执行角色（内置或 .taskchain/ROLES/{role}.md；type 管形态，role 管专业）
  goal: string;     // 任务描述（用户原话）
}

/** 显示名：中文名（slug 与原名不同）才需要——目录名已可读时不重复写 */
function displayName(raw: string, slug: string): string | undefined {
  if (hasCJK(raw)) return raw.trim();
  if (slug !== raw.trim().toLowerCase()) return raw.trim();
  return undefined;
}

/** 下一序号：取现有目录编号最大值 +1（删除过中间任务也不会复用旧号覆盖） */
function nextSeq(nums: number[]): string {
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
}

/** 目录名取编号：'task-03-xiewendang' → 3；老格式 '03-xiewendang'/'03-task-xiewendang' 兼容；提不出（模块目录等）忽略 */
function dirNum(name: string): number {
  const m = name.match(/^(?:task-)?(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** 全局编号池：跨批次扫描目录名（目录存在即占号，含空目录与模块子目录）——任务 ID 全局唯一（state.json 键不撞）的前提 */
function allDirNums(cfg: TaskQConfig, queue: QueueScan): number[] {
  const { readdirSync, statSync } = require('fs');
  const nums: number[] = [];
  for (const b of queue.batches) {
    const area = join(cfg.queueDir, b.id);
    for (const e of readdirSync(area)) {
      const full = join(area, e);
      if (!statSync(full).isDirectory()) continue;
      nums.push(dirNum(e));
      // 模块目录：其子任务目录同样占号
      for (const s of readdirSync(full)) {
        if (statSync(join(full, s)).isDirectory()) nums.push(dirNum(s));
      }
    }
  }
  return nums.filter((n) => !isNaN(n));
}

export function newCommand(cfg: TaskQConfig, opts: NewOptions): string {
  // 批次定位：--batch 指定；缺省 = 最新批次（新任务落最新批次，插队先跑）；
  // 旧式 tasks 是只读兼容容器（第 0 批），不在默认落点内——新任务一律进 batch-NNN，无则建 batch-001
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  if (opts.batch && !queue.batches.some((b) => b.id === opts.batch)) {
    return `❌ 批次「${opts.batch}」不存在。现有批次：${queue.batches.map((b) => b.id).join('、') || '无（首个批次将自动创建 batch-001）'}`;
  }
  const batchId = opts.batch || latestBatchId(queue.batches.filter((b) => b.id !== 'tasks')) || 'batch-001';
  const tasksDir = join(cfg.queueDir, batchId);
  mkdirSync(tasksDir, { recursive: true });
  ensureBatchConfig(tasksDir); // 批次「脾气」落盘（幂等：已存在不覆盖）——batch-size/max-attempts/skip-draft 三把默认姿势
  const { readdirSync, statSync, existsSync } = require('fs');
  const typeDef = resolveTaskType(cfg.metaDir, opts.type || 'general');
  // 编号全局递增：跨所有批次（含模块子任务）取最大 +1——每批次从 01 重新编号会让 state 键撞车
  const seq = nextSeq(allDirNums(cfg, queue));
  // 命名仪式：--name 优先；无 --name 从 goal 提取语义 slug（「整理会议纪要」→ zhenglihuiyijiyao）；
  // goal 提不出语义时用任务类型键兜底（doc/script/data…，类型即任务形态）——绝不落 'task' 哑名
  const goalSlug = toSlug(opts.goal);
  const slug = opts.name ? toSlug(opts.name) : goalSlug === 'task' ? typeDef.name : goalSlug;
  // 普通任务同 task- 前缀（参考模块 module- 前缀的效果）：目录名 = task-{NN}-{slug}，
  // task- 打头一眼区分于模块目录；--name 已带 task- 前缀则尊重原样（不叠加不加序号）；
  // 序号紧跟 task- 之后，编号全局递增不变
  const id = slug.startsWith('task-') ? slug : `task-${seq}-${slug}`;
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
    // 模块内子任务同样用全局编号：与顶层任务分属不同调用，各自取最大 +1 不撞；跨层撞车由 clarify 体检拦截
    const subId = nextSeq(allDirNums(cfg, queue));
    const subDir = join(modDir, `${subId}-${slug}`);
    if (existsSync(subDir)) {
      return `❌ 子任务目录「${modName}/${subId}-${slug}」已存在（名称撞车）。换一个 --name，或先处理现有子任务目录。`;
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
        role: opts.role,
        draft: true,
        body: subTpl.content,
      }),
      'utf-8'
    );
    const lines = [
      `✅ 子任务已入模块「${modName}」${groupShown ? `（${groupShown}）` : ''} → 批次 ${batchId}（任务模块 = 共享 spec 的院落）`,
      '',
      `  子任务：${modName}/${subId}-${slug}`,
      `  公共约束：${constraintsPath}（每次执行子任务前重读）`,
      '',
    ];
    if (!opts.draft) {
      lines.push(`[TASKQ_SPEC_DRAFT] 宿主 AI 请生成规格草案并写回 SPEC.md（补全 output/acceptance 三态），完成后提醒用户 \`taskq clarify --task ${subId}-${slug}\` 确认。`);
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
      role: opts.role,
      // 新任务恒定 draft 骨架起步：补全规格（clarify 通过）前，taskq run 拦截（--skip-draft 可强跑）
      draft: true,
      body: tpl.content,
    }),
    'utf-8'
  );
  const lines = [
    `✅ 任务「${id}」${shownName ? `（${shownName}）` : ''}已入队 → 批次 ${batchId}（draft 态：等待规格补全，补全前 taskq run 会拦截）`,
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
