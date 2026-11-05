// 批次配置（BATCH.yaml）：每个批次自己的「脾气」——接力执行姿势的默认值
// 三级优先级链（每个配置项独立生效）：CLI 临时指令 > 批次配置 > 系统默认
// 例外：reports/overwrite 两项多一层任务级覆盖（SPEC.md 的 reports: false / overwrite: false 任务自己声明），四层 = CLI 临时 > 任务级 > 批次级 > 系统默认
// 兜底原则：文件缺失 / 内容损坏 / 字段异常，逐项回落系统默认，绝不炸队列
// 落盘位置：批次目录/config/BATCH.yaml（配置归 config/ 目录，与用户任务/模块内容分开；未来扩展别的配置都往这里放）
// 兼容：≤0.2.23 的旧落盘地（批次目录根 BATCH.yaml）读侧兜底；ensureBatchConfig 时自动迁移到 config/（内容复制校验一致后移除旧文件）
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { parseSimpleYaml } from './task-spec';

/** 批次配置项全集（字段名与 BATCH.yaml 键一致，kebab-case） */
export interface BatchConfig {
  'batch-size': number;    // 每批领取任务数（一次 taskq execute 领几个）
  'max-attempts': number;  // 任务失败重试上限（验收不通过累计达上限即标记 failed 停止接力）
  'skip-draft': boolean;   // 是否跳过 draft 拦停（true = 规格未澄清也照跑）
  reports: boolean;        // 是否生成评估报告（澄清 CLARIFY_REPORT + 完成 DONE_REPORT；任务级退出用 SPEC.md reports: false）
  overwrite: boolean;      // 澄清处方（taskq fix）是否覆盖写回用户原来的 SPEC.md（覆盖前原文件归档到任务目录 sources/；任务级拒绝用 SPEC.md overwrite: false）
  'plan-format': 'md' | 'html' | 'none'; // 计划落盘形态：md = 只落 .md 底稿；html = md + 同视觉 HTML 页（默认）；none = 只终端输出不落盘（一次性计划，不可被 --plans 引用）
}

/**
 * 系统默认值：BATCH.yaml 缺失/损坏/字段异常时的兜底（优先级链最底层）
 * 与 runner.ts 的 MAX_ATTEMPTS、batchRelay 的默认 3 保持同值——改这里就是改全系统默认
 */
export const SYSTEM_BATCH_DEFAULTS: BatchConfig = {
  'batch-size': 3,
  'max-attempts': 3,
  'skip-draft': false,
  reports: true,
  overwrite: true,
  'plan-format': 'html', // 默认 md + html 双生：底稿人读机读、HTML 双击即看
};

/**
 * BATCH.yaml 当前 schema 版本。
 * 升级维护约定：只加键、不改已有键的语义；读侧只认已知键，未知键忽略——
 * 旧文件缺新键自动取系统默认，新文件带旧 CLI 不认识的键也不炸，双向向前兼容，无需迁移脚本。
 */
export const BATCH_CONFIG_VERSION = 1;

/** 批次配置文件名 */
export const BATCH_CONFIG_FILE = 'BATCH.yaml';

/** 批次配置目录（批次目录内，与用户任务/模块内容分开；保留目录——队列扫描器跳过） */
export const BATCH_CONFIG_DIR = 'config';

/** 新位置：config/BATCH.yaml（v0.2.24+ 统一落盘地） */
function configPath(batchDir: string): string {
  return join(batchDir, BATCH_CONFIG_DIR, BATCH_CONFIG_FILE);
}

/** 旧位置：批次根 BATCH.yaml（≤0.2.23 落盘地，读侧兜底兼容） */
function legacyPath(batchDir: string): string {
  return join(batchDir, BATCH_CONFIG_FILE);
}

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
    reports: safeBool(raw['reports'], SYSTEM_BATCH_DEFAULTS['reports']),
    overwrite: safeBool(raw['overwrite'], SYSTEM_BATCH_DEFAULTS['overwrite']),
    'plan-format': safeEnum(raw['plan-format'], ['md', 'html', 'none'], SYSTEM_BATCH_DEFAULTS['plan-format']),
  };
}

/** 枚举兜底：值必须是白名单成员，否则回落默认（字段损坏不连坐，其余键照常生效） */
function safeEnum<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === 'string' && allowed.includes(v as T) ? (v as T) : fallback;
}

/**
 * 读批次配置：config/BATCH.yaml 优先，旧位置（批次根 BATCH.yaml）兜底——老批次无缝兼容。
 * 文件缺失 → 系统默认（无配置就是默认姿势，不告警——建批次时本就自动生成，缺了说明被手删，静默回落）；
 * 内容损坏 → 备份原文件 + stderr 告警，按系统默认继续（学 state.json 的处理：备份比覆盖诚实，配置可重写）。
 */
export function readBatchConfig(batchDir: string): BatchConfig {
  const path = configPath(batchDir);
  if (!existsSync(path)) {
    const legacy = legacyPath(batchDir);
    if (!existsSync(legacy)) return { ...SYSTEM_BATCH_DEFAULTS };
    return readOne(legacy);
  }
  return readOne(path);
}

/** 单文件读取 + 损坏兜底（备份 + 告警 + 回落默认） */
function readOne(path: string): BatchConfig {
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
    // 每层查两个位置：config/BATCH.yaml（新）+ BATCH.yaml（旧兼容）
    if (existsSync(join(cur, BATCH_CONFIG_DIR, BATCH_CONFIG_FILE)) || existsSync(join(cur, BATCH_CONFIG_FILE))) {
      return readBatchConfig(cur);
    }
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
    '# 系统默认：batch-size=3，max-attempts=3，skip-draft=false，reports=true，overwrite=true',
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
    '#',
    '# 是否生成评估报告（澄清 CLARIFY_REPORT + 完成 DONE_REPORT，落批次 overview/reports/）：',
    '# true = 默认生成；false = 本批次整体关闭。个别任务退出报告（探索性任务不想进报告），在任务 SPEC.md 写 reports: false。',
    '# 临时覆盖（仅当次生效）：taskq clarify --no-report 关闭一次 或  taskq execute --report 强制出一次',
    `reports: ${c['reports']}`,
    '#',
    '# 澄清处方（taskq fix）是否覆盖写回用户原来的 SPEC.md：',
    '# true = 默认覆盖，覆盖前把原文件归档到任务目录 sources/SPEC.md（可随时找回）；false = 只提示处方不落盘。',
    '# 临时覆盖（仅当次生效，不写回本文件）：taskq fix --no-overwrite 关闭一次 或  taskq fix --overwrite 强制覆盖',
    `overwrite: ${c['overwrite']}`,
    '#',
    '# 产出落位：默认住任务目录内 outputs/（产出与任务同住）；任务描述明确指定或改过 output 字段时按指定走。',
    '# 任务 SPEC.md 的 output 或描述里明确指定的路径永远优先，不受默认落位影响。',
    '# 计划落盘形态（taskq plan 的产出）：',
    '#   md = 只落 .md 底稿（默认）；html = md + 同院视觉 HTML 页（双击即看）；none = 只终端输出不落盘，',
    '#   none 的计划是一次性的，不可被 taskq run/execute --plans 引用（没有文件可读）。',
    '# 临时覆盖（仅当次生效）：taskq plan --format html',
    `plan-format: ${c['plan-format']}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * 建批次时落盘 config/BATCH.yaml，三态：
 *   config/ 已有 → 跳过（false，用户手改过的配置是最高优先级资产）；
 *   旧位置（批次根 BATCH.yaml）有 → 迁移：内容复制到 config/，校验一致后移除旧文件（true）；
 *   都没有 → 写默认模板（true）。
 */
export function ensureBatchConfig(batchDir: string): boolean {
  const path = configPath(batchDir);
  if (existsSync(path)) return false;
  const legacy = legacyPath(batchDir);
  if (existsSync(legacy)) {
    // 迁移旧落盘地（≤0.2.23）：内容原样搬入 config/，复制校验一致后才移除旧文件
    try {
      const content = readFileSync(legacy, 'utf-8');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf-8');
      if (readFileSync(path, 'utf-8') === content) {
        try {
          unlinkSync(legacy);
        } catch {
          // 移除失败无碍：读仍 config/ 优先，旧文件成冗余不产生副作用
        }
      }
      return true;
    } catch {
      return false; // 迁移失败：旧文件保留（读兜底仍生效），下轮再试
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderBatchConfig(), 'utf-8');
  return true;
}
