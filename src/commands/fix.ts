// taskq fix：体检处方的执行者——A 档机械修（output/acceptance 骨架/role 映射/摘 draft）
// 交互哲学：处理权在你。TTY 下逐项确认；非 TTY（宿主 AI/管道）只提示不等待——--yes 授权静默应用
import { readSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { scanQueue } from '../core/queue';
import { resolveTaskType } from '../core/task-type';
import { computeFixes, applyFix, renderFixPreview, renderFixSummary } from '../core/fixer';

export interface FixOptions {
  taskId?: string;   // 只修单任务
  dryRun?: boolean;  // 预览不落盘
  yes?: boolean;     // 静默应用全部（非交互模式的授权开关）
}

/** 同步读一行 stdin（TTY 交互用；非 TTY 读不到输入返回空串） */
function readLineSync(prompt: string): string {
  process.stdout.write(prompt);
  const buf = Buffer.alloc(1);
  let line = '';
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      break;
    }
    if (n === 0) break;
    const ch = buf.toString('utf-8');
    if (ch === '\n' || ch === '\r') break;
    line += ch;
  }
  return line.trim();
}

export function fixCommand(cfg: TaskQConfig, opts: FixOptions): string {
  const queue = scanQueue(cfg.queueDir, cfg.metaDir);
  const all = [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
  const targets = opts.taskId ? all.filter((t) => t.id === opts.taskId) : all;
  if (opts.taskId && !targets.length) {
    return `❌ 未找到任务「${opts.taskId}」。可用：taskq list 查看队列清单。`;
  }

  const plans = targets
    .map((t) => ({ specPath: join(t.dir, 'SPEC.md'), items: computeFixes(t, resolveTaskType(cfg.metaDir, t.type)) }))
    .filter((p) => p.items.length);
  if (!plans.length) {
    return '✅ 没有可自动修复的问题（依赖/语义/引用类仍需人工：改规格或补文件）。\n\n可修复范围：补 output（非代码类型按输出目录推断）/ 补 acceptance 三态骨架 / 摘 draft（三必填齐）/ 补 role（类型映射）。';
  }

  const flat = plans.flatMap((p) => p.items);
  const preview = renderFixPreview(flat);

  if (opts.dryRun) {
    return `${preview}\n\n--dry-run：预览不落盘。确认后：taskq fix --yes`;
  }

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (!opts.yes && !isTTY) {
    // 非交互且未授权：只提示不等待（宿主 AI 决策后再带 --yes 应用）
    return `${preview}\n\n应用：taskq fix --yes ｜ 预览：taskq fix --dry-run`;
  }

  if (opts.yes) {
    const applied: string[] = [];
    for (const p of plans) applied.push(...applyFix(p.specPath, p.items));
    return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify`;
  }

  // TTY 交互：全部 / 逐项 / 不改（处理权在你）
  const choice = readLineSync('\n应用吗？[y=全部应用 / n=逐项确认 / 回车=不改] ').toLowerCase();
  if (choice === '') {
    return `${preview}\n\n未应用（改主意随时：taskq fix --yes）`;
  }
  if (choice === 'y') {
    const applied: string[] = [];
    for (const p of plans) applied.push(...applyFix(p.specPath, p.items));
    return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify`;
  }
  // 逐项确认
  const applied: string[] = [];
  for (const p of plans) {
    for (const it of p.items) {
      const a = readLineSync(`\n[${it.taskId}] ${it.description}\n  现：${it.before}\n  改：${it.after}\n应用？[y/n，回车跳过] `).toLowerCase();
      if (a === 'y') applied.push(...applyFix(p.specPath, [it]));
    }
  }
  if (!applied.length) return '未应用任何改动。';
  return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify`;
}
