// 批次配置（BATCH.yaml）：每个批次自己的「脾气」——接力执行姿势的默认值
// 三级优先级链（每个配置项独立生效）：CLI 临时指令 > 批次配置 > 系统默认
// 兜底原则：文件缺失 / 内容损坏 / 字段异常，逐项回落系统默认，绝不炸队列
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { parseSimpleYaml } from './task-spec';

/** 批次配置项全集（字段名与 BATCH.yaml 键一致，kebab-case） */
export interface BatchConfig {
  'batch-size': number;    // 每批领取任务数（一次 taskq execute 领几个）
  'max-attempts': number;  // 任务失败重试上限（验收不通过累计达上限即标记 failed 停止接力）
  'skip-draft': boolean;   // 是否跳过 draft 拦停（true = 规格未澄清也照跑）
}

/**
 * 系统默认值：BATCH.yaml 缺失/损坏/字段异常时的兜底（优先级链最底层）
 * 与 runner.ts 的 MAX_ATTEMPTS、batchRelay 的默认 3 保持同值——改这里就是改全系统默认
 */
export const SYSTEM_BATCH_DEFAULTS: BatchConfig = {
  'batch-size': 3,
  'max-attempts': 3,
  'skip-draft': false,
};

/**
 * BATCH.yaml 当前 schema 版本。
 * 升级维护约定：只加键、不改已有键的语义；读侧只认已知键，未知键忽略——
 * 旧文件缺新键自动取系统默认，新文件带旧 CLI 不认识的键也不炸，双向向前兼容，无需迁移脚本。
 */
export const BATCH_CONFIG_VERSION = 1;

/** 批次配置文件名（批次目录根下，与 BATCH.md 描述文件并列） */
export const BATCH_CONFIG_FILE = 'BATCH.yaml';

/** 数字字段兜底：有限数且 ≥1 才认（0/负数/非数 → 系统默认） */
function safePositive(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n); // 小数取整，批次数不认半个
}

/** 布尔字段兜底：'true'/'false' 字符串或真布尔才认，其余 → 系统默认 */
function safeBool(v: unknown, fallback: boolean): boolean {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return fallback;
}

/**
 * 解析 BATCH.yaml 文本 → 配置。
 * 字段级兜底：单字段类型错/越界只回落该字段，其余字段照常生效——
 * 用户手改了一半的配置也要尽量尊重（「batch-size: 5」配「skip-draft: 随便写的」时前者仍生效）。
 */
export function parseBatchConfig(text: string): BatchConfig {
  const raw = parseSimpleYaml(text);
  return {
    'batch-size': safePositive(raw['batch-size'], SYSTEM_BATCH_DEFAULTS['batch-size']),
    'max-attempts': safePositive(raw['max-attempts'], SYSTEM_BATCH_DEFAULTS['max-attempts']),
    'skip-draft': safeBool(raw['skip-draft'], SYSTEM_BATCH_DEFAULTS['skip-draft']),
  };
}

/**
 * 读批次目录下的 BATCH.yaml。
 * 文件缺失 → 系统默认（无配置就是默认姿势，不告警——建批次时本就自动生成，缺了说明被手删，静默回落）；
 * 内容损坏 → 备份原文件 + stderr 告警，按系统默认继续（学 state.json 的处理：备份比覆盖诚实，配置可重写）。
 */
export function readBatchConfig(batchDir: string): BatchConfig {
  const path = join(batchDir, BATCH_CONFIG_FILE);
  if (!existsSync(path)) return { ...SYSTEM_BATCH_DEFAULTS };
  try {
    return parseBatchConfig(readFileSync(path, 'utf-8'));
  } catch {
    try {
      copyFileSync(path, `${path}.bak`);
    } catch {
      // 备份失败不阻断
    }
    process.stderr.write(`⚠️ 批次配置损坏（${path}），已备份为 BATCH.yaml.bak 并按系统默认处理——修复或删除后自动重新生效\n`);
    return { ...SYSTEM_BATCH_DEFAULTS };
  }
}

/**
 * 从任意任务目录向上爬升找所属批次的配置（done 等按任务入口的命令用）。
 * 任务目录必在队列目录内（queue/batch-NNN/…），爬到队列根仍无 BATCH.yaml 即回落系统默认。
 */
export function locateBatchConfig(startDir: string, queueDir: string): BatchConfig {
  let cur = startDir;
  while (cur === queueDir || cur.startsWith(queueDir + '/')) {
    if (existsSync(join(cur, BATCH_CONFIG_FILE))) return readBatchConfig(cur);
    if (cur === queueDir) break;
    cur = dirname(cur);
  }
  return { ...SYSTEM_BATCH_DEFAULTS };
}

/**
 * 生成 BATCH.yaml 模板（注释详尽：每条配置讲清语义、默认值、临时覆盖命令）。
 * overrides 供建批次时按 CLI 参数定制首版（如 --batch-size 5 建批次时写入），不传即全默认。
 */
export function renderBatchConfig(overrides: Partial<BatchConfig> = {}): string {
  const c: BatchConfig = { ...SYSTEM_BATCH_DEFAULTS, ...overrides };
  const lines = [
    '# BATCH.yaml —— 本批次队列的「脾气」：接力执行的默认姿势',
    '# 优先级链（每项独立生效）：CLI 临时指令 > 本文件 > 系统默认',
    '# 系统默认：batch-size=3，max-attempts=3，skip-draft=false',
    '#',
    '# 升级维护：version 记录 schema 版本；升级只加键不改语义，本文件缺失的键自动取系统默认，',
    '# 无需迁移脚本——想用新默认值直接删掉对应行即可。',
    `version: ${BATCH_CONFIG_VERSION}`,
    '#',
    '# 每批领取的任务数：一次 taskq execute 领几个任务。',
    '# 队列稳定、任务独立性强可调大（少轮次）；任务易互相踩可调小（小步快跑）。',
    '# 临时覆盖（仅当次生效，不写回本文件）：taskq execute --batch-size 2  或  taskq ask "一次领 5 个"',
    `batch-size: ${c['batch-size']}`,
    '#',
    '# 任务失败重试上限：验收不通过（taskq done --verdict 非 pass）累计达上限即标记 failed 停止接力。',
    '# 重任务/易返工（写作、设计类）可调大；快失败洁癖型队列可调小（1 = 一次不过就停）。',
    '# 失败后人工介入：修好产出重试 taskq done；整单重跑用 taskq reset。',
    `max-attempts: ${c['max-attempts']}`,
    '#',
    '# 是否跳过 draft 拦停：true = 规格标记 draft（未澄清）也照常执行。',
    '# 默认 false（先 clarify 澄清再跑）；本批次都是探索型任务可设 true 先跑起来。',
    '# 临时覆盖（仅当次生效）：taskq execute --skip-draft',
    `skip-draft: ${c['skip-draft']}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * 建批次时落盘 BATCH.yaml（幂等：已存在绝不覆盖——用户手改过的配置是最高优先级资产）。
 * 返回是否实际写入（false = 已存在跳过，true = 新生成）。
 */
export function ensureBatchConfig(batchDir: string): boolean {
  const path = join(batchDir, BATCH_CONFIG_FILE);
  if (existsSync(path)) return false;
  writeFileSync(path, renderBatchConfig(), 'utf-8');
  return true;
}
