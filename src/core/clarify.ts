// 澄清检测：用户自己的操作行为——随叫随到的体检，系统只提供入口、检测和报告，从不打断
// 两级信号：确定性信号（CLI 查，零成本）+ 语义信号（词表检测，拦截高危表达）
import { QueueScan } from './queue';
import { TaskSpec, validateRequired } from './task-spec';

export interface ClarifyIssue {
  level: 'blocking' | 'suggest' | 'pending'; // 阻塞 / 建议 / 待定
  taskId: string;
  message: string;
}

/** 高危模糊词：不可验收的表达 */
const VAGUE_WORDS = ['做好', '做好点', '完善', '优化一下', '适当', '尽量', '差不多', '相关', '一些'];

/** 指代不明：执行时 AI 只能靠猜的表达 */
const AMBIGUOUS_REFS = ['那几个', '相关资料', '这些文件', '那些东西', '那个文件'];

/**
 * 澄清检测（单任务）：确定性 + 语义两级信号
 * 返回分级清单，用户自己决定补哪条、删哪条、哪条放默认值
 */
export function detectTaskIssues(spec: TaskSpec): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  // —— 确定性信号 ——
  const v = validateRequired(spec);
  for (const m of v.missing) {
    issues.push({ level: 'blocking', taskId: spec.id, message: `缺少必填项 ${m}（三必填：goal/output/acceptance）` });
  }
  // 验收只有软门禁：无人值守没有机器可查的地基
  if (spec.acceptance && !spec.acceptance.artifacts.length && !spec.acceptance.checks.length && spec.acceptance.review.trim()) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '验收只有评审门禁（review），建议补产物或断言门禁，无人值守才有机器可查的地基' });
  }
  // —— 语义信号 ——
  const text = `${spec.goal}\n${spec.body}`;
  for (const w of VAGUE_WORDS) {
    if (text.includes(w)) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `目标/正文含模糊词「${w}」——不可验收，AI 交付标准靠猜` });
      break; // 同任务只报一次模糊词
    }
  }
  for (const r of AMBIGUOUS_REFS) {
    if (text.includes(r)) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `指代不明「${r}」——执行时 AI 只能脑补所指` });
      break;
    }
  }
  if (spec.draft) {
    issues.push({ level: 'pending', taskId: spec.id, message: '规格标记为 draft（未澄清/未补全），执行前建议先补全' });
  }
  return issues;
}

/** 依赖悬空检查：depends-on 指向不存在的任务 */
export function detectDanglingDeps(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const allIds = new Set<string>();
  for (const t of queue.tasks) allIds.add(t.id);
  for (const m of queue.modules) {
    allIds.add(m.id);
    for (const s of m.subtasks) allIds.add(s.id);
  }
  for (const t of queue.tasks) {
    for (const dep of t.dependsOn) {
      if (!allIds.has(dep)) {
        issues.push({ level: 'blocking', taskId: t.id, message: `依赖悬空：depends-on 指向不存在的任务「${dep}」` });
      }
    }
  }
  return issues;
}

/** 产出路径冲突：两个任务写同一位置 */
export function detectOutputConflicts(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const seen = new Map<string, string>();
  for (const t of queue.tasks) {
    const out = t.output.trim();
    if (!out) continue;
    if (seen.has(out)) {
      issues.push({ level: 'blocking', taskId: t.id, message: `产出路径冲突：「${out}」已被任务 ${seen.get(out)} 使用` });
    } else {
      seen.set(out, t.id);
    }
  }
  return issues;
}

/** 渲染澄清报告（分级清单，处理权全归用户：补/给默认值/标记 draft/无视） */
export function renderClarifyReport(issues: ClarifyIssue[]): string {
  if (!issues.length) return '✅ 未发现表达不充分之处，规格清晰可执行。';
  const lines: string[] = ['澄清报告（随叫随到的体检，处理权在你）', ''];
  const blocking = issues.filter((i) => i.level === 'blocking');
  const suggest = issues.filter((i) => i.level === 'suggest');
  const pending = issues.filter((i) => i.level === 'pending');
  const section = (title: string, list: ClarifyIssue[], icon: string) => {
    if (!list.length) return;
    lines.push(`### ${icon} ${title}（${list.length}）`, '');
    for (const i of list) {
      lines.push(`- [${i.taskId}] ${i.message}`);
    }
    lines.push('');
  };
  section('阻塞', blocking, '⛔');
  section('建议', suggest, '⚠️');
  section('待定', pending, '⏳');
  lines.push('处理方式：补（改规格） / 给默认值（不吭声按默认走） / 标记 draft（执行前再补） / 无视（自己的队列自己负责）');
  return lines.join('\n');
}
