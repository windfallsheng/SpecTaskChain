// 产出物位置：用户指定优先，类型默认兜底——clarify 体检与 fix 机械修复共用的单一事实来源
// 规则：任务描述里明确说了产出位置（产出动词 + 路径）→ 按用户指定；没说 → 非代码/数据类型按 {outputDir}{slug}.md 默认落位
import type { TaskSpec } from './task-spec';
import { slugFromDir } from './task-naming';
import type { TaskTypeDefinition } from './task-type';

/** 产出动词：路径前出现 → 该路径是产出位置 */
const OUTPUT_VERBS = /(?:写到|写入|输出到|保存到|生成到|产出到|导出到|落盘到|存到|放到|放在|汇总到|输出为|保存为|生成|输出|落盘)/;
/** 改动动词：仅当后跟代码文件扩展名时才算「改动落点」 */
const MODIFY_VERBS = /(?:修改|修复|优化|重构|实现|开发|调整|完善)/;
/** 路径模式：带扩展名的相对路径（目录 + 文件名） */
const PATH_RE = /(?:[\w@.-]+\/)*[\w@.-]+\.(?:md|txt|yaml|yml|json|ts|js|jsx|tsx|py|html|css|csv|xlsx|sql|sh)/g;
const CODE_EXT = /\.(?:ts|js|jsx|tsx|py|css|sh|sql)$/;

/**
 * 提取任务描述中明确指出的产出/改动路径：
 * 向前看 24 字符窗口内出现产出动词 → 产出位置；改动动词 + 代码扩展名 → 改动落点
 * 「读/参考/基于」等输入引用不算产出（排除 data/xx.csv 被当产出误报）
 */
export function extractStatedPaths(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(PATH_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ctx = text.slice(Math.max(0, m.index - 24), m.index);
    if (OUTPUT_VERBS.test(ctx)) { found.push(m[0]); continue; }
    if (MODIFY_VERBS.test(ctx) && CODE_EXT.test(m[0])) { found.push(m[0]); }
  }
  return found;
}

/** 默认落位选项：批次产出目录覆盖 + 归巢开关（任务院落） */
export interface OutputLocOptions {
  batchDirs?: Record<string, string>; // 批次配置 output-dirs：类型 → 目录，覆盖内置归位表
  nest?: boolean;                     // 按任务名归巢子目录（默认 false 保持扁平；调用处按批次配置传）
}

/** 类型默认落位：{base}{slug}.md；归巢时 {base}{slug}/{slug}.md（目录=任务院落，多产物聚一处不踩踏）。
 * 代码/数据类型扩展名不可断定，返回空串（留给宿主 AI/用户明确）。
 * 目录优先级：批次 output-dirs > 类型内置 outputDir；用户指定 output 的场景不经过这里——那是用户表达，最高优先级。 */
export function defaultOutputFor(spec: TaskSpec, typeDef: TaskTypeDefinition, opts: OutputLocOptions = {}): string {
  if (typeDef.code || typeDef.name === 'data') return '';
  const slug = slugFromDir(spec.id) || spec.id;
  const base = (opts.batchDirs && opts.batchDirs[typeDef.name]) || typeDef.outputDir;
  return opts.nest ? `${base}${slug}/${slug}.md` : `${base}${slug}.md`;
}
