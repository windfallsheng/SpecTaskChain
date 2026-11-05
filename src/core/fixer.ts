// taskq fix：体检处方的执行者——只修 A 档机械项（改完必对），语义题一律不碰
// 四条底线：只动 frontmatter 已知字段 / 正文一字不碰 / 改前归档原文件到任务目录 sources/ / 幂等（已满足不重复改）
// 覆盖开关四级链（每任务独立判定）：CLI 临时（--no-overwrite/--overwrite）> 任务级（SPEC.md overwrite: false）> 批次级（config/BATCH.yaml overwrite）> 系统默认（true 覆盖）
// 修法规则（与 clarify 检测项严格对应）：
//   output     → 按类型输出目录推断 {outputDir}{slug}.md（仅非代码类型；data 类型不猜扩展名）
//   acceptance → 三态骨架（产物=output + 断言留空待填 + 评审待人工），依赖 output 有效
//   draft      → 三必填齐（含本次修复后）摘除 draft: true
//   role       → 按类型映射内置角色（generalist 兜底不写——保留 AI 按内容自动选择的空间）
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { TaskSpec } from './task-spec';
import type { TaskTypeDefinition } from './task-type';
import { defaultRoleForType } from './task-role';
import { slugFromDir } from './task-naming';

/** 修复项：kind 决定行级编辑方式，after 是完整的前端块/行（预览与落盘共用） */
export interface FixItem {
  taskId: string;
  kind: 'output' | 'acceptance' | 'draft' | 'role';
  description: string; // 一句话人话（预览/确认用）
  before: string;      // 现状态（预览）
  after: string;       // 将写入的内容（行级编辑按 kind 应用）
}

/** 按类型推断产出路径：{outputDir}{slug}.md；代码类型/data 不猜（扩展名不可断定） */
export function inferOutputPath(spec: TaskSpec, typeDef: TaskTypeDefinition): string {
  if (typeDef.code || typeDef.name === 'data') return '';
  const slug = slugFromDir(spec.id) || spec.id;
  return `${typeDef.outputDir}${slug}.md`;
}

/** 计算单任务的 A 档修复项（纯函数，不落盘） */
export function computeFixes(spec: TaskSpec, typeDef: TaskTypeDefinition): FixItem[] {
  const items: FixItem[] = [];

  // role：类型映射专职角色；generalist 是通才兜底，不写（保留 AI 自动选择）
  if (!spec.role || !spec.role.trim()) {
    const suggestion = defaultRoleForType(spec.type);
    if (suggestion !== 'generalist') {
      items.push({
        taskId: spec.id,
        kind: 'role',
        description: `补 role: ${suggestion}（按类型 ${spec.type} 自动匹配）`,
        before: 'role: （未指定）',
        after: `role: ${suggestion}`,
      });
    }
  }

  // output：空 → 按类型推断；推断不出（代码/数据类型）留给宿主 AI
  let effectiveOutput = (spec.output || '').trim();
  if (!effectiveOutput) {
    const inferred = inferOutputPath(spec, typeDef);
    if (inferred) {
      effectiveOutput = inferred;
      items.push({
        taskId: spec.id,
        kind: 'output',
        description: `补 output: ${inferred}（按类型 ${typeDef.name} 输出目录推断）`,
        before: 'output: （空）',
        after: `output: ${inferred}`,
      });
    }
  }

  // acceptance：三态骨架（依赖 output 有效——产物门禁必须有落点）
  const acc = spec.acceptance || { artifacts: [], checks: [], review: '' };
  const accEmpty = !(acc.artifacts || []).length && !(acc.checks || []).length && !(acc.review || '').trim();
  if (accEmpty && effectiveOutput) {
    items.push({
      taskId: spec.id,
      kind: 'acceptance',
      description: `补 acceptance 三态骨架（产物=${effectiveOutput}；断言待填，评审待人工）`,
      before: 'acceptance: （空）',
      after: `acceptance:\n  artifacts:\n    - path: ${effectiveOutput}\n  checks: []\n  review: 待人工评审`,
    });
  }

  // draft：三必填齐（含本次修复后）→ 摘除
  if (spec.draft && (spec.goal || '').trim() && effectiveOutput) {
    items.push({
      taskId: spec.id,
      kind: 'draft',
      description: '摘除 draft（三必填已齐，可以接力）',
      before: 'draft: true',
      after: '（删除 draft: true 行）',
    });
  }

  return items;
}

// ============================================================
// 行级编辑（只动 frontmatter 已知字段；正文一字不碰）
// ============================================================

/** 定位 frontmatter 内容行范围 [start, end)：首行 --- 到闭合 --- 之间 */
function frontmatterRange(lines: string[]): { start: number; end: number } | null {
  if (!lines.length || lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return end > 0 ? { start: 1, end } : null;
}

/** 顶层键行检测：行首无缩进且形如 key:（用于 acceptance 块边界） */
function isTopKey(line: string): boolean {
  return /^[a-z][a-z0-9-]*:/.test(line);
}

function applyLineEdit(text: string, item: FixItem): { text: string; changed: boolean } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const range = frontmatterRange(lines);
  if (!range) return { text, changed: false }; // 无 frontmatter 或形状异常：不碰

  if (item.kind === 'output') {
    const idx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^output:/.test(l));
    if (idx < 0) return { text, changed: false };
    if (lines[idx].replace(/^output:\s*/, '').trim()) return { text, changed: false }; // 已非空：幂等
    lines[idx] = item.after;
    return { text: lines.join('\n'), changed: true };
  }

  if (item.kind === 'role') {
    const idx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^role:/.test(l));
    if (idx >= 0) {
      if (lines[idx].replace(/^role:\s*/, '').trim()) return { text, changed: false }; // 已指定：幂等
      lines[idx] = item.after;
      return { text: lines.join('\n'), changed: true };
    }
    // 无 role 行：插到 goal 行后（goal 三必填之一必在）
    const goalIdx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^goal:/.test(l));
    if (goalIdx < 0) return { text, changed: false };
    lines.splice(goalIdx + 1, 0, item.after);
    return { text: lines.join('\n'), changed: true };
  }

  if (item.kind === 'draft') {
    const idx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^draft:\s*true\s*$/.test(l));
    if (idx < 0) return { text, changed: false }; // 已摘除：幂等
    lines.splice(idx, 1);
    return { text: lines.join('\n'), changed: true };
  }

  // acceptance：替换 acceptance 块（acceptance 行到下一个顶层键 / frontmatter 结束）
  {
    const idx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^acceptance:/.test(l));
    if (idx < 0) {
      // 无 acceptance 行：插到 frontmatter 末尾（--- 前）
      lines.splice(range.end, 0, item.after);
      return { text: lines.join('\n'), changed: true };
    }
    let blockEnd = range.end;
    for (let i = idx + 1; i < range.end; i++) {
      if (isTopKey(lines[i])) {
        blockEnd = i;
        break;
      }
    }
    // 幂等：块内已有产物/断言/评审任一非空 → 不重复写
    const block = lines.slice(idx + 1, blockEnd);
    const hasArtifact = block.some((l) => /^\s+- path:/.test(l));
    const hasCheck = block.some((l) => /^\s+-\s+\S/.test(l) && !/path:/.test(l));
    const reviewLine = block.find((l) => /^\s+review:/.test(l));
    const rawReview = reviewLine ? reviewLine.replace(/^\s+review:\s*/, '').trim() : '';
    // 空串/空引号（YAML 空值的文本形态）不算已有评审——draft 起步骨架的 review: '' 必须可被替换
    const hasReview = rawReview !== '' && rawReview !== "''" && rawReview !== '""';
    if (hasArtifact || hasCheck || hasReview) return { text, changed: false };
    lines.splice(idx, blockEnd - idx, item.after);
    return { text: lines.join('\n'), changed: true };
  }
}

/** 应用修复落盘：有改动时先归档原文件到 sources/ → 逐项行级编辑 → 写回（返回实际应用的描述列表） */
export function applyFix(specPath: string, items: FixItem[]): string[] {
  if (!items.length || !existsSync(specPath)) return [];
  const original = readFileSync(specPath, 'utf-8');
  let text = original;
  const applied: string[] = [];
  for (const item of items) {
    const r = applyLineEdit(text, item);
    if (r.changed) {
      text = r.text;
      applied.push(item.description);
    }
  }
  if (!applied.length) return []; // 幂等：无改动不落盘也不刷新归档（sources/ 保持首次覆盖前的原版）
  // 归档：覆盖前把用户原写的 SPEC.md 存进任务目录 sources/（目录自动创建；覆盖旧归档，永远是最近一次被覆盖前的原版）
  try {
    const archiveDir = join(dirname(specPath), 'sources');
    mkdirSync(archiveDir, { recursive: true });
    copyFileSync(specPath, join(archiveDir, 'SPEC.md'));
  } catch {
    // 归档失败不阻断修复（sources/ 是用户可见的存档，不是主流程）
  }
  // 澄清留痕：写回前追加 fix-log（正文不碰）——无人值守下用户可追溯 CLI 动了什么
  text = appendFixLog(text, applied);
  writeFileSync(specPath, text, 'utf-8');
  return applied;
}

/** 澄清留痕：fix 机械修写回前在 frontmatter 追加 fix-log 条目（累积日志，正文不碰） */
function appendFixLog(text: string, applied: string[]): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const range = frontmatterRange(lines);
  if (!range) return text; // 无 frontmatter 或形状异常：不留痕也不阻断主流程
  const entry = `  - "${new Date().toISOString().slice(0, 10)}: ${applied.join('；')}"`;
  const idx = lines.findIndex((l, i) => i >= range.start && i < range.end && /^fix-log:/.test(l));
  if (idx < 0) {
    // 无 fix-log：frontmatter 末尾（闭合 --- 前）插入键 + 首条
    lines.splice(range.end, 0, 'fix-log:', entry);
  } else {
    // 已有 fix-log：块内追加（块边界 = 下一个顶层键）
    let ins = range.end;
    for (let i = idx + 1; i < range.end; i++) {
      if (isTopKey(lines[i])) {
        ins = i;
        break;
      }
    }
    lines.splice(ins, 0, entry);
  }
  return lines.join('\n');
}

// ============================================================
// 覆盖开关判定（纯函数，便于测试）
// ============================================================

/**
 * fix 覆盖写回开关（四级优先级链）：
 *   CLI 临时（--no-overwrite / --overwrite）> 批次配置（config/BATCH.yaml overwrite）> 系统默认（true 覆盖）
 * 任务级（SPEC.md overwrite: false）不在这里判——由调用处先把该任务筛掉。
 * 返回 enabled + 关闭原因（enabled 时 reason 为空，不用读）。
 */
export function resolveFixSwitch(
  batchCfg: { overwrite?: boolean },
  opts: { noOverwrite?: boolean; forceOverwrite?: boolean },
): { enabled: boolean; reason: string } {
  if (opts.noOverwrite) return { enabled: false, reason: 'CLI --no-overwrite 临时关闭' };
  if (opts.forceOverwrite) return { enabled: true, reason: '' };
  if (batchCfg.overwrite === false) {
    return { enabled: false, reason: '批次配置 config/BATCH.yaml 设了 overwrite: false（临时覆盖一次：--overwrite）' };
  }
  return { enabled: true, reason: '' };
}

// ============================================================
// 渲染（预览 / 摘要）
// ============================================================

/** 修复项清单渲染（预览与提示共用） */
export function renderFixPreview(items: FixItem[]): string {
  const lines: string[] = [`🔧 可自动修复 ${items.length} 处：`];
  items.forEach((it, i) => {
    lines.push(`  [${i + 1}] ${it.taskId}：${it.description}`);
  });
  return lines.join('\n');
}

/** 应用后的改动摘要 */
export function renderFixSummary(applied: string[]): string {
  if (!applied.length) return '✅ 没有需要应用的改动（可能已满足）。';
  const lines = [`✅ 已修复 ${applied.length} 处（改前原文件已归档到任务目录 sources/SPEC.md）：`];
  applied.forEach((d) => lines.push(`  - ${d}`));
  return lines.join('\n');
}
