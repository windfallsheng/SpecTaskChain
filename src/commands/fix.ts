// taskq fix：体检处方的执行者——A 档机械修（output/acceptance 骨架/role 映射/摘 draft）
// 交互哲学：处理权在你。TTY 下逐项确认；非 TTY（宿主 AI/管道）只提示不等待——--yes 授权静默应用
// 覆盖开关四级链：CLI 临时（--no-overwrite/--overwrite）> 任务级（SPEC.md overwrite: false）> 批次级（config/BATCH.yaml overwrite）> 系统默认（true 覆盖）
// 批次级按任务所属批次逐一判定：定向修单任务用其批次配置；全队修各任务各自批次，互不牵连
// 覆盖前原文件归档到任务目录 sources/SPEC.md（用户原来的写法随时可找回）
import { readSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from '../core/config';
import { scanQueue } from '../core/queue';
import { resolveTaskType } from '../core/task-type';
import { locateBatchConfig } from '../core/batch-config';
import { computeFixes, applyFix, renderFixPreview, renderFixSummary, resolveFixSwitch } from '../core/fixer';

export interface FixOptions {
  taskId?: string;   // 只修单任务
  dryRun?: boolean;  // 预览不落盘
  yes?: boolean;     // 静默应用全部（非交互模式的授权开关）
  noOverwrite?: boolean;   // 覆盖开关（临时）：当次只提示不覆盖写回
  forceOverwrite?: boolean; // 覆盖开关（临时）：当次强制覆盖（压过批次配置 overwrite: false）
}

/** 同步睡眠（node 无内置 sync sleep；Atomics.wait 在浏览器主线程外可用） */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // 环境不支持 SharedArrayBuffer 时退化：放弃等待（交互体验略差但不阻断）
  }
}

/** 同步读一行 stdin（TTY 交互用；非 TTY 读不到输入返回空串）；clarify --decide 判断题通道共用
 * node 会把 TTY stdin 置为非阻塞：无待读数据时 readSync 抛 EAGAIN（不阻塞）——
 * 捕获后短暂让出重试，直到用户输入到达或读到 EOF，否则交互提示会闪退 */
export function readLineSync(prompt: string): string {
  process.stdout.write(prompt);
  const buf = Buffer.alloc(1);
  let line = '';
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
        sleepSync(20);
        continue;
      }
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

  // 覆盖开关：任务级（SPEC.md overwrite: false）先筛掉；批次级/CLI 临时按任务所属批次逐一判定
  const refused = targets.filter((t) => t.overwrite === false);
  const plans = targets
    .filter((t) => t.overwrite !== false)
    .map((t) => {
      return {
        task: t,
        specPath: join(t.dir, 'SPEC.md'),
        items: computeFixes(t, resolveTaskType(cfg.metaDir, t.type), cfg.projectRoot),
      };
    })
    .filter((p) => p.items.length);
  if (!plans.length) {
    const refusedNote = refused.length ? `\n（${refused.length} 个任务 SPEC.md 设了 overwrite: false，处方仅提示不落盘：${refused.map((t) => t.id).join('、')}）` : '';
    return `✅ 没有可自动修复的问题（依赖/语义/引用类仍需人工：改规格或补文件）。${refusedNote}\n\n可修复范围：补 output（非代码类型按输出目录推断）/ 补 acceptance 三态骨架 / 摘 draft（三必填齐）/ 补 role（类型映射）。`;
  }

  const flat = plans.flatMap((p) => p.items);
  const refusedNote = refused.length ? `\n\n⏸ ${refused.length} 个任务 SPEC.md 设了 overwrite: false，已跳过（仅预览）：${refused.map((t) => t.id).join('、')}` : '';
  const preview = renderFixPreview(flat);

  // 批次级/CLI 临时：按任务所属批次逐一判定（定向修用任务所在批次；全队修各任务各自批次，互不牵连）
  const blocked = plans.filter(
    (p) => !resolveFixSwitch(locateBatchConfig(p.task.dir, cfg.queueDir), opts).enabled,
  );
  const blockedSw = blocked.length
    ? resolveFixSwitch(locateBatchConfig(blocked[0].task.dir, cfg.queueDir), opts)
    : null;
  const blockedNote = blocked.length
    ? blocked.length === plans.length
      ? `\n\n⏸ 处方未应用：${blockedSw!.reason}`
      : `\n\n⏸ ${blocked.length} 个任务所在批次设了 overwrite: false，仅提示未落盘：${blocked.map((p) => p.task.id).join('、')}（临时覆盖一次：taskq fix --yes --overwrite）`
    : '';

  if (opts.dryRun) {
    return `${preview}\n\n--dry-run：预览不落盘。确认后：taskq fix --yes${blockedNote}${refusedNote}`;
  }

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (!opts.yes && !isTTY) {
    // 非交互且未授权：只提示不等待（宿主 AI 决策后再带 --yes 应用）
    return `${preview}\n\n应用：taskq fix --yes ｜ 预览：taskq fix --dry-run${blockedNote}${refusedNote}`;
  }

  if (opts.yes) {
    const applied: string[] = [];
    for (const p of plans) {
      if (blocked.includes(p)) continue; // 覆盖开关拦下：只提示不落盘
      applied.push(...applyFix(p.specPath, p.items));
    }
    if (!applied.length) return `${preview}\n\n未应用任何改动。${blockedNote}${refusedNote}`;
    return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify${blockedNote}${refusedNote}`;
  }

  // TTY 交互：全部 / 逐项 / 不改（处理权在你）；被覆盖开关拦下的任务不进询问
  const choice = readLineSync('\n应用吗？[y=全部应用 / n=逐项确认 / 回车=不改] ').toLowerCase();
  if (choice === '') {
    return `${preview}\n\n未应用（改主意随时：taskq fix --yes）${blockedNote}${refusedNote}`;
  }
  if (choice === 'y') {
    const applied: string[] = [];
    for (const p of plans) {
      if (blocked.includes(p)) continue;
      applied.push(...applyFix(p.specPath, p.items));
    }
    if (!applied.length) return `${preview}\n\n未应用任何改动。${blockedNote}${refusedNote}`;
    return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify${blockedNote}${refusedNote}`;
  }
  // 逐项确认（被拦下的任务跳过）
  const applied: string[] = [];
  for (const p of plans) {
    if (blocked.includes(p)) continue;
    for (const it of p.items) {
      const a = readLineSync(`\n[${it.taskId}] ${it.description}\n  现：${it.before}\n  改：${it.after}\n应用？[y/n，回车跳过] `).toLowerCase();
      if (a === 'y') applied.push(...applyFix(p.specPath, [it]));
    }
  }
  if (!applied.length) return '未应用任何改动。';
  return `${renderFixSummary(applied)}\n\n重新体检确认：taskq clarify${blockedNote}${refusedNote}`;
}
