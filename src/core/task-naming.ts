// 任务命名：目录名 = ASCII slug（机器身份），显示名 = frontmatter name（人类可读）
// 命名机制 = 「对话成规格」的前半步：用户指定（--name）优先，AI 生成草案时顺手续上显示名，
// clarify 体检（名字占位/非 ASCII/重复）自然联动。
// slug 策略：拉丁片段保留，纯中文转全拼（pinyin-pro，与 SpecCore 功能单元命名同款模式），
// 保证目录名可读且幂等（同一输入稳定同一 slug，重跑不漂移）。
import { pinyin } from 'pinyin-pro';

const MAX_SLUG = 24; // 目录名截断上限（可读 + 文件系统友好）

/** 判断是否含中文字符 */
export function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/** 判断是否随机占位 slug（旧逻辑的 t+时间戳 6 位，不可读） */
export function isPlaceholderSlug(s: string): boolean {
  return /^t[0-9a-z]{6}$/.test(s);
}

/** 判断目录名是否含非 ASCII（中文目录等，风格不一致） */
export function hasNonAscii(s: string): boolean {
  return /[^\x00-\x7F]/.test(s);
}

/**
 * 中英文名称转 slug：
 * - 拉丁片段（英文/数字）优先：'用户Auth模块' → 'auth'
 * - 纯中文 → 全拼：'迁移文档' → 'qianyiwendang'
 * - 混合无拉丁且无中文 → 兜底 'task'
 */
export function toSlug(name: string): string {
  const clean = name.trim();
  // 优先提取连续的拉丁片段（"用户Auth模块" → "Auth"）
  const latinMatches = clean.match(/[a-zA-Z0-9]+/g);
  if (latinMatches && latinMatches.length > 0) {
    return latinMatches.join('-').toLowerCase().slice(0, MAX_SLUG);
  }
  // 纯中文 → 拼音全拼（type:'string' 空格分词，再拼成连续全拼；稳定幂等，替代无语义随机占位）
  if (hasCJK(clean)) {
    const py = (pinyin(clean, { toneType: 'none', type: 'string' }) as string)
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    return (py || 'task').slice(0, MAX_SLUG);
  }
  return 'task';
}
