// 项目配置：定位队列目录与 .taskchain 元数据
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface TaskQConfig {
  projectRoot: string; // 项目根目录（产出/断言的基准，用户视角）
  queueDir: string;    // 队列根目录（默认 ./queue）
  metaDir: string;     // 元数据目录（队列内 .taskchain）
}

const DEFAULTS = { queueDir: 'queue' };

export function resolveConfig(cwd = process.cwd()): TaskQConfig {
  const queueDir = join(cwd, DEFAULTS.queueDir);
  return { projectRoot: cwd, queueDir, metaDir: join(queueDir, '.taskchain') };
}

/** 初始化队列骨架：queue/tasks/ + .taskchain/TASK_TYPES/ + state.json（幂等） */
export function ensureStructure(cfg: TaskQConfig): void {
  mkdirSync(join(cfg.queueDir, 'tasks'), { recursive: true });
  mkdirSync(join(cfg.metaDir, 'TASK_TYPES'), { recursive: true });
  const statePath = join(cfg.metaDir, 'state.json');
  if (!existsSync(statePath)) {
    writeFileSync(statePath, JSON.stringify({ version: 1, tasks: {} }, null, 2), 'utf-8');
  }
}

/** 读状态文件（缺失时给空状态） */
export function readState(cfg: TaskQConfig): Record<string, TaskRunState> {
  const statePath = join(cfg.metaDir, 'state.json');
  if (!existsSync(statePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
    return raw.tasks || {};
  } catch {
    return {};
  }
}

/** 写状态文件（幂等落盘） */
export function writeState(cfg: TaskQConfig, tasks: Record<string, TaskRunState>): void {
  writeFileSync(join(cfg.metaDir, 'state.json'), JSON.stringify({ version: 1, tasks }, null, 2), 'utf-8');
}

export interface TaskRunState {
  status: 'todo' | 'doing' | 'done' | 'failed' | 'draft';
  attempts: number;
  doneAt?: string;
  verdict?: string; // 验收结论（pass/fail/描述）
}
