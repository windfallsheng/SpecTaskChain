// ask 意图识别：词典匹配为主（口语入口，零学习成本）
// 宿主 AI 负责指代消解（「上面的内容」→ 文件路径），CLI 负责意图 + 参数提取 + 精确执行
export type IntentId = 'new' | 'clarify' | 'run' | 'execute' | 'pipeline' | 'split' | 'init' | 'status' | 'report' | 'list' | 'done' | 'reset' | 'help';

export interface IntentResult {
  intent: IntentId;
  confidence: number;
  params: { taskId?: string; taskName?: string; group?: string; file?: string; target?: string; hard?: boolean };
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
    case 'execute': best.fullCommand = 'taskq execute'; break;
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
