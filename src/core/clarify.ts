// 澄清检测：用户自己的操作行为——随叫随到的体检，系统只提供入口、检测和报告，从不打断
// 两级信号：确定性信号（CLI 查，零成本）+ 语义信号（词表检测，拦截高危表达）
import { existsSync } from 'fs';
import { isAbsolute, resolve, basename, dirname, join } from 'path';
import { QueueScan } from './queue';
import { TaskSpec, validateRequired } from './task-spec';
import { extractReferences } from './references';
import { isPlaceholderSlug, hasNonAscii } from './task-naming';
import { resolveTaskRole, listBuiltinRoles, resolveEffectiveRole } from './task-role';

/** 从任务目录上溯找 .taskchain（metaDir）：任务在 queue/{批次}/{任务}/ 或 queue/{批次}/{模块}/{子任务}/ 下 */
function findMetaDir(taskDir: string): string {
  let d = dirname(taskDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, '.taskchain'))) return join(d, '.taskchain');
    d = dirname(d);
  }
  return dirname(taskDir);
}

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
 * projectRoot：引用基准（缺省 = 任务目录，保持向后兼容；命令层传项目根，与 output/artifacts 一致）
 * 返回分级清单，用户自己决定补哪条、删哪条、哪条放默认值
 */
export function detectTaskIssues(spec: TaskSpec, projectRoot?: string): ClarifyIssue[] {
  const refBase = projectRoot || spec.dir;
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
  // 引用悬空：SPEC 引用的本地文件/图片不存在——执行时 AI 读不到真实内容
  const refs = extractReferences(`${spec.goal}\n${spec.body}`);
  const missingRefs = refs
    .filter((r) => r.kind !== 'url')
    .filter((r) => !existsSync(isAbsolute(r.target) ? r.target : resolve(refBase, r.target)));
  if (missingRefs.length) {
    const names = missingRefs.slice(0, 3).map((r) => r.target).join('、') + (missingRefs.length > 3 ? ` 等 ${missingRefs.length} 处` : '');
    issues.push({ level: 'blocking', taskId: spec.id, message: `引用的文件/图片不存在（${names}）——执行时 AI 读不到真实内容，先补文件或改引用` });
  }
  // —— 命名体检：目录名是机器身份，可读性不能被占位符/非 ASCII 吃掉 ——
  const dirSlug = spec.id.replace(/^\d+-/, '');
  if (isPlaceholderSlug(dirSlug)) {
    issues.push({ level: 'suggest', taskId: spec.id, message: `目录名「${dirSlug}」是随机占位（t+时间戳），可读性差——建议用 --name 重建，或在 frontmatter 补 name 显示名` });
  }
  if (hasNonAscii(spec.id)) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '目录名含非 ASCII 字符——建议 ASCII slug 作目录名，中文显示名写 frontmatter name 字段' });
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
  // —— 角色体检：声明了但未定义 → 执行时回退通才，先亮明再跑 ——
  if (spec.role && !resolveTaskRole(findMetaDir(spec.dir), spec.role)) {
    issues.push({ level: 'suggest', taskId: spec.id, message: `角色「${spec.role}」未定义（内置：${listBuiltinRoles().join('/')}）——执行时回退通才；要专业化就补 .taskchain/ROLES/${spec.role}.md 或改 role 字段` });
  } else if (!spec.role) {
    // 未指定角色且无绑定：执行时宿主 AI 按内容自动选择（亮类型建议）——要固定就补 role 字段
    const eff = resolveEffectiveRole(findMetaDir(spec.dir), spec);
    if (eff.source === 'auto' && eff.suggestion) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `未指定角色——执行时 AI 按任务内容自动选择（类型建议：${eff.suggestion}）；要固定就补 role 字段，自定义角色放 .taskchain/ROLES/` });
    }
  }
  return issues;
}

/** 队列全部任务（顶层 + 模块子任务） */
function allTasks(queue: QueueScan): TaskSpec[] {
  return [...queue.tasks, ...queue.modules.flatMap((m) => m.subtasks)];
}

/** 依赖悬空检查：depends-on 指向不存在的任务（覆盖顶层与模块子任务） */
export function detectDanglingDeps(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const allIds = new Set<string>(allTasks(queue).map((t) => t.id));
  for (const m of queue.modules) allIds.add(m.id);
  for (const t of allTasks(queue)) {
    for (const dep of t.dependsOn) {
      if (!allIds.has(dep)) {
        issues.push({ level: 'blocking', taskId: t.id, message: `依赖悬空：depends-on 指向不存在的任务「${dep}」` });
      }
    }
  }
  return issues;
}

/** 产出路径冲突：两个任务写同一位置（覆盖顶层与模块子任务） */
export function detectOutputConflicts(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const seen = new Map<string, string>();
  for (const t of allTasks(queue)) {
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

/** 模块公共约束检查：CONSTRAINTS.md 缺失/为空 → blocking（子任务执行会被阻塞，绝不静默裸奔） */
export function detectModuleIssues(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  for (const m of queue.modules) {
    if (m.constraintsMissing) {
      issues.push({ level: 'blocking', taskId: m.id, message: `模块「${m.id}」缺少公共约束（CONSTRAINTS.md 缺失或为空）——共享 spec 是子任务每次执行前重置的必读前提，先补全：${m.constraintsPath}` });
    }
  }
  return issues;
}

/** 命名重复检查：同层任务 slug 撞名 + 跨层 ID 撞车（ID 是 state.json 键，跨层重复会共享状态） */
export function detectDuplicateNames(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const check = (entries: { id: string }[], layer: string) => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const slug = e.id.replace(/^\d+-/, '');
      if (seen.has(slug)) {
        issues.push({ level: 'suggest', taskId: e.id, message: `${layer} slug「${slug}」与「${seen.get(slug)}」重复——建议区分名字，清单浏览时才能一眼分清` });
      } else {
        seen.set(slug, e.id);
      }
    }
  };
  check(queue.tasks, '任务');
  check(queue.modules, '模块');
  for (const m of queue.modules) check(m.subtasks, `模块「${m.id}」子任务`);
  // 跨层 ID 撞车：任务 ID = state.json 键，顶层与子任务同 ID 会共享状态
  const topIds = new Set(queue.tasks.map((t) => t.id));
  for (const m of queue.modules) {
    for (const s of m.subtasks) {
      if (topIds.has(s.id)) {
        issues.push({ level: 'blocking', taskId: s.id, message: `任务 ID「${s.id}」与顶层任务重复——ID 是状态文件的键，跨层重复会共享状态，请改名区分` });
      }
    }
  }
  return issues;
}

/** 循环依赖检测：环不阻断执行（环成员按原序平铺），但值得排查 */
export function detectCycles(queue: QueueScan): ClarifyIssue[] {
  const all = allTasks(queue);
  const byId = new Map(all.map((t) => [t.id, t]));
  const issues: ClarifyIssue[] = [];
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const dfs = (t: TaskSpec, path: string[]): void => {
    color.set(t.id, GRAY);
    for (const depId of t.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const c = color.get(depId) || WHITE;
      if (c === GRAY) {
        issues.push({ level: 'suggest', taskId: t.id, message: `检测到循环依赖：${[...path, t.id, depId].join(' → ')}——不阻断执行（环成员按原序平铺），但建议打破依赖环` });
      } else if (c === WHITE) {
        dfs(dep, [...path, t.id]);
      }
    }
    color.set(t.id, BLACK);
  };
  for (const t of all) {
    if ((color.get(t.id) || WHITE) === WHITE) dfs(t, []);
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

/** 链级体检（--chain 与无参数共用）：只查链执行必翻车的硬伤（依赖悬空/产出冲突/模块约束/命名重复/循环依赖） */
export function detectChainIssues(queue: QueueScan): ClarifyIssue[] {
  return [
    ...detectDanglingDeps(queue),
    ...detectOutputConflicts(queue),
    ...detectModuleIssues(queue),
    ...detectDuplicateNames(queue),
    ...detectCycles(queue),
    ...detectRoleConflicts(queue),
  ];
}

/** 角色绑定冲突检查：同一类型/任务被多个角色 applies-to 命中（已取文件名字典序第一个，其余建议收敛） */
export function detectRoleConflicts(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const first = allTasks(queue)[0];
  if (!first) return issues;
  const metaDir = findMetaDir(first.dir);
  const seen = new Set<string>();
  for (const t of allTasks(queue)) {
    const eff = resolveEffectiveRole(metaDir, t);
    if (eff.conflict && eff.def) {
      const key = `${t.type}|${eff.def.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ level: 'suggest', taskId: t.id, message: `角色绑定冲突：类型「${t.type}」被多个角色 applies-to 命中（已取「${eff.def.name}」）——建议收敛绑定，或用任务 role 字段显式指定` });
    }
  }
  return issues;
}

/** 任务 ID 提取（跨平台）：路径末段即目录名（宿主 AI 消解「上面」后传入的就是这里） */
export function taskIdFromPath(file: string): string | null {
  const base = basename(file);
  if (base === 'SPEC.md') {
    const parent = basename(dirname(file));
    return parent ? parent : null;
  }
  return base; // 指向任务目录本身
}
