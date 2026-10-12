// taskq new：对话成规格（第一式）——落盘 draft 骨架 + 宿主 AI 接力生成完整草案
// 写规格三式：对话成规格 / 验收先行 / 渐进补全（draft 标记 = 渐进补全的通道）
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { renderSpec } from '../core/task-spec';
import { resolveTaskType, listBuiltinTypes } from '../core/task-type';

export interface NewOptions {
  name?: string;    // slug（可选，缺省用序号）
  type?: string;    // 任务类型
  draft?: boolean;  // 是否直接落盘 draft（跳过 AI 草案生成）
  group?: string;   // 任务模块（共享 spec 的院落）
  goal: string;     // 任务描述（用户原话）
}

/** slug 化：英文保留，中文转序号占位（宿主 AI 草案可建议更好的 slug） */
function slugify(name: string): string {
  const s = name.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]*$/.test(s)) return s;
  return `t${Date.now().toString(36).slice(-6)}`;
}

export function newCommand(cfg: TaskQConfig, opts: NewOptions): string {
  const tasksDir = join(cfg.queueDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  const { readdirSync, statSync, existsSync } = require('fs');
  const existing = readdirSync(tasksDir).filter((e: string) => statSync(join(tasksDir, e)).isDirectory());
  const typeDef = resolveTaskType(cfg.metaDir, opts.type || 'general');
  const seq = String(existing.length + 1).padStart(2, '0');
  const slug = opts.name ? slugify(opts.name) : `task-${seq}`;
  const id = `${seq}-${slug}`;

  if (opts.group) {
    // 任务模块：共享 spec 的院落——CONSTRAINTS.md + 第三层子任务
    const modDir = join(tasksDir, opts.group);
    mkdirSync(modDir, { recursive: true });
    const constraintsPath = join(modDir, 'CONSTRAINTS.md');
    if (!existsSync(constraintsPath)) {
      writeFileSync(constraintsPath, '# 模块公共约束\n\n> 共享 spec：本模块所有子任务执行前都会重读并遵守这里的约束。\n', 'utf-8');
    }
    const subId = String(readdirSync(modDir).filter((s: string) => statSync(join(modDir, s)).isDirectory()).length + 1).padStart(2, '0');
    const subDir = join(modDir, `${subId}-${slug}`);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'SPEC.md'),
      renderSpec({
        type: opts.type || 'general',
        goal: opts.goal,
        output: opts.draft ? typeDef.outputDir : '',
        acceptance: { artifacts: [], checks: [], review: '' },
        draft: true,
        body: opts.goal,
      }),
      'utf-8'
    );
    const lines = [
      `✅ 子任务已入模块「${opts.group}」（任务模块 = 共享 spec 的院落）`,
      '',
      `  子任务：${opts.group}/${subId}-${slug}`,
      `  公共约束：${constraintsPath}（每次执行子任务前重读）`,
      '',
    ];
    if (!opts.draft) {
      lines.push(`[TASKQ_SPEC_DRAFT] 宿主 AI 请生成规格草案并写回 SPEC.md（补全 output/acceptance 三态），完成后提醒用户 \`taskq clarify --task ${subId}-${slug}\` 确认。`);
      lines.push('规格三必填：goal / output / acceptance（产物门禁 + 断言门禁 + 评审门禁）。验收先行：怎么算做完，是必填第一公民。');
    }
    return lines.join('\n');
  }

  const taskDir = join(tasksDir, id);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, 'SPEC.md'),
    renderSpec({
      type: opts.type || 'general',
      goal: opts.goal,
      output: opts.draft ? typeDef.outputDir : '',
      acceptance: { artifacts: [], checks: [], review: '' },
      // 新任务恒定 draft 骨架起步：补全规格（clarify 通过）前，taskq run 拦截（--skip-draft 可强跑）
      draft: true,
      body: opts.goal,
    }),
    'utf-8'
  );
  const lines = [
    `✅ 任务「${id}」已入队（draft 态：等待规格补全，补全前 taskq run 会拦截）`,
    '',
    `  类型：${opts.type || 'general'}（${typeDef.code ? '代码任务' : '非代码任务'})`,
    `  可用类型：${listBuiltinTypes().join(' / ')}，自定义类型放 .taskchain/TASK_TYPES/{类型}.md`,
    '',
  ];
  if (!opts.draft) {
    lines.push('[TASKQ_SPEC_DRAFT] 宿主 AI 请根据任务描述生成规格草案并写回 SPEC.md：');
    lines.push('  1. output 填产出位置；2. acceptance 填验收三态（artifacts 产物门禁 / checks 断言门禁 / review 评审门禁）；3. 正文补充细节与边界（做什么、不做什么）。');
    lines.push(`  写回后提醒用户确认：\`taskq clarify --task ${id}\`（随叫随到的体检）。`);
  }
  return lines.join('\n');
}
