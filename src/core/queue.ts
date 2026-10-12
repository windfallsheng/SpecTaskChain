// 队列扫描：队列是第一公民——一堆任务，无人值守接力完成
// 扫描两层：顶层任务（tasks/{id}/）+ 模块子任务（tasks/{module}/{sub}/，第三层天然不被误扫为独立任务）
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { TaskSpec, readSpec } from './task-spec';
import { resolveTaskType } from './task-type';

export interface ModuleInfo {
  id: string;               // 模块 ID
  constraintsPath: string;  // 公共约束文件（00-specs 的等价物：CONSTRAINTS.md）
  constraints: string;      // 约束内容（每次执行子任务前重读）
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
      const constraints = existsSync(constraintsPath)
        ? require('fs').readFileSync(constraintsPath, 'utf-8')
        : '';
      modules.push({ id: entry, constraintsPath, constraints, subtasks: subtaskSpecs });
    }
  }
  return { tasks, modules };
}

/**
 * 展开为执行序列：顶层任务 + 模块子任务（模块子任务挂模块约束）
 * 拓扑排序：只对声明 depends-on 的任务排序，其余按目录序平铺（多数任务无依赖）
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
  // 依赖拓扑：depends-on 声明的任务必须排在依赖之后（少数情况）
  const byId = new Map(flat.map((e) => [e.spec.id, e]));
  const sorted: ExecutableTask[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (e: ExecutableTask, chain: string[]): boolean => {
    if (visited.has(e.spec.id)) return true;
    if (visiting.has(e.spec.id)) return false; // 循环依赖
    visiting.add(e.spec.id);
    for (const depId of e.spec.dependsOn) {
      const dep = byId.get(depId);
      if (dep && !visit(dep, [...chain, e.spec.id])) return false;
    }
    visiting.delete(e.spec.id);
    visited.add(e.spec.id);
    sorted.push(e);
    return true;
  };
  for (const e of flat) {
    if (!visit(e, [])) {
      // 循环依赖：按原序平铺，不阻断执行
    }
  }
  // 无依赖任务按 seq 补入（保持目录序）
  for (const e of flat) {
    if (!sorted.includes(e)) sorted.push(e);
  }
  // 排序结果里无依赖任务保持目录序：按依赖深度分组，组内保持 seq
  sorted.sort((a, b) => {
    const depthOf = (e: ExecutableTask): number => {
      let d = 0;
      let cur: ExecutableTask | undefined = e;
      const seen = new Set<string>();
      while (cur && cur.spec.dependsOn.length && !seen.has(cur.spec.id)) {
        seen.add(cur.spec.id);
        d++;
        const nextId: string = cur.spec.dependsOn[0];
        cur = flat.find((x) => x.spec.id === nextId);
      }
      return d;
    };
    const da = depthOf(a);
    const db = depthOf(b);
    if (da !== db) return da - db;
    return a.seq - b.seq;
  });
  return sorted;
}

/** 找第一个未完成任务（接力推进：断点续跑的关键） */
export function findNextPending(
  sequence: ExecutableTask[],
  state: Record<string, { status: string }>
): ExecutableTask | null {
  return sequence.find((e) => {
    const s = state[e.spec.id];
    return !s || s.status === 'todo' || s.status === 'draft' || s.status === 'failed';
  }) || null;
}
