// 队列扫描：队列是第一公民——一堆任务，无人值守接力完成
// 扫描两层：顶层任务（tasks/{id}/）+ 模块子任务（tasks/{module}/{sub}/，第三层天然不被误扫为独立任务）
import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskSpec, readSpec } from './task-spec';
import { resolveTaskType } from './task-type';

export interface ModuleInfo {
  id: string;               // 模块 ID
  constraintsPath: string;  // 公共约束文件（00-specs 的等价物：CONSTRAINTS.md）
  constraints: string;      // 约束内容（每次执行子任务前重读）
  constraintsMissing: boolean; // CONSTRAINTS.md 缺失或为空——子任务执行会被阻塞，绝不静默裸奔
  subtasks: TaskSpec[];     // 第三层子任务
}

export interface QueueScan {
  tasks: TaskSpec[];      // 顶层平铺任务
  modules: ModuleInfo[];  // 任务模块（共享 spec 的院落）
}

/** 判断目录是否是任务目录（含 SPEC.md）或模块目录（含子任务） */
function isTaskDir(dir: string): boolean {
  return existsSync(join(dir, 'SPEC.md'));
}

/** 扫描队列：任务平铺 + 模块聚合（共享 spec 时保留任务模块概念） */
export function scanQueue(queueDir: string, metaDir: string): QueueScan {
  const tasksDir = join(queueDir, 'tasks');
  if (!existsSync(tasksDir)) return { tasks: [], modules: [] };
  const tasks: TaskSpec[] = [];
  const modules: ModuleInfo[] = [];
  const entries = readdirSync(tasksDir).sort();
  for (const entry of entries) {
    const full = join(tasksDir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (isTaskDir(full)) {
      const spec = readSpec(full, 'general');
      if (spec) tasks.push(spec);
    } else {
      // 模块目录：含 CONSTRAINTS.md + 第三层子任务
      const constraintsPath = join(full, 'CONSTRAINTS.md');
      const subtaskSpecs: TaskSpec[] = [];
      const subs = readdirSync(full).filter((s) => statSync(join(full, s)).isDirectory()).sort();
      for (const sub of subs) {
        if (sub.startsWith('.')) continue;
        const subFull = join(full, sub);
        const spec = readSpec(subFull, resolveTaskType(metaDir, 'general').name);
        if (spec) subtaskSpecs.push(spec);
      }
      const hasConstraints = existsSync(constraintsPath);
      const constraints = hasConstraints ? readFileSync(constraintsPath, 'utf-8') : '';
      // 共享 spec 缺失或为空 → 标记：执行子任务时阻塞（绝不静默裸奔）
      const constraintsMissing = !hasConstraints || !constraints.trim();
      modules.push({ id: entry, constraintsPath, constraints, constraintsMissing, subtasks: subtaskSpecs });
    }
  }
  return { tasks, modules };
}

/**
 * 展开为执行序列：顶层任务 + 模块子任务（模块子任务挂模块约束）
 * 拓扑排序（Kahn）：只对声明 depends-on 的任务排序，其余按目录序平铺（多数任务无依赖）
 * 循环依赖不阻断执行：环成员按原目录序稳定附加，非环成员保证依赖在前
 */
export interface ExecutableTask {
  spec: TaskSpec;
  module?: ModuleInfo; // 属于模块时挂模块信息（共享 spec）
  seq: number;         // 全局顺序
}

export function buildExecutionSequence(queue: QueueScan): ExecutableTask[] {
  const flat: ExecutableTask[] = [];
  let seq = 0;
  for (const t of queue.tasks) flat.push({ spec: t, seq: seq++ });
  for (const m of queue.modules) {
    for (const sub of m.subtasks) flat.push({ spec: sub, module: m, seq: seq++ });
  }
  const byId = new Map(flat.map((e) => [e.spec.id, e]));
  // 有效依赖边：只保留指向队列内任务的声明（悬空依赖由 clarify 报阻塞，这里忽略）
  const edges = new Map<ExecutableTask, ExecutableTask[]>();
  const indeg = new Map<ExecutableTask, number>();
  for (const e of flat) {
    const deps = e.spec.dependsOn.map((d) => byId.get(d)).filter((d): d is ExecutableTask => !!d);
    edges.set(e, deps);
    indeg.set(e, deps.length);
  }
  // Kahn 拓扑：入度 0 的按 seq 序出队，消解依赖边；环成员入度消不掉，按原 seq 稳定附加
  const ready: ExecutableTask[] = flat.filter((e) => (indeg.get(e) || 0) === 0);
  ready.sort((a, b) => a.seq - b.seq);
  const indegLeft = new Map(indeg);
  const sorted: ExecutableTask[] = [];
  while (ready.length) {
    const e = ready.shift()!;
    sorted.push(e);
    for (const dep of edges.get(e)!) {
      const d = (indegLeft.get(dep) || 0) - 1;
      indegLeft.set(dep, d);
      if (d === 0) {
        ready.push(dep);
        ready.sort((a, b) => a.seq - b.seq);
      }
    }
  }
  if (sorted.length < flat.length) {
    // 循环依赖：环成员不参与依赖排序，按原目录序平铺（不阻断执行）
    const rest = flat.filter((e) => !sorted.includes(e)).sort((a, b) => a.seq - b.seq);
    sorted.push(...rest);
  }
  return sorted;
}

/** doing 占位超过该时长视为孤儿任务（执行者已中断），允许重拾 */
export const DOING_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** 找第一个未完成任务（接力推进：断点续跑的关键） */
export function findNextPending(
  sequence: ExecutableTask[],
  state: Record<string, { status: string; doingAt?: string }>
): ExecutableTask | null {
  return sequence.find((e) => {
    const s = state[e.spec.id];
    if (!s) return true;
    if (s.status === 'todo' || s.status === 'draft' || s.status === 'failed') return true;
    if (s.status === 'doing') {
      // 孤儿 doing：领取超时视为执行者已中断，重拾；未超时视为有活跃执行者，跳过
      const at = s.doingAt ? new Date(s.doingAt).getTime() : 0;
      return Date.now() - at > DOING_TIMEOUT_MS;
    }
    return false;
  }) || null;
}
