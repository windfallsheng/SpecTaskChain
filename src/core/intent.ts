// ask 意图识别：词典匹配为主（口语入口，零学习成本）
// 宿主 AI 负责指代消解（「上面的内容」→ 文件路径），CLI 负责意图 + 参数提取 + 精确执行
export type IntentId = 'new' | 'clarify' | 'run' | 'execute' | 'pipeline' | 'split' | 'init' | 'status' | 'report' | 'list' | 'done' | 'reset' | 'fix' | 'help';

export interface IntentResult {
  intent: IntentId;
  confidence: number;
  params: { taskId?: string; taskName?: string; group?: string; file?: string; target?: string; hard?: boolean; batchSize?: number; batchRef?: BatchRef };
  fullCommand: string;
  notes: string[];
}

const INTENTS: { intent: IntentId; triggers: string[]; patterns: RegExp[]; base: number }[] = [
  {
    // 重跑复位：最高优先级——「重跑/重新执行」信号极强，必须压过 done 的「做完了重新跑」复合句；
    // 边界：「继续跑/接着跑」无「重」字归 run，「重新建任务/重建任务」含「建」字归 new，互不误吞
    intent: 'reset',
    base: 74,
    triggers: ['重新执行', '从头再来', '全部重来', '重新跑', '再跑一遍', '重跑', '重做', '重新做', '重来', '复位', '重置', 'reset'],
    patterns: [/重(?:新)?(?:跑|执行|做|来)/, /从头再来/, /全部重来/, /再跑一遍/, /复(?:位|置)/],
  },
  {
    intent: 'clarify',
    base: 70,
    triggers: ['澄清', '帮我澄清', '检查规格', '看看规格', '写得行不行', '写清楚了吗', '规格有没有问题', 'clarify'],
    patterns: [/澄清(?:一下)?(.+)?/, /检查(?:一下)?(.+)规格/, /(.+)写(?:得|的)(?:行不行|清楚了吗)/],
  },
  {
    // 端到端流水线：素材进 → 任务出 → 执行完——「跑流水线/一条龙/端到端」信号明确，独立于 run 的单任务接力
    intent: 'pipeline',
    base: 68,
    triggers: ['流水线', 'pipeline', '端到端', '一条龙'],
    patterns: [/流水线/, /一条龙/],
  },
  {
    // 文档拆任务：拆分是宿主 AI 的语义活（CLI 读文档钉边界），「拆分/切分」含建任务的近义但动作不同，须独立成意图
    intent: 'split',
    base: 66,
    triggers: ['拆分', '切分', '拆任务', '切任务', '拆文档', 'split'],
    patterns: [/拆(?:分|任务|文档)/, /切(?:分|任务)/],
  },
  {
    // 批次接力：run 的批量化（一次领 N 个完整 prompt）——「批量/一次领」是关键信号，单独「执行」仍归 run
    intent: 'execute',
    base: 66,
    triggers: ['批量执行', '批量跑', '批量接力', '一次领', '领任务', 'execute'],
    patterns: [/批量(?:执行|跑|接力)/, /一次领/],
  },
  {
    intent: 'new',
    base: 66,
    triggers: ['建个任务', '新建任务', '加个任务', '加任务', '创建任务', '新增任务', '添加任务', '来一个任务', '建个', '加个', '建一个', '加一个'],
    patterns: [/(?:建|加|创建|新增|添加)(?:个|一个)?任务[:：]?(.*)/, /新建(.+)任务/, /(?:放到|放入|放|加入|入)([^\s，,。？?]{1,20})模块/],
  },
  {
    intent: 'run',
    base: 64,
    triggers: ['跑队列', '开始执行', '跑起来', '开始跑', '执行队列', 'run', '继续接力', '接着跑', '继续跑'],
    patterns: [/^(?:跑|执行)(?:队列|任务)?$/, /继续(?:跑|接力)/],
  },
  {
    intent: 'status',
    base: 62,
    triggers: ['什么状态', '进度', '进展如何', '队列状态', 'status', '看下进度', '现在到哪了'],
    patterns: [/(?:队列)?(?:状态|进度)/],
  },
  {
    intent: 'report',
    base: 62,
    triggers: ['出个报告', '生成报告', '执行报告', '队列报告', 'report'],
    patterns: [/出?个?(?:执行|队列)?报告/],
  },
  {
    intent: 'list',
    base: 60,
    triggers: ['有哪些任务', '任务清单', '列出任务', 'list'],
    patterns: [/有哪些任务/, /任务清单/],
  },
  {
    intent: 'done',
    base: 60,
    triggers: ['完成了', '做完了', '登记验收', '任务完成'],
    patterns: [/(.+)完成了/, /(.+)做完了/],
  },
  {
    // 初始化：低优先级兜底（base 最低），英文 init 用词边界防「initialization」误吞
    intent: 'init',
    base: 58,
    triggers: ['初始化'],
    patterns: [/初始化/, /\binit\b/i],
  },
];

/** 中文数字映射（口语批次量词）：一~十，两=二 */
const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * 提取批次大小（execute 专属）：「一次领 5 个」「批量执行三个」「每批 4 个」「--batch-size 8」
 * 「个」字锚点防误吞任务 ID（「批量执行任务34」无「个」字 → undefined，34 归 taskId）
 */
export function parseBatchSize(input: string): number | undefined {
  const explicit = input.match(/--batch-size\s*=?\s*(\d+)/i);
  if (explicit) return Math.max(1, parseInt(explicit[1], 10));
  const m = input.match(/(?:一次领|每批|每一批|批量(?:执行|跑|接力)|领|跑)\s*(\d+|[一二两三四五六七八九十])\s*个/);
  if (!m) return undefined;
  if (/^\d+$/.test(m[1])) return Math.max(1, parseInt(m[1], 10));
  return CN_DIGIT[m[1]];
}

// ========== 复合意图编排（参考 speccore ask 模式4：多动作词 + 时序词 → pipeline 编排）==========

/** 编排动作词（taskq 命令域）：同一意图的多个词只取最早出现位，出现位置决定步骤顺序 */
const ACTION_WORDS: { words: string[]; intent: IntentId }[] = [
  { words: ['澄清', '体检', '检查'], intent: 'clarify' },
  { words: ['拆分', '切分', '拆任务'], intent: 'split' },
  { words: ['新建', '建任务', '创建任务', '加任务'], intent: 'new' },
  { words: ['修复'], intent: 'fix' },
  { words: ['执行', '接力', '跑起来'], intent: 'execute' },
  { words: ['报告', '复盘'], intent: 'report' },
  { words: ['归档', '验收'], intent: 'done' },
];

/** 时序/并列连接词：把多个动作串成编排（「并」「再」等单字词要求多动作才有意义，检测在动作数≥2 之后） */
const TIMING_WORDS = ['然后', '接着', '再', '最后', '之后', '并且', '并', '还要', '同时', '先'];

export interface OrchestrationStep {
  order: number;
  intent: IntentId;
  label: string;      // 中文步骤名
  explanation: string; // 该步做什么
  gate: boolean;      // 拦停点（交互模式停下问用户；--gate auto 自动通过）
}

export interface Orchestration {
  steps: OrchestrationStep[];
  batchRef?: BatchRef; // 模板变量：批次引用（宽口径：精确/相对位次/特征短语，语义层交给 batch-resolve）
  batchSize?: number;  // 模板变量：批量大小（「一次领 5 个」→ 5）
  auto: boolean;       // 「全自动/别停/不用问」→ 非交互模式
}

/** 批次引用（宽口径）：精确编号 / 相对位次（最新/上一/最早）/ 特征短语（语义层交给 batch-resolve 扫描批次内容） */
export interface BatchRef {
  id?: string;                   // 精确批次 ID（batch-XXX）
  kind: 'exact' | 'latest' | 'prev' | 'first' | 'fuzzy';
  phrase?: string;               // fuzzy 专属：语义特征词（「预算那批」→ 预算）
}

/** 特征词去壳：「加到预算那」→ 预算；剥尽只剩虚词 → 空串（视作指当前批） */
function stripBatchDecorators(raw: string): string {
  let p = raw;
  for (;;) {
    const n = p
      .replace(/^(?:导入到|导入|并入|加入|加到|加进|放进|放到|放入|建到|建在|创建到|移入)/, '')
      .replace(/^(?:那个|这个|进|入|到|加|放|往|在|给|向|把|将|上|的)/, '')
      .replace(/(?:那个|这个|这|那|的|里|里面)$/, '');
    if (n === p) break;
    p = n;
  }
  return p.trim();
}

/** 批次引用解析（三层）：精确（批次002/第3批）→ 相对（最新/上一/最早）→ 特征短语（语义层） */
export function parseBatchRef(input: string): BatchRef | undefined {
  // 1) 精确编号：批次002 / 批次 2 / batch-002
  const m = input.match(/批次\s*0*(\d{1,3})/);
  if (m) return { kind: 'exact', id: `batch-${m[1].padStart(3, '0')}` };
  const b = input.match(/batch-(\d{3})/i);
  if (b) return { kind: 'exact', id: `batch-${b[1]}` };
  // 2) 中文数字编号：第二批 / 第3批
  const cn = input.match(/第([一二两三四五六七八九十\d]+)\s*批/);
  if (cn) {
    const n = /^\d+$/.test(cn[1]) ? parseInt(cn[1], 10) : CN_DIGIT[cn[1]];
    if (n) return { kind: 'exact', id: `batch-${String(n).padStart(3, '0')}` };
  }
  // 3) 相对位次（先于特征提取，防「上一批」被当特征词）
  if (/(?:最新|最近|当前|现在)(?:的)?(?:一|这|那)?批/.test(input)) return { kind: 'latest' };
  if (/(^|[^加并])上(?:一|个|次|回|头)?(?:的)?(?:那|这)?批|前(?:一|个|头)?(?:的)?(?:那|这)?批|刚才(?:的)?(?:那|这)?批/.test(input)) return { kind: 'prev' };
  if (/(?:最|头|首)(?:早|先)?(?:的)?(?:一|个|这|那)?批/.test(input)) return { kind: 'first' };
  // 4) 特征短语（排除「批量」语境）：批字前的词，剥壳后交给语义扫描
  const ctx = input.replace(/批量(?:执行|跑|接力|一下)?/g, ' ');
  const f = ctx.match(/([\u4e00-\u9fa5a-zA-Z0-9_-]{1,12})批(?:次)?/);
  if (f) {
    const phrase = stripBatchDecorators(f[1]);
    if (phrase) return { kind: 'fuzzy', phrase };
    return { kind: 'latest' }; // 只剩虚词（「那批」）→ 当前语境批
  }
  return undefined;
}

/** 复合编排检测：≥2 个动作词 + 时序词 → 编排步骤（按语序 = 执行序）；否则 null（走单意图） */
export function detectOrchestration(input: string): Orchestration | null {
  const hits: { pos: number; intent: IntentId }[] = [];
  for (const a of ACTION_WORDS) {
    let pos = -1;
    for (const w of a.words) {
      const i = input.indexOf(w);
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    }
    if (pos >= 0) hits.push({ pos, intent: a.intent });
  }
  if (hits.length < 2) return null;
  const hasTiming = TIMING_WORDS.some((t) => input.includes(t));
  if (!hasTiming) return null;
  // 「先X再Y」：先字后面的动作提到最前（语序不等于执行序的唯一边界：「执行前先澄清」→ 澄清在前）
  for (const a of ACTION_WORDS) {
    for (const w of a.words) {
      if (new RegExp(`先\\s*${w}`).test(input)) {
        const h = hits.find((x) => x.intent === a.intent);
        if (h) h.pos = -999;
      }
    }
  }
  // 同意图去重（「澄清并体检」算一步）+ 按出现位置排序（用户语序即执行序）
  const seen = new Set<IntentId>();
  const ordered = hits
    .filter((h) => (seen.has(h.intent) ? false : (seen.add(h.intent), true)))
    .sort((x, y) => x.pos - y.pos);
  if (ordered.length < 2) return null;
  // 步骤知识表：label/说明/拦停点（编排域收敛，非编排域的意图不进表）
  const LABELS: Record<string, { label: string; explanation: string; gate: boolean }> = {
    clarify: { label: '体检澄清', explanation: 'taskq clarify 全量体检；阻塞项先修（taskq fix --yes 机械项），非全绿不往下走', gate: true },
    split: { label: '拆分任务', explanation: '素材拆成任务草案落盘（单独任务 + 模块级任务）；拆分清单给用户确认', gate: true },
    new: { label: '新建任务', explanation: '对话成规格，draft 骨架落盘', gate: false },
    fix: { label: '自动修复', explanation: 'taskq fix --yes 应用机械修复', gate: false },
    execute: { label: '接力执行', explanation: 'taskq execute 批量接力，宿主 AI 循环续跑直到队列清空', gate: true },
    report: { label: '生成报告', explanation: 'taskq report 执行留痕复盘', gate: false },
    done: { label: '归档收尾', explanation: 'taskq done 验收归档', gate: false },
  };
  return {
    steps: ordered.map((h, i) => ({ order: i + 1, intent: h.intent, ...LABELS[h.intent] })),
    batchRef: parseBatchRef(input),
    batchSize: parseBatchSize(input),
    auto: /(?:全自动|自动完成|自动跑|别停|不用问|不需要确认|一路到底|无需确认)/.test(input),
  };
}

/** 识别意图：词典匹配 + 优先级加成（按 triggers 定义序） */
export function recognizeIntent(input: string): IntentResult {
  const lower = input.toLowerCase();
  const notes: string[] = [];
  let best: IntentResult | null = null;
  for (const def of INTENTS) {
    let confidence = 0;
    for (const t of def.triggers) {
      if (lower.includes(t.toLowerCase())) {
        confidence = Math.max(confidence, def.base + Math.min(t.length, 10));
      }
    }
    // 句式兼底（同域 patterns）：词典未命中时句法命中也能进候选（如「写登录接口，放认证模块」无「建」字也归 new）
    for (const p of def.patterns) {
      if (p.test(input)) confidence = Math.max(confidence, def.base + 4);
    }
    if (confidence >= def.base && (!best || confidence > best.confidence)) {
      const params: IntentResult['params'] = {};
      const m = input.match(/(?:task|任务)[- _]?([a-zA-Z0-9_-]+)/i);
      if (m) params.taskId = m[1];
      const fm = input.match(/--file\s+(\S+)/);
      if (fm) params.file = fm[1];
      params.batchRef = parseBatchRef(input); // 批次引用（宽口径）：execute/run/report/list/status/split 通用
      // 创建命名：--name X / --group X / 「叫/名为 X 的」/ 「X 模块」
      const nm = input.match(/--name\s+(\S+)/);
      if (nm) params.taskName = nm[1];
      const gm = input.match(/--group\s+(\S+)/);
      if (gm) params.group = gm[1];
      if (!params.taskName) {
        const cm = input.match(/(?:叫|名为|命名为)[:：]?\s*([^\s，,。？?]+)/);
        if (cm) params.taskName = cm[1];
      }
      if (!params.group) {
        // 量词「个/一个」不进捕获组：「建个认证模块」→ group=认证，不吞「个」
        const mm = input.match(/(?:放到|放入|放|加入|入|建|到|进)(?:个|一个)?([^\s，,。？?]{1,20})模块/);
        if (mm) params.group = mm[1];
      }
      // execute 专属：批次大小（「一次领 5 个」→ batchSize=5）；无数量信号留空走默认 3
      if (def.intent === 'execute') {
        const n = parseBatchSize(input);
        if (n) params.batchSize = n;
      }
      // reset 专属：目标（任务 ID / 模块 / 批次 / --all）+ --hard。
      // 具体目标与全局词同时出现时具体目标优先（「把 34 从头再来」只复位 34，不误伤全队列）
      if (def.intent === 'reset') {
        const idHit = input.match(/(?:task|任务)[- _]?([a-zA-Z0-9_-]+)|(\d{2,3}-[a-z0-9_-]+|module-[a-z0-9_-]+|batch-\d+)/i);
        const hardAll = /(?:从头再来|全部重来)/.test(input);
        const softAll = /(?:重跑全部|全部重跑)/.test(input);
        if (idHit) params.target = idHit[1] || idHit[2];
        else if (hardAll) { params.target = '--all'; params.hard = true; }
        else if (softAll) params.target = '--all';
        if (/--hard|彻底重来|连留痕/.test(input)) params.hard = true;
      }
      best = { intent: def.intent, confidence, params, fullCommand: '', notes };
    }
  }
  if (!best) {
    best = { intent: 'help', confidence: 0, params: {}, fullCommand: '', notes: ['未识别到意图，可用：taskq help'] };
  }
  // 组装 CLI 命令
  const p = best.params;
  switch (best.intent) {
    case 'clarify':
      best.fullCommand = p.file ? `taskq clarify --file ${p.file}` : p.taskId ? `taskq clarify --task ${p.taskId}` : 'taskq clarify';
      break;
    case 'new':
      best.fullCommand = 'taskq new';
      if (input.includes('任务')) best.notes.push('建任务建议：taskq new "任务描述"（AI 生成规格草案，你确认后落盘）');
      if (p.taskName || p.group) {
        const parts: string[] = [];
        if (p.taskName) parts.push(`--name ${p.taskName}`);
        if (p.group) parts.push(`--group ${p.group}`);
        best.notes.push(`已识别创建命名：${parts.join(' ')}（目录名走 slug 化，中文自动转全拼）`);
      }
      break;
    case 'run': best.fullCommand = 'taskq run'; break;
    case 'execute':
      best.fullCommand = p.batchSize ? `taskq execute --batch-size ${p.batchSize}` : 'taskq execute';
      if (p.batchSize) best.notes.push(`已识别批次大小：一次领取 ${p.batchSize} 个任务`);
      break;
    case 'pipeline': best.fullCommand = 'taskq pipeline'; break;
    case 'split': best.fullCommand = 'taskq split'; break;
    case 'init': best.fullCommand = 'taskq init'; break;
    case 'status': best.fullCommand = 'taskq status'; break;
    case 'report': best.fullCommand = 'taskq report'; break;
    case 'list': best.fullCommand = 'taskq list'; break;
    case 'done':
      best.fullCommand = p.taskId ? `taskq done ${p.taskId}` : 'taskq done <task-id>';
      break;
    case 'reset': {
      const parts = ['taskq reset'];
      if (p.target || p.taskId) parts.push(p.target || p.taskId!);
      if (p.hard) parts.push('--hard');
      best.fullCommand = parts.join(' ');
      break;
    }
    default: best.fullCommand = 'taskq help';
  }
  return best;
}
