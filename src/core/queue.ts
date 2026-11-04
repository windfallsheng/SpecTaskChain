// 队列扫描：队列是第一公民——一堆任务，无人值守接力完成
// 扫描结构：批次目录（batch-{NN}/，一次要做的事；旧式 tasks/ 兼容过渡）→ 顶层任务（{id}/）+ 模块子任务（{module}/{sub}/）
import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskSpec, readSpec, parseFrontmatter } from './task-spec';
import { resolveTaskType } from './task-type';
import { TaskQConfig, readLastUsedBatch } from './config';

export interface ModuleInfo {
  id: string;               // 模块 ID
  constraintsPath: string;  // 公共约束文件（00-specs 的等价物：CONSTRAINTS.md）
  constraints: string;      // 约束内容（每次执行子任务前重读；已剥离 frontmatter 元数据）
  constraintsMissing: boolean; // CONSTRAINTS.md 缺失或为空——子任务执行会被阻塞，绝不静默裸奔
  name?: string;            // 显示名（CONSTRAINTS.md frontmatter name）
  purpose?: string;         // 模块意图（CONSTRAINTS.md frontmatter purpose）
  createdAt?: string;       // 创建日期（frontmatter created-at；缺失以目录出生时间兜底）
  subtasks: TaskSpec[];     // 第三层子任务
}

/** 批次/模块元数据（可选：不写照样跑——集市哲学，扫描只认结构） */
export interface BatchMeta {
  name?: string;      // 显示名（BATCH.md frontmatter name）
  purpose?: string;   // 批次意图（BATCH.md frontmatter purpose 或正文首行）
  createdAt?: string; // 创建日期（BATCH.md frontmatter created-at；缺失以目录出生时间兜底）
}

/** 批次：一次要做的任务集合（「下次要用，还会再创建」的最小单元） */
export interface BatchInfo extends BatchMeta {
  id: string;            // 批次 ID（batch-001 / 旧式 tasks）
  tasks: TaskSpec[];     // 批次内顶层任务
  modules: ModuleInfo[]; // 批次内任务模块
}

export interface QueueScan {
  tasks: TaskSpec[];      // 全批次合并：顶层平铺任务（兼容旧消费方）
  modules: ModuleInfo[];  // 全批次合并：任务模块（共享 spec 的院落）
  batches: BatchInfo[];   // 批次分组（每次要做的一件事）
}

/** 批次键：batch-NN 按数字排序（batch-10 排在 batch-9 后）；旧式 tasks 视为第 0 批（迁移前的过渡形态，兼容期继续工作） */
export function batchKey(id: string): number {
  if (id === 'tasks') return 0;
  const m = id.match(/^batch-(\d+)$/);
  if (m) return parseInt(m[1], 10);
  return -1;
}

/** 最新批次（batch-NN 数字序最大者；无 batch-* 时旧式 tasks 兜底） */
export function latestBatchId(batches: BatchInfo[]): string | null {
  if (!batches.length) return null;
  return [...batches].sort((a, b) => batchKey(a.id) - batchKey(b.id))[batches.length - 1].id;
}

/** 默认批次解析：最近使用批次（state.json lastUsedBatch，须批次仍存在）> 最新批次 */
export function resolveDefaultBatch(cfg: TaskQConfig, batches: BatchInfo[]): string | null {
  const lastUsed = readLastUsedBatch(cfg);
  if (lastUsed && batches.some((b) => b.id === lastUsed)) return lastUsed;
  return latestBatchId(batches);
}

/**
 * 批次视图：batchId 指定 → 只取该批次（不存在返回 null，由调用方报错）；
 * 缺省 → defaultBatch（调用方传最近使用批次）> 最新批次；'all' → 全批次平铺
 * 返回体 tasks/modules 只含选中批次；batches 保留全量批次目录（供展示）
 */
export function selectBatch(queue: QueueScan, batchId?: string, defaultBatch?: string | null): QueueScan | null {
  if (batchId && batchId !== 'all') {
    const b = queue.batches.find((x) => x.id === batchId);
    return b ? { tasks: b.tasks, modules: b.modules, batches: queue.batches } : null;
  }
  if (!batchId) {
    const latest = defaultBatch || latestBatchId(queue.batches);
    const b = queue.batches.find((x) => x.id === latest);
    return b ? { tasks: b.tasks, modules: b.modules, batches: queue.batches } : { tasks: [], modules: [], batches: [] };
  }
  return queue;
}

/** 判断目录是否是任务目录（含 SPEC.md）或模块目录（含子任务） */
function isTaskDir(dir: string): boolean {
  return existsSync(join(dir, 'SPEC.md'));
}

/** 目录出生时间（birthtime，git checkout/mv 不动）：元数据缺失时的创建时间兜底 */
function dirBirth(dir: string): string | undefined {
  try {
    const st = statSync(dir);
    return new Date(st.birthtimeMs || st.mtimeMs).toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

/** 读批次元数据（batch-NNN/BATCH.md，可选：不写照样跑——扫描只认结构） */
function readBatchMeta(areaDir: string): BatchMeta {
  const p = join(areaDir, 'BATCH.md');
  if (!existsSync(p)) return {};
  try {
    const { data, body } = parseFrontmatter(readFileSync(p, 'utf-8'));
    return {
      name: data.name ? String(data.name) : undefined,
      purpose: data.purpose ? String(data.purpose) : body.trim().slice(0, 80) || undefined,
      createdAt: data['created-at'] ? String(data['created-at']) : undefined,
    };
  } catch {
    return {};
  }
}

/** 扫描一个批次区域（batch-001/ 或旧式 tasks/）：顶层任务 + 模块聚合 */
function scanTaskArea(areaDir: string, metaDir: string): { tasks: TaskSpec[]; modules: ModuleInfo[] } {
  const tasks: TaskSpec[] = [];
  const modules: ModuleInfo[] = [];
  if (!existsSync(areaDir)) return { tasks, modules };
  const entries = readdirSync(areaDir).sort();
  for (const entry of entries) {
    const full = join(areaDir, entry);
    if (!statSync(full).isDirectory()) continue;
    // 保留目录跳过：隐藏目录（.taskchain 等）+ overview（报告落盘地）+ config（批次配置落盘地）——元信息不是模块
    if (entry.startsWith('.') || entry === 'overview' || entry === 'config') continue;
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
      const constraintsRaw = hasConstraints ? readFileSync(constraintsPath, 'utf-8') : '';
      // frontmatter 剥离：元数据（name/purpose/created-at）不注入 prompt，约束正文才是共享 spec
      const { data: cMeta, body: cBody } = parseFrontmatter(constraintsRaw);
      const constraints = (cBody || constraintsRaw).trim();
      // 共享 spec 缺失或为空 → 标记：执行子任务时阻塞（绝不静默裸奔）
      const constraintsMissing = !hasConstraints || !constraints;
      modules.push({
        id: entry,
        constraintsPath,
        constraints,
        constraintsMissing,
        name: cMeta.name ? String(cMeta.name) : undefined,
        purpose: cMeta.purpose ? String(cMeta.purpose) : undefined,
        createdAt: cMeta['created-at'] ? String(cMeta['created-at']) : dirBirth(full),
        subtasks: subtaskSpecs,
      });
    }
  }
  return { tasks, modules };
}

/** 扫描队列：所有批次（batch-{NN}）+ 旧式 tasks 兼容（迁移前继续工作） */
export function scanQueue(queueDir: string, metaDir: string): QueueScan {
  const batches: BatchInfo[] = [];
  if (!existsSync(queueDir)) return { tasks: [], modules: [], batches };
  const entries = readdirSync(queueDir).sort();
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(queueDir, entry);
    if (!statSync(full).isDirectory()) continue;
    // 批次目录：batch-{NN}；旧式 tasks 目录作为过渡批次继续识别
    if (entry !== 'tasks' && !/^batch-\d+$/.test(entry)) continue;
    const { tasks, modules } = scanTaskArea(full, metaDir);
    const meta = readBatchMeta(full);
    if (!meta.createdAt) meta.createdAt = dirBirth(full);
    batches.push({ id: entry, ...meta, tasks, modules });
  }
  return {
    tasks: batches.flatMap((b) => b.tasks),
    modules: batches.flatMap((b) => b.modules),
    batches,
  };
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

/** 定向筛选：--task 单任务 / --module 模块全部子任务；都不传返回原序列 */
export function filterExecutionSequence(sequence: ExecutableTask[], opts: { task?: string; module?: string }): ExecutableTask[] {
  if (opts.task) return sequence.filter((e) => e.spec.id === opts.task);
  if (opts.module) return sequence.filter((e) => e.module?.id === opts.module);
  return sequence;
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
