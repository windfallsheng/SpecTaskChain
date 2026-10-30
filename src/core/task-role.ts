// 开放角色系统：内置角色 + 自定义角色定义文件（.taskchain/ROLES/{role}.md）
// 与类型系统正交：type 管形态（代码与否/产出位置/默认约束），role 管专业（执行者以什么角色干）
// 集市哲学：role 可选，不声明照样跑（不注入角色段）；声明了但找不到定义 → 回退通才并亮明，绝不静默
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter } from './task-spec';

export interface TaskRoleDefinition {
  name: string;
  stance: string;   // 角色立场（一句话：你是谁、以什么标准交付）
  focus: string[];  // 专业关注点（执行时重点看什么）
  taboos: string[]; // 角色禁忌（这个角色不该干什么）
  description: string;
  appliesTo?: {     // 可选：自动适用规则（任务没显式声明 role 时按此匹配）
    types?: string[]; // 适用任务类型（type 命中即套用）
    tasks?: string[]; // 适用任务 ID（精确命中，压过类型绑定）
  };
}

/** 内置角色：命名语义化 + 专业化（职能-职业式，与 SpecCore AGENTS 命名风格对齐）；旧名留别名兼容 */
const BUILTIN_ROLES: Record<string, TaskRoleDefinition> = {
  generalist: {
    name: 'generalist',
    stance: '你是一个可靠的通才执行者：完整理解任务规格，按验收标准交付，不增不删需求。',
    focus: ['规格完整性：三必填与验收三态是否都照顾到', '交付可用性：产物对用户直接可用，不留半成品'],
    taboos: ['不擅自扩大或缩小任务范围'],
    description: '通才兜底（未指定角色时的默认）',
  },
  'document-writer': {
    name: 'document-writer',
    stance: '你是一个文档写作专家：文档是给人读的，结构清晰、事实准确、读完能照做。',
    focus: ['结构：标题层级、目录导航、读者视角', '事实：每个结论有出处，不编数据', '可操作性：步骤可照做，示例可复制'],
    taboos: ['不堆砌空话与套话', '不写无法验证的数据与结论'],
    description: '文档写作专家',
  },
  'code-engineer': {
    name: 'code-engineer',
    stance: '你是一个代码工程专家：写出与项目现有风格一致、可直接编译运行、边界处理完整的代码。',
    focus: ['现有风格：读周边代码，命名与结构对齐', '可运行性：写完必须能编译/运行', '边界：异常输入、空值、并发不裸奔'],
    taboos: ['不引入项目未声明的依赖', '不写只有自己能看懂的代码'],
    description: '代码工程专家（功能开发/脚本编写）',
  },
  'debug-engineer': {
    name: 'debug-engineer',
    stance: '你是一个缺陷修复专家：先定位根因再动手，最小改动修复，回归防护跟上。',
    focus: ['根因：复现 → 定位 → 证据链，不猜不试', '最小修复：只改必要的代码，不动无关逻辑', '回归：修复点附近与关联路径都要验证'],
    taboos: ['不靠碰运气式的改代码试错', '不掩盖症状而放过根因'],
    description: '缺陷修复专家（bug 定位与修复）',
  },
  'test-engineer': {
    name: 'test-engineer',
    stance: '你是一个测试工程专家：验收的守卫者，专挑「看起来能跑但实际会挂」的地方。',
    focus: ['覆盖：正常路径 + 边界 + 异常三线', '可执行：测试真的能跑，断言真的在断', '与验收对齐：测试用例逐条对应验收标准'],
    taboos: ['不为覆盖率写无效断言', '不放过任何只差一步就会挂的边界'],
    description: '测试工程专家（测试设计/编写）',
  },
  'security-reviewer': {
    name: 'security-reviewer',
    stance: '你是一个安全审查专家：默认不信任输入，从攻击面出发逐项核查，任何安全缺口都要如实报告。',
    focus: ['输入验证：所有外部输入都不可信', '认证授权：越权、未认证访问', '敏感数据：明文、日志泄漏、权限过宽'],
    taboos: ['不以「内部系统」为由放过风险', '不修改业务逻辑掩盖安全问题'],
    description: '安全审查专家',
  },
  'devops-engineer': {
    name: 'devops-engineer',
    stance: '你是一个运维工程专家：交付可部署、可观测、可回滚的配置与方案。',
    focus: ['可部署：配置一次到位，含环境差异说明', '可观测：日志、指标、告警齐备', '可回滚：出问题有退路'],
    taboos: ['不在生产环境直接试错', '不留无人值守的隐患'],
    description: '运维工程专家（部署/配置/监控）',
  },
  'data-analyst': {
    name: 'data-analyst',
    stance: '你是一个数据分析专家：结论跟着数据走，口径统一、来源可溯、洞察可直接支撑决策。',
    focus: ['口径：统计口径明确定义，前后一致', '来源：每个数字标注出处与时间', '洞察：不止罗列，给出可行动的结论'],
    taboos: ['不编造或估算关键数字', '不把相关当因果'],
    description: '数据分析专家（数据整理/口径核对）',
  },
  'research-analyst': {
    name: 'research-analyst',
    stance: '你是一个调研分析专家：问题先行、来源可考、结论有据，调研报告能直接支撑决策。',
    focus: ['问题定义：先厘清要回答什么，再动手查', '来源质量：权威性、时效性、多方印证', '结论有据：每条结论挂依据，区分事实与推断'],
    taboos: ['不把二手传闻当事实', '不回避与预设相反的发现'],
    description: '调研分析专家（行业/政策/竞品研究）',
  },
  'presentation-designer': {
    name: 'presentation-designer',
    stance: '你是一个演示设计专家：从听众视角设计清晰直接的演示结构，观点先行、逐页支撑。',
    focus: ['叙事线：一页一观点，全程有主线', '信息密度：一页只讲一件事', '视觉呈现：层级分明、重点突出'],
    taboos: ['不做无意义的装饰', '不堆文字让听众自己读'],
    description: '演示设计专家（演示稿/分享材料）',
  },
};

/** 旧角色名别名（专业化改名前的旧名 → 新名）：旧 SPEC 的 role 字段零感知兼容 */
const ROLE_ALIASES: Record<string, string> = {
  'doc-writer': 'document-writer',
  coder: 'code-engineer',
  tester: 'test-engineer',
  ops: 'devops-engineer',
  analyst: 'research-analyst',
  designer: 'presentation-designer',
};

/** 类型 → 默认角色建议（AI 自动选择的起点，与任务内容不匹配时可被宿主 AI 推翻） */
const TYPE_DEFAULT_ROLES: Record<string, string> = {
  general: 'generalist',
  doc: 'document-writer',
  script: 'code-engineer',
  data: 'data-analyst',
  research: 'research-analyst',
  presentation: 'presentation-designer',
  feature: 'code-engineer',
  bugfix: 'debug-engineer',
};

/** 类型默认角色建议名（AI 自动选择的起点） */
export function defaultRoleForType(type: string): string {
  return TYPE_DEFAULT_ROLES[type] || 'generalist';
}

/**
 * 解析任务角色定义：自定义定义文件（覆盖同名内置）→ 内置 → undefined（未定义）
 * 自定义定义文件：.taskchain/ROLES/{role}.md（YAML frontmatter：stance/focus/taboos/description/applies-to）
 * 用户覆盖系统：同名自定义角色压过内置角色——用户显式写了的定义，以用户为准
 */
export function resolveTaskRole(metaDir: string, roleName?: string): TaskRoleDefinition | undefined {
  if (!roleName) return undefined;
  // 旧名归一：doc-writer/coder/tester/ops/analyst/designer → 专业化新名（旧 SPEC 零感知）
  const canonical = ROLE_ALIASES[roleName] || roleName;
  const defFile = join(metaDir, 'ROLES', `${canonical}.md`);
  if (existsSync(defFile)) {
    try {
      const { data } = parseFrontmatter(readFileSync(defFile, 'utf-8'));
      const appliesTo = data['applies-to'] || {};
      return {
        name: canonical,
        stance: String(data.stance || ''),
        focus: Array.isArray(data.focus) ? data.focus.map(String) : [],
        taboos: Array.isArray(data.taboos) ? data.taboos.map(String) : [],
        description: String(data.description || ''),
        appliesTo: {
          types: Array.isArray(appliesTo.types) ? appliesTo.types.map(String) : undefined,
          tasks: Array.isArray(appliesTo.tasks) ? appliesTo.tasks.map(String) : undefined,
        },
      };
    } catch {
      // 定义文件损坏时回退内置/未定义
    }
  }
  return BUILTIN_ROLES[canonical];
}

/** 角色解析结果：显式声明 / 绑定匹配 / AI 自动选择 */
export interface EffectiveRole {
  def?: TaskRoleDefinition;
  source: 'explicit' | 'bound' | 'auto';
  suggestion?: string; // auto 时：类型默认角色建议名（宿主 AI 可按内容推翻）
  conflict?: boolean; // 绑定冲突：同一类型/任务多个角色声明了 applies-to，取文件名字典序第一个
}

/** 扫描 ROLES/ 下所有带 applies-to 的角色（按文件名排序，冲突时取第一个） */
function listBoundRoles(metaDir: string): { role: string; def: TaskRoleDefinition }[] {
  const rolesDir = join(metaDir, 'ROLES');
  if (!existsSync(rolesDir)) return [];
  const out: { role: string; def: TaskRoleDefinition }[] = [];
  for (const entry of readdirSync(rolesDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const roleName = entry.slice(0, -3);
    const def = resolveTaskRole(metaDir, roleName);
    if (def?.appliesTo && (def.appliesTo.types?.length || def.appliesTo.tasks?.length)) {
      out.push({ role: roleName, def });
    }
  }
  return out;
}

/**
 * 解析任务的有效角色（生效链，从强到弱）：
 * 1. 任务 SPEC 显式 role（单任务压过一切）
 * 2. applies-to.tasks 精确命中任务 ID
 * 3. applies-to.types 命中任务 type
 * 4. 都无 → AI 自动选择：注入角色菜单与类型建议，宿主 AI 按任务内容定夺（可推翻建议）
 */
export function resolveEffectiveRole(metaDir: string, spec: { role?: string; id: string; type: string }): EffectiveRole {
  if (spec.role) {
    const def = resolveTaskRole(metaDir, spec.role);
    return { def, source: 'explicit' };
  }
  const bound = listBoundRoles(metaDir);
  const taskHits = bound.filter((b) => b.def.appliesTo?.tasks?.includes(spec.id));
  const typeHits = bound.filter((b) => b.def.appliesTo?.types?.includes(spec.type));
  const hits = taskHits.length ? taskHits : typeHits;
  if (hits.length) return { def: hits[0].def, source: 'bound', conflict: hits.length > 1 };
  return { source: 'auto', suggestion: defaultRoleForType(spec.type) };
}

/** 渲染执行角色段（注入 buildTaskPrompt）：无有效角色返回空数组（保持老行为） */
export function renderRoleSegment(metaDir: string, roleName?: string): string[] {
  if (!roleName) return [];
  const def = resolveTaskRole(metaDir, roleName);
  const lines: string[] = ['## 执行角色', ''];
  if (!def) {
    lines.push(
      `任务声明了角色「${roleName}」，但未找到定义（内置角色无此名，且 .taskchain/ROLES/${roleName}.md 不存在）。`
    );
    lines.push('');
    lines.push('按通才身份执行本任务；完成后提醒用户：补自定义角色文件，或把 SPEC.md 的 role 字段改为内置角色名。');
    lines.push('');
    return lines;
  }
  lines.push(`你以「${def.name}」角色执行本任务${def.description ? `（${def.description}）` : ''}。`);
  if (def.stance) {
    lines.push('');
    lines.push(def.stance);
  }
  if (def.focus.length) {
    lines.push('');
    lines.push('专业关注点：');
    def.focus.forEach((f) => lines.push(`- ${f}`));
  }
  if (def.taboos.length) {
    lines.push('');
    lines.push('角色禁忌：');
    def.taboos.forEach((t) => lines.push(`- ${t}`));
  }
  lines.push('');
  return lines;
}

/** 渲染有效角色段（含绑定来源/冲突标注/AI 自动选择菜单） */
export function renderEffectiveRoleSegment(eff: EffectiveRole): string[] {
  if (eff.source === 'auto') return renderAutoRoleSegment(eff.suggestion);
  if (!eff.def) return [];
  const lines: string[] = ['## 执行角色', ''];
  const origin = eff.source === 'bound' ? '（按角色绑定 applies-to 自动匹配）' : '';
  lines.push(`你以「${eff.def.name}」角色执行本任务${eff.def.description ? `（${eff.def.description}）` : ''}${origin}。`);
  if (eff.conflict) {
    lines.push('');
    lines.push(`⚠️ 多个角色绑定了本任务的类型/ID（已取文件名字典序第一个），建议用任务 role 字段或精确 applies-to.tasks 消除歧义。`);
  }
  if (eff.def.stance) {
    lines.push('');
    lines.push(eff.def.stance);
  }
  if (eff.def.focus.length) {
    lines.push('');
    lines.push('专业关注点：');
    eff.def.focus.forEach((f) => lines.push(`- ${f}`));
  }
  if (eff.def.taboos.length) {
    lines.push('');
    lines.push('角色禁忌：');
    eff.def.taboos.forEach((t) => lines.push(`- ${t}`));
  }
  lines.push('');
  return lines;
}

/** AI 自动选择段：任务未指定角色时，宿主 AI 按任务内容选最专业的角色（类型建议可推翻，选定后建议写回固化） */
function renderAutoRoleSegment(suggestion?: string): string[] {
  const lines: string[] = ['## 执行角色（自动选择）', ''];
  lines.push('本任务未指定角色，由你根据任务内容选择最专业的角色执行。内置角色：');
  for (const name of Object.keys(BUILTIN_ROLES)) {
    lines.push(`- ${name}（${BUILTIN_ROLES[name].description}）`);
  }
  lines.push('');
  lines.push(`类型建议：${suggestion || 'generalist'}——与任务内容不匹配时可推翻。`);
  lines.push('');
  lines.push('选定角色后，建议把 role: <角色名> 写回 SPEC.md frontmatter 固化（下次执行免重复决策）；自定义角色放 .taskchain/ROLES/{角色}.md。');
  lines.push('');
  return lines;
}

/** 内置角色名列表（help / ask 用） */
export function listBuiltinRoles(): string[] {
  return Object.keys(BUILTIN_ROLES);
}
