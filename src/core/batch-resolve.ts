// 批次解析（语义层）：把 ask 识别出的 BatchRef 落定为真实批次
// 三层递进：精确编号（存在性校验）→ 相对位次（最新/上一/最早）→ 特征短语语义扫描（扫批次内容打分）
// 未决不猜：输出候选清单（批次 ID + 名称 + 任务数 + 命中证据），交给宿主 AI / 用户挑
import { QueueScan, batchKey, latestBatchId, resolveDefaultBatch } from './queue';
import { BatchRef } from './intent';
import { TaskQConfig } from './config';

export interface BatchCandidate {
  id: string;
  name?: string;
  purpose?: string;
  taskCount: number;
  evidence: string[]; // 命中证据（任务名/目标片段，≤3 条）
  score: number;
}

export interface BatchResolution {
  id: string;                    // 落定批次 ID；未决时为空串（看 candidates）
  matchedBy?: 'exact' | 'latest' | 'prev' | 'first' | 'semantic' | 'default';
  note?: string;                 // 解释（语义命中证据 / 未决原因）
  candidates?: BatchCandidate[]; // 未决时：候选清单
}

/** 候选清单渲染（NEEDS_INFO 块）：给宿主 AI / 用户挑 */
export function renderBatchCandidates(r: BatchResolution): string {
  const lines: string[] = [];
  lines.push('[TASKQ_NEEDS_INFO]');
  lines.push(`${r.note || '批次未确定'}：`);
  for (const c of r.candidates || []) {
    lines.push(`- ${c.id}${c.name ? `「${c.name}」` : ''}（${c.taskCount} 个任务）${c.evidence[0] ? `——${c.evidence[0]}` : ''}`);
  }
  if (!(r.candidates || []).length) lines.push('- 队列里还没有任何批次（先 taskq new 建第一个任务会自动创建 batch-001）');
  lines.push('确认后请重新表述：taskq ask "……到 <批次名/批次号>"，或直接 taskq execute --batch <批次ID>。');
  lines.push('[/TASKQ_NEEDS_INFO]');
  return lines.join('\n');
}

/** 全批次候选（未决兜底：无命中证据也把家底亮出来） */
function allCandidates(batches: QueueScan['batches']): BatchCandidate[] {
  return batches
    .map((b) => ({
      id: b.id,
      name: b.name,
      purpose: b.purpose,
      taskCount: b.tasks.length + b.modules.reduce((n, x) => n + x.subtasks.length, 0),
      evidence: [],
      score: 0,
    }))
    .sort((a, b) => batchKey(a.id) - batchKey(b.id));
}

/**
 * 批次落定：
 * - 无引用 → 缺省最新批（新任务落这里，run 默认跑这里）
 * - 精确 → 存在性校验（不存在 → 候选清单）
 * - 相对 → 按数字序定位（prev 只有一个批时落它并注明）
 * - 特征短语 → 语义打分：完整包含 +3 / 双字滑窗重叠 +1，唯一最高分落定；平局或零命中 → 候选清单
 */
export function resolveBatchRef(cfg: TaskQConfig, queue: QueueScan, ref?: BatchRef): BatchResolution {
  const batches = [...queue.batches].sort((a, b) => batchKey(a.id) - batchKey(b.id));
  const ids = batches.map((b) => b.id);
  const latest = latestBatchId(batches);
  // 无引用 = 默认落「最近使用批次」（state 记忆）> 最新批次
  if (!ref) return { id: resolveDefaultBatch(cfg, batches) || '', matchedBy: 'default' };
  if (ref.kind === 'exact') {
    if (ids.includes(ref.id || '')) return { id: ref.id!, matchedBy: 'exact' };
    return { id: '', candidates: allCandidates(batches), note: `批次「${ref.id}」不存在，现有批次` };
  }
  if (!batches.length) {
    return { id: '', candidates: [], note: '队列还没有任何批次' };
  }
  if (ref.kind === 'latest') return { id: latest!, matchedBy: 'latest' };
  if (ref.kind === 'first') return { id: batches[0].id, matchedBy: 'first' };
  if (ref.kind === 'prev') {
    if (batches.length >= 2) return { id: batches[batches.length - 2].id, matchedBy: 'prev' };
    return { id: latest!, matchedBy: 'prev', note: `队列只有 ${latest} 这一个批次，「上一批」= 它` };
  }
  // fuzzy：语义扫描（批次号/名称/意图/任务名/任务目标/模块名）
  const phrase = ref.phrase || '';
  if (!phrase) return { id: latest || '', matchedBy: 'latest' };
  const scored = batches
    .map((b) => {
      const evidence: string[] = [];
      let score = 0;
      const scan = (text: string | undefined, label: string) => {
        if (!text || evidence.length >= 3) return;
        const idx = text.indexOf(phrase);
        if (idx >= 0) {
          score += 3;
          evidence.push(`${label}：…${text.slice(Math.max(0, idx - 6), idx + phrase.length + 14)}…`);
          return;
        }
        if (phrase.length >= 2) {
          // 双字滑窗：短语与批次文本有 2 字重叠算弱证据（「预算季」vs「季度预算」）
          for (let i = 0; i <= phrase.length - 2; i++) {
            const gram = phrase.slice(i, i + 2);
            const j = text.indexOf(gram);
            if (j >= 0) {
              score += 1;
              evidence.push(`${label}：…${text.slice(Math.max(0, j - 4), j + gram.length + 8)}…`);
              return;
            }
          }
        }
      };
      scan(b.id, '批次号');
      scan(b.name, '名称');
      scan(b.purpose, '意图');
      for (const t of b.tasks) {
        scan(t.name, '任务名');
        scan(t.goal, '目标');
      }
      for (const mm of b.modules) scan(mm.name || mm.id, '模块');
      return {
        id: b.id,
        name: b.name,
        purpose: b.purpose,
        taskCount: b.tasks.length + b.modules.reduce((n, x) => n + x.subtasks.length, 0),
        evidence: evidence.slice(0, 3),
        score,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1) {
    return { id: scored[0].id, matchedBy: 'semantic', note: `语义命中「${phrase}」→ ${scored[0].id}（${scored[0].evidence[0] || '命中批次内容'}）` };
  }
  if (scored.length > 1 && scored[0].score > scored[1].score) {
    return { id: scored[0].id, matchedBy: 'semantic', note: `语义命中「${phrase}」→ ${scored[0].id}（得分 ${scored[0].score}，最高）` };
  }
  if (scored.length > 1) {
    return { id: '', candidates: scored, note: `「${phrase}」命中多个批次，得分并列，请确认` };
  }
  return { id: '', candidates: allCandidates(batches), note: `「${phrase}」未命中任何批次，现有批次` };
}
