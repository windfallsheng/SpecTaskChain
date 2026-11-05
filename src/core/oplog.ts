// 操作轨迹账（op-log.json）：队列写操作的追加式时间线流水——成功与拦截都落账（拦截 note 带 ❌/⛔ 前缀）
// 与 state.json 分工：state 记当前态（任务「现在」是什么状态），op-log 记时间线（「何时」发生了什么）
// JSONL 每行一条：追加 O(1) 原子写，损坏行局部跳过不拖累全账
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskQConfig } from './config';

export interface OpLogEntry {
  ts: string;       // ISO 时间戳（UTC）
  cmd: string;      // 写命令：new / run / execute / done / reset
  target?: string;  // 作用对象：任务 ID / 任务数 / 复位目标
  batch?: string;   // 所属批次（batch-NNN；跨批次操作不记）
  note?: string;    // 备注：验收结论 / 实际工时 / 复位方式等
}

/** 追加一条轨迹（自动打时间戳；JSONL 单行原子 append） */
export function appendOpLog(cfg: TaskQConfig, entry: Omit<OpLogEntry, 'ts'>): void {
  const logPath = join(cfg.metaDir, 'op-log.json');
  mkdirSync(cfg.metaDir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(logPath, line + '\n', 'utf-8');
}

/** 读轨迹：全量 → batch / target / since 过滤 → 时间倒序 → limit 截断；文件缺失 / 损坏行容错 */
export function readOpLog(cfg: TaskQConfig, opts: { batch?: string; limit?: number; target?: string; since?: string } = {}): OpLogEntry[] {
  const logPath = join(cfg.metaDir, 'op-log.json');
  if (!existsSync(logPath)) return [];
  const out: OpLogEntry[] = [];
  try {
    for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as OpLogEntry;
        if (e.ts && e.cmd) out.push(e);
      } catch { /* 损坏行跳过 */ }
    }
  } catch {
    return [];
  }
  let filtered = opts.batch ? out.filter((e) => e.batch === opts.batch) : out;
  if (opts.target) filtered = filtered.filter((e) => e.target === opts.target); // 任务一生追踪：只看某任务的全部轨迹
  if (opts.since) filtered = filtered.filter((e) => e.ts.slice(0, 10) >= opts.since!); // 时间窗（UTC 日界，含当天）
  filtered.reverse(); // 时间线倒序：最新在上
  return opts.limit ? filtered.slice(0, opts.limit) : filtered;
}
