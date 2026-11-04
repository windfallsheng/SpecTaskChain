// taskq history：操作轨迹——队列写操作的时间线回放（何时建了任务 / 领取 / 验收 / 复位）
// 与 report 分工：report 按任务聚合总账（这个任务的一生），history 按时间线回放流水（这个队列的一天）
// 只记写操作（new/run/execute/done/reset），只读命令不记——流水不被刷屏淹没
import { TaskQConfig } from '../core/config';
import { readOpLog } from '../core/oplog';

const CMD_LABEL: Record<string, string> = {
  new: '新建',
  run: '领取',
  execute: '批量领取',
  done: '验收',
  reset: '复位',
};

export function historyCommand(cfg: TaskQConfig, opts: { batch?: string; limit?: number } = {}): string {
  const all = readOpLog(cfg, { batch: opts.batch });
  const entries = opts.limit ? all.slice(0, opts.limit) : all;
  const scope = opts.batch ? `批次 ${opts.batch}` : '全部批次';
  if (!entries.length) {
    return `📜 操作轨迹（${scope}）\n\n还没有操作记录。跑一次 taskq new 建任务、taskq run 领取执行，轨迹就开始了。`;
  }
  const lines = entries.map((e) => {
    const when = e.ts.replace('T', ' ').slice(0, 19) + ' UTC';
    const label = CMD_LABEL[e.cmd] || e.cmd;
    const target = e.target ? ` ${e.target}` : '';
    const batchTag = e.batch ? `  [${e.batch}]` : '';
    const note = e.note ? ` — ${e.note}` : '';
    return `${when}  ${label}${target}${batchTag}${note}`;
  });
  const truncated = all.length > entries.length
    ? `\n\n（共 ${all.length} 条，显示最近 ${entries.length} 条——taskq history --limit 加餐）`
    : '';
  return `📜 操作轨迹（${scope}，最近 ${entries.length} 条，倒序）\n\n${lines.join('\n')}${truncated}`;
}
