// 项目配置：定位队列目录与 .taskchain 元数据
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs';
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

/** 初始化队列骨架：queue/batch-001/ + .taskchain/ 三大自定义院落（TASK_TYPES/ROLES/TEMPLATES）+ state.json（幂等）
 * 批次目录 = 「一次要做的所有任务」的容器，下次要用再建下一个（batch-002、batch-003…）
 * 已存在旧式 tasks/ 的老项目不动它（扫描兼容为第 0 批） */
export function ensureStructure(cfg: TaskQConfig): void {
  mkdirSync(join(cfg.queueDir, 'batch-001'), { recursive: true });
  mkdirSync(join(cfg.metaDir, 'TASK_TYPES'), { recursive: true }); // 自定义任务类型（管形态）
  mkdirSync(join(cfg.metaDir, 'ROLES'), { recursive: true }); // 自定义执行角色（管专业，可带 applies-to 绑定）
  mkdirSync(join(cfg.metaDir, 'TEMPLATES'), { recursive: true }); // 规格正文模板（管骨架）
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
    // 账本损坏不静默：备份原文件 + stderr 告警，按空状态继续（重跑比丢账更诚实）
    try {
      copyFileSync(statePath, `${statePath}.bak`);
    } catch {
      // 备份失败不阻断
    }
    process.stderr.write(`⚠️ 状态文件损坏（${statePath}），已备份为 state.json.bak 并按空状态处理——已完成任务需重新接力\n`);
    return {};
  }
}

/** 写状态文件（原子落盘：临时文件 + rename 替换，写入中途崩溃不截断账本） */
export function writeState(cfg: TaskQConfig, tasks: Record<string, TaskRunState>): void {
  const statePath = join(cfg.metaDir, 'state.json');
  mkdirSync(cfg.metaDir, { recursive: true });
  const tmpPath = `${statePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ version: 1, tasks }, null, 2), 'utf-8');
  renameSync(tmpPath, statePath);
}

export interface TaskRunState {
  status: 'todo' | 'doing' | 'done' | 'failed' | 'draft';
  attempts: number;
  doneAt?: string;
  doingAt?: string; // doing 占位时间（超时视为孤儿任务，允许重拾）
  verdict?: string; // 验收结论（pass/fail/描述）
}
