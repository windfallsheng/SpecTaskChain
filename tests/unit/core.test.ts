import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  buildSpec,
  validateRequired,
  renderSpec,
} from '../../src/core/task-spec';
import {
  detectTaskIssues,
  detectDanglingDeps,
  detectOutputConflicts,
} from '../../src/core/clarify';
import { runAcceptance } from '../../src/core/acceptance';
import { recognizeIntent } from '../../src/core/intent';
import { buildExecutionSequence } from '../../src/core/queue';

describe('task-spec：frontmatter 三必填 + 正文自由', () => {
  const SAMPLE = `---
type: doc
goal: 给三个仓库写迁移文档
output: docs/migration/
acceptance:
  artifacts:
    - path: docs/migration/*.md
      min: 3
  checks:
    - grep -q 回滚 docs/migration/*.md
  review: 每篇覆盖停机/回滚/数据校验
depends-on:
  - 02-xxx
---
正文自由表达`;
  const { data, body } = parseFrontmatter(SAMPLE);
  const spec = buildSpec('01-migration', '/x', data, body, 'general');

  it('解析验收三态：产物/断言/评审', () => {
    expect(spec.acceptance.artifacts).toHaveLength(1);
    expect(spec.acceptance.artifacts[0]).toEqual({ path: 'docs/migration/*.md', min: 3 });
    expect(spec.acceptance.checks).toEqual(['grep -q 回滚 docs/migration/*.md']);
    expect(spec.acceptance.review).toContain('停机');
  });

  it('解析依赖与正文', () => {
    expect(spec.dependsOn).toEqual(['02-xxx']);
    expect(spec.body.trim()).toBe('正文自由表达');
  });

  it('三必填校验：缺验收即缺失', () => {
    const v = validateRequired({ goal: 'x', output: 'y', acceptance: { artifacts: [], checks: [], review: '' } });
    expect(v.ok).toBe(false);
    expect(v.missing.join()).toContain('acceptance');
  });

  it('renderSpec 生成可回读的 SPEC.md（往返一致）', () => {
    const rendered = renderSpec({
      type: 'doc',
      goal: '写文档',
      output: 'docs/',
      acceptance: { artifacts: [{ path: 'docs/*.md', min: 2 }], checks: ['grep -q 回滚 docs/*.md'], review: '覆盖三节' },
      dependsOn: ['02-xxx'],
    });
    const r2 = parseFrontmatter(rendered);
    const s2 = buildSpec('x', '/x', r2.data, r2.body, 'general');
    expect(s2.acceptance.artifacts[0].min).toBe(2);
    expect(s2.dependsOn).toEqual(['02-xxx']);
  });
});

describe('clarify：两级信号 + 分级报告', () => {
  it('模糊词与指代不明被拦截（建议级）', () => {
    const spec = buildSpec('t1', '/x', {
      type: 'general', goal: '把文档完善一下', output: 'docs/', acceptance: { review: '做好' },
    }, '那几个文件都要整理', 'general');
    const issues = detectTaskIssues(spec);
    const msgs = issues.map((i) => i.message).join('|');
    expect(msgs).toContain('完善');
    expect(msgs).toContain('那几个');
  });

  it('依赖悬空（阻塞级）与产出冲突（阻塞级）', () => {
    const specA = buildSpec('a', '/x', { goal: 'A', output: 'docs/', acceptance: { review: 'r' }, 'depends-on': ['ghost'] }, '', 'general');
    const specB = buildSpec('b', '/x', { goal: 'B', output: 'docs/', acceptance: { review: 'r' } }, '', 'general');
    const queue = { tasks: [specA, specB], modules: [] };
    expect(detectDanglingDeps(queue)[0].level).toBe('blocking');
    expect(detectOutputConflicts(queue)[0].level).toBe('blocking');
  });

  it('无问题报告为清晰可执行', () => {
    const spec = buildSpec('t1', '/x', { role: 'document-writer', goal: '写迁移文档', output: 'docs/', acceptance: { artifacts: [{ path: 'docs/*.md' }] } }, '', 'general');
    expect(detectTaskIssues(spec)).toHaveLength(0);
  });
});

describe('acceptance：验收三态门禁', () => {
  it('产物缺失 → 未通过', () => {
    const r = runAcceptance(
      { artifacts: [{ path: '不存在目录/*.md', min: 1 }], checks: [], review: '' },
      '/tmp/definitely-not-exists-stc'
    );
    expect(r.passed).toBe(false);
    expect(r.artifacts[0].ok).toBe(false);
  });
  it('断言退出码非 0 → 未通过', () => {
    const r = runAcceptance({ artifacts: [], checks: ['exit 3'], review: '' }, '/tmp');
    expect(r.passed).toBe(false);
    expect(r.checks[0].exitCode).toBe(3);
  });
  it('review 有内容但无 verdict → 通过（评审门禁软）', () => {
    const r = runAcceptance({ artifacts: [], checks: ['true'], review: '覆盖三节' }, '/tmp');
    expect(r.passed).toBe(true);
  });
});

describe('intent：口语入口', () => {
  it('「澄清上面的内容」→ clarify', () => {
    expect(recognizeIntent('澄清上面的内容').intent).toBe('clarify');
  });
  it('「建个任务：写文档」→ new', () => {
    expect(recognizeIntent('建个任务：写文档').intent).toBe('new');
  });
  it('「跑队列」→ run，「看下进度」→ status', () => {
    expect(recognizeIntent('跑队列').intent).toBe('run');
    expect(recognizeIntent('看下进度').intent).toBe('status');
  });
  it('「重跑 34-cshidaima」→ reset 且提取目标；「重新执行」→ reset 无目标不猜', () => {
    const r = recognizeIntent('重跑 34-cshidaima');
    expect(r.intent).toBe('reset');
    expect(r.params.target).toBe('34-cshidaima');
    expect(r.fullCommand).toBe('taskq reset 34-cshidaima');
    const noTarget = recognizeIntent('重新执行一下');
    expect(noTarget.intent).toBe('reset');
    expect(noTarget.params.target).toBeUndefined();
  });
  it('「从头再来」→ reset --all --hard；「重跑全部」→ reset --all 软复位', () => {
    const hard = recognizeIntent('从头再来');
    expect(hard.intent).toBe('reset');
    expect(hard.params.target).toBe('--all');
    expect(hard.params.hard).toBe(true);
    expect(hard.fullCommand).toBe('taskq reset --all --hard');
    const soft = recognizeIntent('全部重跑');
    expect(soft.intent).toBe('reset');
    expect(soft.params.target).toBe('--all');
    expect(soft.params.hard).toBeUndefined();
  });
  it('「重置 module-yingxiaomokuai」→ 模块定向；「重跑 batch-002」→ 批次定向；--hard 显式传递', () => {
    expect(recognizeIntent('重置 module-yingxiaomokuai').params.target).toBe('module-yingxiaomokuai');
    expect(recognizeIntent('重跑 batch-002').params.target).toBe('batch-002');
    const h = recognizeIntent('重跑 34-cshidaima --hard');
    expect(h.params.hard).toBe(true);
    expect(h.fullCommand).toBe('taskq reset 34-cshidaima --hard');
  });
  it('「做完了重新跑一遍」→ reset 压过 done；「把 34 从头再来」具体目标优先不误伤全队列', () => {
    expect(recognizeIntent('做完了重新跑一遍').intent).toBe('reset');
    const r = recognizeIntent('把 34-cshidaima 从头再来');
    expect(r.intent).toBe('reset');
    expect(r.params.target).toBe('34-cshidaima');
  });
  it('边界不误吞：「继续跑」「接着跑」「重新开始执行」→ run；「重新建个任务」→ new', () => {
    expect(recognizeIntent('继续跑').intent).toBe('run');
    expect(recognizeIntent('接着跑队列').intent).toBe('run');
    expect(recognizeIntent('重新开始执行').intent).toBe('run');
    expect(recognizeIntent('重新建个任务：写文档').intent).toBe('new');
  });
  it('「建个认证模块」→ new 且量词「个」不进 group（group=认证不吞「个」）', () => {
    const r = recognizeIntent('建个认证模块');
    expect(r.intent).toBe('new');
    expect(r.params.group).toBe('认证');
    const r2 = recognizeIntent('建一个数据模块，写清洗脚本');
    expect(r2.intent).toBe('new');
    expect(r2.params.group).toBe('数据');
  });
  it('「写登录接口，放认证模块」无「建」字也归 new（句式兼底）且 group=认证', () => {
    const r = recognizeIntent('写登录接口，放认证模块');
    expect(r.intent).toBe('new');
    expect(r.params.group).toBe('认证');
  });
});

describe('queue：扫描与接力顺序', () => {
  it('依赖任务排在依赖之后，无依赖按目录序', () => {
    const mk = (id: string, deps: string[]) =>
      buildSpec(id, `/x/${id}`, { goal: id, output: 'o/', acceptance: { review: 'r' }, ...(deps.length ? { 'depends-on': deps } : {}) }, '', 'general');
    const queue = { tasks: [mk('01-a', []), mk('02-b', ['01-a']), mk('03-c', [])], modules: [] };
    const seq = buildExecutionSequence(queue);
    const idx = (id: string) => seq.findIndex((e) => e.spec.id === id);
    expect(idx('01-a')).toBeLessThan(idx('02-b'));
  });
  it('模块子任务带 module 标记（共享约束随行）', () => {
    const mod = {
      id: 'mod-发布',
      constraintsPath: '/x/constraints.md',
      constraints: '统一格式',
      subtasks: [buildSpec('01-sub', '/x/mod/01-sub', { goal: 's', output: 'o/', acceptance: { review: 'r' } }, '', 'general')],
    };
    const seq = buildExecutionSequence({ tasks: [], modules: [mod] });
    expect(seq).toHaveLength(1);
    expect(seq[0].module?.constraints).toBe('统一格式');
  });
});
