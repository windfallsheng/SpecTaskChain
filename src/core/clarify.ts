// 澄清检测：用户自己的操作行为——随叫随到的体检，系统只提供入口、检测和报告，从不打断
// 两级信号：确定性信号（CLI 查，零成本）+ 语义信号（词表检测，拦截高危表达）
import { existsSync } from 'fs';
import { isAbsolute, resolve, basename, dirname, join } from 'path';
import { QueueScan } from './queue';
import { TaskSpec, validateRequired } from './task-spec';
import { extractReferences } from './references';
import { isPlaceholderSlug, hasNonAscii, slugFromDir } from './task-naming';
import { resolveTaskRole, listBuiltinRoles, resolveEffectiveRole } from './task-role';
import { builtinTemplatePlaceholders } from './task-template';
import { resolveTaskType } from './task-type';
import { extractStatedPaths, defaultOutputFor, type OutputLocOptions } from './output-location';

/** 内置模板占位符行集合（骨架未填实检测的单一事实来源，模块加载时取一次） */
const BUILTIN_PLACEHOLDERS = builtinTemplatePlaceholders();

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
  level: 'blocking' | 'suggest' | 'pending' | 'exec'; // 阻塞 / 建议 / 待定 / 可执行性风险
  taskId: string;
  message: string;
  options?: ExecOption[]; // exec 档专属：方案菜单（用户选哪条路 AI 就能继续）
}

/** 可执行性风险的一个可选方案：谁来做 + 具体怎么做 + 推荐评分（帮用户做判断题） */
export interface ExecOption {
  title: string; // 方案名（如「换自动化通道」）
  who: 'ai' | 'human' | 'both'; // 执行主体：AI / 人 / 人机协作
  how: string; // 怎么做：改什么 AI 就能执行 / 换什么内容 / 闸口分工线
  score?: number; // 推荐评分（10 分制，高者置顶；无评分按原序）
  recommended?: boolean; // 推荐方案（每类信号唯一标记：终端/HTML 置顶 + ✅ 徽章）
  reason?: string; // 推荐理由（recommended 时必填，让用户做判断题而不是选择题）
}

/** 高危模糊词：不可验收的表达 */
const VAGUE_WORDS = ['做好', '做好点', '完善', '优化一下', '适当', '尽量', '差不多', '相关', '一些', '整理一下', '弄弄', '搞个', '搞一下', '弄一下', '改一下', '检查下', '有点', '最近'];

/** 指代不明：执行时 AI 只能靠猜的表达 */
const AMBIGUOUS_REFS = ['那几个', '相关资料', '这些文件', '那些东西', '那个文件', '上次', '这次', '那天', '同行', '那个'];

/**
 * 可执行性风险信号库：CLI 确定性检测 AI 能力圈边界的表达（词表命中，零成本）
 * 每类 = 风险本质 + 方案菜单（2-3 个可选方案，覆盖三条出路：改什么 AI 就能做 / 换什么内容 AI 能做 / 人机分工闸口线）
 * 每条方案带评分（10 分制），唯一 ✅ 推荐方案附推荐理由——用户做判断题（采纳/换/跳过）而不是选择题
 * 命中 → 亮给用户选方案，不拦接力（exec 档）
 */
interface ExecSignal {
  re: RegExp;
  label: string;  // 风险类别（同任务同类别只报一次）
  risk: string;   // 风险本质：AI 卡在哪
  options: ExecOption[]; // 方案菜单
}

const EXEC_SIGNALS: ExecSignal[] = [
  {
    re: /登录|扫码|短信验证|验证码|人脸识别|指纹|动态口令|U盾|U 盾|实名认证/,
    label: '认证凭据',
    risk: '需要用户在场完成认证（AI 无账号、无生物凭证、收不到验证码）',
    options: [
      { title: '补测试凭据', who: 'both', how: '提供测试账号/固定验证码/预置登录态，AI 拿到就能全程自动化执行', score: 9, recommended: true, reason: '直接补上 AI 缺的凭证，自动化程度最高、改动最小' },
      { title: '换自动化通道', who: 'ai', how: '改用 API token/密钥调用（放 CI 环境变量），绕开交互式认证', score: 8 },
      { title: '人机分工：AI 做到闸口', who: 'both', how: 'AI 写好流程/脚本/材料，认证动作由人完成，通过后 AI 接力', score: 7 },
    ],
  },
  {
    re: /审批|授权书|管理员权限|root|sudo|内部系统|OA|ERP|工单系统/,
    label: '权限审批',
    risk: '需要高权限或人工审批（AI 无权限，也不能替人审批）',
    options: [
      { title: '划权限边界', who: 'both', how: '明确 AI 可用的账号与操作范围（如开发环境专用账号、目录白名单）', score: 9, recommended: true, reason: '白名单与操作范围一次划定，AI 在边界内全程自主' },
      { title: '换验证环境', who: 'ai', how: '需审批的步骤改在本地沙箱/mock 环境验证，验证通过后再走正式审批', score: 8 },
      { title: '人机分工：AI 备料人审批', who: 'both', how: 'AI 产出申请材料与操作清单，审批/授权由人完成', score: 7 },
    ],
  },
  {
    re: /邮寄|快递|跑腿|线下|到店|面对面|盖章|签字|打印|插拔|真机|U盘|U 盘|光盘/,
    label: '物理动作',
    risk: '物理动作 AI 没有手（寄件/盖章/插设备等只能人来）',
    options: [
      { title: '换数字化替代', who: 'ai', how: '电子签章/电子签名/云打印，AI 可全程执行并可留电子回执验收', score: 9, recommended: true, reason: '数字化替代让 AI 全程可执行，且电子回执天然可验收' },
      { title: '砍掉物理环节', who: 'ai', how: '改成 AI 可验证的产出（发电子版、留电子回执），实体环节另立任务给人', score: 8 },
      { title: '人机分工：AI 备料人跑腿', who: 'both', how: 'AI 准备全套材料与核对清单，动作由人完成，留痕后 AI 接力', score: 6 },
    ],
  },
  {
    re: /公众号后台|小程序后台|应用商店|App Store|Google Play|企业微信|钉钉后台|飞书后台|抖音后台|视频号|微博后台/,
    label: '平台账号',
    risk: '需要第三方平台后台账号操作（AI 无平台账号）',
    options: [
      { title: '补自动化凭据', who: 'both', how: '提供开放平台 API/密钥（如公众号 appid+secret），AI 走接口代替后台点击', score: 9, recommended: true, reason: '开放平台 API 化后 AI 全程执行，彻底摆脱后台点击' },
      { title: '换验收方式', who: 'ai', how: 'AI 产出内容 + 操作步骤清单，后台发布由人，发布结果截图留痕验收', score: 8 },
      { title: '人机分工：AI 备料人发布', who: 'both', how: 'AI 产出全部素材与步骤，后台点击由人完成', score: 7 },
    ],
  },
  {
    re: /付款|转账|报销|开发票|发票|合同签署|投标|竞标/,
    label: '资金合规',
    risk: '涉及资金/合同/合规动作（AI 不能也不该直接执行）',
    options: [
      { title: '换验证环境', who: 'ai', how: '用沙箱/测试通道支付（金额虚构）验证流程，AI 可执行', score: 9, recommended: true, reason: '沙箱验证让 AI 全程可执行，且不触碰合规红线' },
      { title: '砍成准备态', who: 'ai', how: 'AI 只做对账单/合同稿/投标文件，资金动作另立任务给人执行', score: 8 },
      { title: '人机分工：AI 备料人审批', who: 'both', how: 'AI 准备材料，人审批执行，凭证留痕进验收', score: 7 },
    ],
  },
  {
    re: /等审批通过|等对方回复|等客户确认|等待回复|等通知/,
    label: '外部等待',
    risk: '依赖外部响应，AI 只能做到闸口（无法催外部世界）',
    options: [
      { title: '改触发条件', who: 'ai', how: '把「等回复」改成可判定的信号（如邮件主题过滤/状态接口轮询），AI 可自动判断', score: 9, recommended: true, reason: '把「等」改造成可判定信号，AI 自动判断、无人值守' },
      { title: '换执行时机', who: 'both', how: '任务改待命态（draft），人收到消息后标记执行条件满足，AI 再接力', score: 8 },
      { title: '人机分工：AI 备模板人跟进', who: 'both', how: 'AI 写好跟进模板与提醒，等待期间由人手动推进', score: 6 },
    ],
  },
];

/**
 * 文本级可执行性信号扫描：任务 SPEC（goal+正文）与模块共享约束（CONSTRAINTS.md）共用同一套词表
 * prefix：上下文前缀（任务为空；模块为「模块「X」公共约束：」），让报告里一眼分清风险出自哪里
 */
function scanExecSignals(text: string, id: string, prefix: string, skipLabels?: Set<string>): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const reported = new Set<string>();
  for (const sig of EXEC_SIGNALS) {
    if (reported.has(sig.label)) continue;
    if (skipLabels?.has(sig.label)) continue; // 已决信号跳过（SPEC.md decisions 留痕，采纳过的类别不再报）
    const hit = text.match(sig.re);
    if (hit) {
      reported.add(sig.label);
      issues.push({
        level: 'exec',
        taskId: id,
        message: `${prefix}可执行性风险（${sig.label}）：「${hit[0]}」——${sig.risk}`,
        options: sig.options,
      });
    }
  }
  return issues;
}

/**
 * 可执行性风险检测：扫 goal + 正文，命中信号库 → exec 档 issue
 * 同任务同类别只报一次（取首个命中词）
 */
export function detectExecRisks(spec: TaskSpec): ClarifyIssue[] {
  // 已决信号跳过：SPEC.md frontmatter decisions（「风险标签→方案名」）里裁决过的类别不再报
  const decided = new Set((spec.decisions || []).map((d) => d.split(/[→:：]/)[0].trim()));
  return scanExecSignals(`${spec.goal}\n${spec.body}`, spec.id, '', decided);
}

/**
 * 澄清检测（单任务）：确定性 + 语义两级信号
 * projectRoot：引用基准（缺省 = 任务目录，保持向后兼容；命令层传项目根，与 output/artifacts 一致）
 * 返回分级清单，用户自己决定补哪条、删哪条、哪条放默认值
 */
export function detectTaskIssues(spec: TaskSpec, projectRoot?: string, knownArtifacts?: Set<string>, opts?: OutputLocOptions): ClarifyIssue[] {
  const refBase = projectRoot || spec.dir;
  const issues: ClarifyIssue[] = [];
  // —— 确定性信号 ——
  const v = validateRequired(spec);
  for (const m of v.missing) {
    issues.push({ level: 'blocking', taskId: spec.id, message: `缺少必填项 ${m}（三必填：goal/output/acceptance）` });
  }
  // —— 产出物位置三查：用户指定优先，类型默认兜底 ——
  // 1. 描述里明确说了产出位置但 output 未填 → 按用户指定的补
  // 2. 描述里的产出位置与 output 不一致 → 亮明冲突，按用户指定的来
  // 3. 产出位置未指明 → 默认落位建议（代码/数据类型提示明确文件或目录）
  const stated = extractStatedPaths(`${spec.goal}\n${spec.body}`);
  const outRaw = (spec.output || '').trim();
  if (stated.length) {
    const outHit = stated.every((pt) => !outRaw.includes(pt)) ? stated[0] : '';
    if (!outRaw) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `任务描述指出产出位置「${stated[0]}」，output 未填——用户指定的位置优先，建议 output: ${stated[0]}` });
    } else if (outHit) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `任务描述指出产出位置「${outHit}」，output 为「${outRaw}」——不一致，按用户指定的来` });
    }
  } else if (!outRaw) {
    const typeDef = resolveTaskType(findMetaDir(spec.dir), spec.type);
    const def = defaultOutputFor(spec, typeDef, opts);
    if (def) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `产出物位置未指明——默认按类型 ${spec.type} 落位 ${def}（任务描述中已指定的以指定为准）` });
    } else {
      issues.push({ level: 'suggest', taskId: spec.id, message: `产出物位置未指明——${typeDef.code ? '代码' : '数据'}任务请明确产出/改动的文件或目录（如 src/xxx.ts / data/xxx.csv）` });
    }
  }
  // 验收只有软门禁：无人值守没有机器可查的地基
  if (spec.acceptance && !spec.acceptance.artifacts.length && !spec.acceptance.checks.length && spec.acceptance.review.trim()) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '验收只有评审门禁（review），建议补产物或断言门禁，无人值守才有机器可查的地基' });
  }
  // 引用悬空：SPEC 引用的本地文件/图片不存在——执行时 AI 读不到真实内容
  const refs = extractReferences(`${spec.goal}\n${spec.body}`);
  const missingRefs = refs
    .filter((r) => r.kind !== 'url')
    .filter((r) => !existsSync(isAbsolute(r.target) ? r.target : resolve(refBase, r.target)))
    .filter((r) => !(knownArtifacts && [...knownArtifacts].some((p) => p === r.target || p.endsWith('/' + r.target)))); // 上游任务将要产出的文件不误报（依赖链场景；含 basename 写法兜底）
  if (missingRefs.length) {
    const names = missingRefs.slice(0, 3).map((r) => r.target).join('、') + (missingRefs.length > 3 ? ` 等 ${missingRefs.length} 处` : '');
    issues.push({ level: 'blocking', taskId: spec.id, message: `引用的文件/图片不存在（${names}）——执行时 AI 读不到真实内容，先补文件或改引用` });
  }
  // —— 命名体检：目录名是机器身份，可读性不能被占位符/非 ASCII 吃掉 ——
  const dirSlug = slugFromDir(spec.id);
  if (isPlaceholderSlug(dirSlug)) {
    issues.push({ level: 'suggest', taskId: spec.id, message: `目录名「${dirSlug}」是随机占位（t+时间戳），可读性差——建议用 --name 重建，或在 frontmatter 补 name 显示名` });
  }
  if (hasNonAscii(spec.id)) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '目录名含非 ASCII 字符——建议 ASCII slug 作目录名，中文显示名写 frontmatter name 字段' });
  }
  // —— 正文澄清度：goal 是任务灵魂，正文是灵魂的展开——空白/复制/骨架未填实都拦 ——
  const bodyNorm = spec.body.replace(/\s+/g, '');
  const goalNorm = spec.goal.replace(/\s+/g, '');
  if (!bodyNorm) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '正文空白——只有 goal 一行，背景/边界/输出格式全靠 AI 脑补；建议补上执行上下文' });
  } else if (bodyNorm === goalNorm) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '正文未澄清——正文只是 goal 的复制品，没有实质澄清内容（背景、约束、边界）；建议补实执行要点' });
  } else {
    const placeholder = spec.body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => BUILTIN_PLACEHOLDERS.has(l));
    if (placeholder) {
      issues.push({ level: 'suggest', taskId: spec.id, message: `正文残留模板占位符「${placeholder}」——骨架未填实；建议替换为实质内容` });
    }
  }
  // —— 澄清留痕闭环：「## 澄清记录」章节骨架在但无实质条目 → 留痕没写完 ——
  const logMatch = spec.body.match(/##\s*澄清记录\s*\n([\s\S]*?)(?=\n##\s|\n*$)/);
  if (logMatch) {
    const section = logMatch[1];
    const hasItems = /^\s*([-*]|\d+[.、])\s+/m.test(section) || section.trim().length > 20;
    if (!hasItems) {
      issues.push({ level: 'suggest', taskId: spec.id, message: '「## 澄清记录」章节为空——补条目：原模糊点 / 备选方案 / 应用的方案与理由' });
    }
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
  // —— 可执行性风险：AI 能力圈边界（认证/权限/物理动作/平台账号/资金合规/外部等待）——
  issues.push(...detectExecRisks(spec));
  // —— 工时体检：估了才长得出偏差账；单任务过重（>40h）估算失真，建议拆开接力 ——
  if (spec.estimate === undefined) {
    issues.push({ level: 'suggest', taskId: spec.id, message: '未估工时（estimate）——报告汇总不出预估总量，也长不出「预估 vs 实际」偏差账；建议 SPEC.md 补 estimate 字段' });
  } else if (spec.estimate > 40) {
    issues.push({ level: 'suggest', taskId: spec.id, message: `预估工时 ${spec.estimate}h 单任务过重——估算容易失真，建议拆成多个任务接力（taskq split）` });
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

/** 产出路径冲突：两个任务写同一位置（覆盖顶层与模块子任务）；纯目录落位（以 / 结尾）是占位声明不算最终产物，不判冲突 */
export function detectOutputConflicts(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const seen = new Map<string, string>();
  for (const t of allTasks(queue)) {
    const out = t.output.trim();
    if (!out) continue;
    if (out.endsWith('/')) continue;
    if (seen.has(out)) {
      issues.push({ level: 'blocking', taskId: t.id, message: `产出路径冲突：「${out}」已被任务 ${seen.get(out)} 使用` });
    } else {
      seen.set(out, t.id);
    }
  }
  return issues;
}

/**
 * 隐式依赖推导：任务引用了他人产物却未声明 depends-on——把「AI 只能脑补上下游」显性化为建议。
 * 匹配规则：引用路径精确命中或后缀命中（basename 一致，兼容反引号截断历史数据）某任务的 acceptance.artifacts；
 * 排除自己产出的路径与已声明 depends-on 的上游（那些关系用户已表达，不重复提醒）。
 * 只建议不自动改：依赖声明是用户的表达，处理权在人（与 clarify 一贯哲学一致）。
 */
export function detectImplicitDeps(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const tasks = allTasks(queue);
  const ownerByPath = new Map<string, string>();
  for (const t of tasks) {
    for (const a of t.acceptance?.artifacts || []) {
      if (a.path && !ownerByPath.has(a.path)) ownerByPath.set(a.path, t.id);
    }
  }
  const ownedPaths = [...ownerByPath.keys()];
  for (const t of tasks) {
    const declared = new Set(t.dependsOn);
    const refs = extractReferences(`${t.goal}\n${t.body}`);
    for (const r of refs) {
      // 精确命中优先，后缀命中兜底（bareRe 历史截断场景）
      let owner = ownerByPath.get(r.target);
      if (!owner) {
        const hit = ownedPaths.find((p) => p.endsWith('/' + r.target));
        owner = hit ? ownerByPath.get(hit) : undefined;
      }
      if (!owner || owner === t.id || declared.has(owner)) continue;
      issues.push({
        level: 'suggest',
        taskId: t.id,
        message: `引用上游产物「${r.target}」（任务 ${owner} 产出）但未声明 depends-on——不补则 ${owner} 可能后跑，执行时拿不到真实产物只能脑补；建议 SPEC.md 补 depends-on: ${owner}`,
      });
      break; // 每任务只报第一条，其余自查
    }
  }
  return issues;
}

/**
 * 模块公共约束检查（两级）：
 * 1. CONSTRAINTS.md 缺失/为空 → blocking（子任务执行会被阻塞，绝不静默裸奔）
 * 2. 内容级体检：共享约束与子任务同权——模糊词/指代不明 → suggest；可执行性风险 → exec（带方案菜单）
 *    共享 spec 是每个子任务执行前必读的底座，里面的含糊会被所有子任务继承放大，更该体检
 */
export function detectModuleIssues(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  for (const m of queue.modules) {
    if (m.constraintsMissing) {
      issues.push({ level: 'blocking', taskId: m.id, message: `模块「${m.id}」缺少公共约束（CONSTRAINTS.md 缺失或为空）——共享 spec 是子任务每次执行前重置的必读前提，先补全：${m.constraintsPath}` });
      continue;
    }
    const text = m.constraints;
    for (const w of VAGUE_WORDS) {
      if (text.includes(w)) {
        issues.push({ level: 'suggest', taskId: m.id, message: `模块「${m.id}」公共约束含模糊词「${w}」——所有子任务共用，含糊会被每个子任务继承放大` });
        break; // 同模块只报一次模糊词
      }
    }
    for (const r of AMBIGUOUS_REFS) {
      if (text.includes(r)) {
        issues.push({ level: 'suggest', taskId: m.id, message: `模块「${m.id}」公共约束指代不明「${r}」——子任务执行时只能脑补所指` });
        break;
      }
    }
    issues.push(...scanExecSignals(text, m.id, `模块「${m.id}」公共约束：`));
  }
  return issues;
}

/** 命名重复检查：同层任务 slug 撞名 + 跨层 ID 撞车（ID 是 state.json 键，跨层重复会共享状态） */
export function detectDuplicateNames(queue: QueueScan): ClarifyIssue[] {
  const issues: ClarifyIssue[] = [];
  const check = (entries: { id: string }[], layer: string) => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const slug = slugFromDir(e.id);
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
  // 完整 ID 撞车（跨批次同名目录/跨模块同名子任务）：ID = state.json 键，同 ID 会共享状态——CLI 新建会自动拼 hash 避开，手工建的可能撞
  const idSeen = new Map<string, string>();
  const allIds = [...queue.tasks.map((t) => t.id), ...queue.modules.flatMap((m) => m.subtasks.map((s) => s.id))];
  for (const tid of allIds) {
    if (idSeen.has(tid)) {
      issues.push({ level: 'blocking', taskId: tid, message: `任务 ID「${tid}」重复（跨批次/跨模块同名目录）——ID 是状态文件的键，重复会共享状态，请改名区分` });
    } else {
      idSeen.set(tid, tid);
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
  const exec = issues.filter((i) => i.level === 'exec');
  const section = (title: string, list: ClarifyIssue[], icon: string) => {
    if (!list.length) return;
    lines.push(`### ${icon} ${title}（${list.length}）`, '');
    for (const i of list) {
      lines.push(`- [${i.taskId}] ${i.message}`);
      // exec 档：方案菜单——✅ 推荐置顶（评分+理由），其余按分跟排；标明谁来做（🤖/👤/🤝）+ 怎么做
      const sorted = [...(i.options || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
      for (const o of sorted) {
        const whoIcon = o.who === 'ai' ? '🤖' : o.who === 'human' ? '👤' : '🤝';
        const rec = o.recommended ? '✅ 推荐 ' : '';
        const score = o.score !== undefined ? ` ${o.score}/10` : '';
        lines.push(`  · ${rec}${whoIcon} ${o.title}${score}：${o.how}${o.recommended && o.reason ? `（推荐理由：${o.reason}）` : ''}`);
      }
    }
    lines.push('');
  };
  section('阻塞', blocking, '⛔');
  section('建议', suggest, '⚠️');
  section('待定', pending, '⏳');
  section('可执行性风险', exec, '🤖');
  lines.push('处理方式：补（改规格） / 给默认值（不吭声按默认走） / 标记 draft（执行前再补） / 无视（自己的队列自己负责）；可执行性风险从方案菜单选一条（✅ 推荐带评分与理由）：改什么 AI 就能做 / 换什么内容 AI 能做 / 人机分工（AI 做闸口内，人做闸口外）；逐项裁决：taskq clarify --task <ID> --decide（y 采纳 / n 换方案 / s 跳过，采纳写回 SPEC.md decisions）');
  // 澄清留痕（可追溯）：澄清动作不该是黑箱——记录改了什么、备选了什么、选了哪个
  lines.push('', '澄清留痕：', '  · 澄清（补正文）后，在 SPEC.md 正文尾部写「## 澄清记录」——逐条列原模糊点 / 备选方案 / 应用的方案与理由；无人值守（自动）模式必写，交互模式用户全程在场可免。', '  · CLI 机械修自带留痕：fix 写 frontmatter fix-log、--decide 写 decisions、改前归档 sources/——无需手写。');
  return lines.join('\n');
}

/** HTML 转义：体检消息含任务 ID 与路径（内容不受控） */
function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 体检报告 HTML（taskq clarify --html）：四档红黄灰靛分组卡片，与 PANEL.html 同视觉语言 */
export function renderClarifyHtml(issues: ClarifyIssue[]): string {
  const blocking = issues.filter((i) => i.level === 'blocking');
  const suggest = issues.filter((i) => i.level === 'suggest');
  const pending = issues.filter((i) => i.level === 'pending');
  const exec = issues.filter((i) => i.level === 'exec');
  const whoIcon = (who: string) => (who === 'ai' ? '🤖' : who === 'human' ? '👤' : '🤝');
  const whoTag = (who: string) =>
    `<span class="who ${who}">${whoIcon(who)} ${who === 'ai' ? 'AI 可执行' : who === 'human' ? '人来完成' : '人机协作'}</span>`;
  const group = (title: string, icon: string, list: ClarifyIssue[], accent: string) =>
    list.length
      ? `<div class="group" style="border-left-color:${accent}"><h3>${icon} ${title}<span class="badge" style="background:${accent}">${list.length}</span></h3>${list
          .map(
            (i) =>
              `<div class="item"><b>${escHtml(i.taskId)}</b><p>${escHtml(i.message)}</p>${(i.options || [])
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map(
                  (o) =>
                    `<div class="opt${o.recommended ? ' rec' : ''}">${whoTag(o.who)}${o.recommended ? '<span class="rec-tag">✅ 推荐</span>' : ''}<b>${escHtml(o.title)}</b>${o.score !== undefined ? `<span class="score">${o.score}/10</span>` : ''}<span class="how">${escHtml(o.how)}${o.recommended && o.reason ? `<span class="why">推荐理由：${escHtml(o.reason)}</span>` : ''}</span></div>`,
                )
                .join('')}</div>`,
          )
          .join('')}</div>`
      : '';
  const body = issues.length
    ? `${group('阻塞（先处理）', '⛔', blocking, '#ef4444')}${group('建议', '⚠️', suggest, '#f59e0b')}${group('待定', '⏳', pending, '#94a3b8')}${group('可执行性风险', '🤖', exec, '#6366f1')}`
    : '<div class="clean"><div class="big">✅</div><p>未发现表达不充分之处，规格清晰可执行。</p></div>';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecTaskChain 体检报告</title>
<style>
body{font-family:'PingFang SC','Hiragino Sans GB',sans-serif;margin:40px auto;max-width:820px;padding:0 20px;color:#1e293b;background:#f8fafc;line-height:1.7}
h1{font-size:26px;margin-bottom:4px}
.sub{color:#64748b;font-size:13px;margin-bottom:22px}
.stats{display:flex;gap:14px;margin-bottom:22px;flex-wrap:wrap}
.stat{background:#fff;border-radius:10px;padding:10px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:14px}
.stat b{font-size:18px;margin-right:4px}
.group{background:#fff;border-left:4px solid;border-radius:10px;padding:8px 18px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.group h3{font-size:15px;margin:10px 0;color:#334155;display:flex;align-items:center;gap:8px}
.badge{color:#fff;font-size:12px;border-radius:9px;padding:1px 8px;font-weight:700}
.item{padding:7px 0;border-top:1px solid #f1f5f9}
.item:first-of-type{border-top:none}
.item b{font-size:13px;color:#1d4ed8}
.item p{margin:3px 0 0;font-size:13.5px}
.opt{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;margin:6px 0 0;font-size:13px}
.opt b{font-size:13px;color:#4338ca;white-space:nowrap}
.opt .how{color:#475569;flex:1}
.who{font-size:11px;border-radius:6px;padding:1px 6px;font-weight:700;white-space:nowrap}
.who.ai{background:#e0e7ff;color:#4338ca}
.who.human{background:#fef3c7;color:#b45309}
.who.both{background:#ecfdf5;color:#047857}
.opt.rec{background:#eef2ff;border-color:#c7d2fe}
.rec-tag{font-size:11px;background:#4f46e5;color:#fff;border-radius:6px;padding:1px 6px;font-weight:700;white-space:nowrap}
.score{font-size:11px;background:#f1f5f9;color:#475569;border-radius:6px;padding:1px 6px;font-weight:700;white-space:nowrap}
.opt .why{display:block;color:#6d28d9;font-size:12px;margin-top:2px}
.clean{background:#fff;border-radius:10px;padding:40px 20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.clean .big{font-size:44px}
.clean p{color:#64748b;font-size:14px;margin:8px 0 0}
.tip{color:#64748b;font-size:13px;margin-top:18px;border-top:1px solid #e2e8f0;padding-top:12px}
</style>
</head>
<body>
<h1>🩺 澄清体检报告</h1>
<div class="sub">生成于 ${new Date().toLocaleString('zh-CN')} · 随叫随到的体检，处理权在你</div>
<div class="stats">
  <div class="stat"><b style="color:#ef4444">${blocking.length}</b>⛔ 阻塞</div>
  <div class="stat"><b style="color:#f59e0b">${suggest.length}</b>⚠️ 建议</div>
  <div class="stat"><b style="color:#94a3b8">${pending.length}</b>⏳ 待定</div>
  <div class="stat"><b style="color:#6366f1">${exec.length}</b>🤖 可执行性</div>
</div>
${body}
${issues.length ? '<div class="tip">处理方式：补（改规格） / 给默认值（不吭声按默认走） / 标记 draft（执行前再补） / 无视（自己的队列自己负责）；可执行性风险从方案菜单选一条（✅ 推荐带评分与理由）：改什么 AI 就能做 / 换什么内容 AI 能做 / 人机分工（AI 做闸口内，人做闸口外）；逐项裁决：taskq clarify --task &lt;ID&gt; --decide（y 采纳 / n 换方案 / s 跳过，采纳写回 SPEC.md decisions）</div><div class="tip">澄清留痕：澄清（补正文）后，在 SPEC.md 正文尾部写「## 澄清记录」——逐条列原模糊点 / 备选方案 / 应用的方案与理由；无人值守（自动）模式必写，交互模式用户全程在场可免。CLI 机械修自带留痕：fix 写 frontmatter fix-log、--decide 写 decisions、改前归档 sources/——无需手写。</div>' : ''}
</body>
</html>`;
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
