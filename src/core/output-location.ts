// 产出物位置：用户指定优先，镜像推断兜底——clarify 体检与 fix 机械修复共用的单一事实来源
// 规则：任务描述里明确说了产出位置（产出动词 + 路径）→ 按用户指定；没说 → 镜像队列层级落位
// 镜像：产出总仓 outputs/ 与队列同构——queue/batch-003/task-hedui/ → outputs/batch-003/task-hedui/；
// 模块子任务 queue/batch-003/module-budget/xxx/ → outputs/batch-003/module-budget/xxx/；旧式 tasks（第 0 批）→ outputs/tasks/xxx/
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

/** 产出落位镜像：任务目录的批次/任务层级平移到 outputs/ 下（目录名与队列完全一致，照队列找同路径即见产出） */
export function mirrorOutputDir(spec: TaskSpec): string {
  const parts = spec.dir.split(/[\\/]+/);
  let idx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'tasks' || /^batch-\d+$/.test(parts[i])) { idx = i; break; }
  }
  if (idx < 0) return 'outputs/';
  return 'outputs/' + parts.slice(idx).join('/') + '/';
}

/** 默认落位：镜像院落目录；文档类（非代码非数据）再精确到院落内 {slug}.md 主产出文件。
 * 代码/数据类型扩展名不可断定，返回院落目录（具体文件由宿主 AI/用户明确）。
 * 用户指定 output 的场景不经过这里——那是用户表达，最高优先级。 */
export function defaultOutputFor(spec: TaskSpec, typeDef: TaskTypeDefinition): string {
  const dir = mirrorOutputDir(spec);
  if (typeDef.code || typeDef.name === 'data') return dir;
  const slug = slugFromDir(spec.id) || spec.id;
  return `${dir}${slug}.md`;
}
