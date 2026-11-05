// HTML 引导页：init 自动生成 + taskq help guide --html 随时再生成
// 与 PANEL.html 同院（queue/reports/ 下），同一视觉语言；单文件零依赖，双击即看
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { DARK_CSS, SCAN_CSS, SCAN_LAYERS } from './html-theme';
import { TaskQConfig } from './config';
import { readVersion } from './version';

/** HTML 转义：路径与版本来自环境（不受控），打开不执行注入内容 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 命令速查表（网页两列版；终端全参数版见 taskq help） */
const COMMANDS: Array<[string, string]> = [
  ['init', '初始化队列骨架 + 宿主接力规则与 SKILL 入口'],
  ['new', '建任务（对话成规格：AI 生成草案，你确认）'],
  ['split', '文档拆任务（只出 goal，验收留到澄清点头）'],
  ['pipeline', '端到端流水线（素材→拆分→澄清→执行→收尾）'],
  ['clarify', '随叫随到的体检（写完查 / 建链查 / 翻车查）'],
  ['run', '无人值守接力执行（断了接着跑，直到队列清空）'],
  ['execute', '批次接力（一次领取 N 个任务的完整 prompt）'],
  ['reset', '重跑复位（软 = 调整补充，--hard = 从头再来）'],
  ['done', '验收登记（产物/断言/评审三态门禁）'],
  ['list', '队列清单（按批次分组，三扇窗筛选）'],
  ['status', '队列总览（--panel 生成 HTML 可视化面板）'],
  ['report', '队列报告（执行留痕，有账可查）'],
  ['ask', '口语入口（「建个任务…」「澄清…」「跑队列」）'],
];

/** 引导页 HTML（纯函数，可测） */
export function guideHtml(cfg: Pick<TaskQConfig, 'queueDir'>): string {
  const v = esc(readVersion());
  const queueDir = esc(cfg.queueDir);
  const time = new Date().toLocaleString('zh-CN');
  const cmdRows = COMMANDS.map(([c, d]) => `<tr><td class="cmd">taskq ${c}</td><td>${d}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecTaskChain 引导页</title>
<style>
${DARK_CSS}${SCAN_CSS}
body{margin:40px auto;max-width:880px;padding:0 20px;position:relative;z-index:1}
h1{font-size:28px;margin-bottom:2px}
.sub{color:var(--muted);font-size:13px;margin-bottom:8px}
.slogan{color:var(--text);font-size:14px;margin-bottom:28px;border-left:3px solid var(--cyan);padding-left:10px}
h2{margin-top:34px;font-size:19px;border-bottom:1px solid var(--border);padding-bottom:8px}
h3{font-size:15px;margin:0 0 8px;color:var(--text)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.step{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.step .n{flex:none;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--green));color:#0b1929;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:2px}
.step b{font-size:14px}
.step p{margin:4px 0 0;font-size:13px;color:var(--muted)}
.zone{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin:10px 0}
.zone ul{margin:4px 0;padding-left:20px;font-size:14px}
.zone li{margin:3px 0}
.zone p{margin:4px 0;font-size:14px}
.zone .tip{font-size:12.5px;color:var(--muted)}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:rgba(125,211,252,.08);color:var(--cyan);border:1px solid var(--border);border-radius:6px;padding:1px 6px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;font-size:13.5px;border-bottom:1px solid rgba(14,165,233,.08)}
th{background:rgba(14,165,233,.08);color:var(--cyan);font-weight:600}
td.cmd{white-space:nowrap;font-family:'SF Mono',Menlo,monospace;font-size:12.5px;color:var(--cyan);font-weight:600;width:150px}
ul.concepts{padding-left:20px;font-size:14px}
ul.concepts li{margin:5px 0}
.faq{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:6px 18px}
.faq p{margin:10px 0;font-size:14px}
.faq b{color:var(--cyan)}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px}
</style>
</head>
<body>
${SCAN_LAYERS}
<h1>🧭 SpecTaskChain 引导页</h1>
<div class="sub">队列：${queueDir} · v${v} · ${time}</div>
<div class="slogan">Spec 保证「做对」（验收先行），Chain 保证「干完」（接力 + 断点续跑）。</div>

<h2>上手三步</h2>
<div class="steps">
  <div class="step"><div class="n">1</div><div><b>taskq init</b><p>初始化队列骨架（已做可跳过）</p></div></div>
  <div class="step"><div class="n">2</div><div><b>taskq new "任务描述" --type doc</b><p>建任务：AI 生成规格草案，你确认</p></div></div>
  <div class="step"><div class="n">3</div><div><b>taskq clarify → taskq run → taskq done</b><p>澄清体检 → 无人值守接力 → 验收登记；循环 run 直到「队列已清空」，最后 taskq report 复盘</p></div></div>
</div>

<h2>项目目录布局（三类目录，各司其职）</h2>
<div class="zone">
  <h3>① 队列本体 —— taskq 唯一的管理区，其余目录一概不碰</h3>
  <ul>
    <li><b>queue/</b> — 批次 batch-NNN / 任务 {NN}-{slug}/SPEC.md / 模块 module-{slug}/ / overview 计划与报告（PLAN.md · plans/ · reports/）</li>
    <li><b>.taskchain/</b> — state.json 账本 + TASK_TYPES 类型 + ROLES 角色 + TEMPLATES 模板</li>
  </ul>
</div>
<div class="zone">
  <h3>② 产出院落 —— 每个任务目录内 outputs/，产出与任务同住</h3>
  <p>任务做完，产出默认进 <b>该任务目录内 outputs/</b>（queue/{批次}/{任务目录}/outputs/，文档类精确到 {slug}.md）——哪个任务的货一眼即知。模块子任务同理（outputs/ 在子任务目录内）。<b>任务描述里指定的路径或改过的 output 字段永远优先</b>（如「写到 docs/xxx.md」「src/auth/」）。</p>
</div>
<div class="zone">
  <h3>③ 用户自组织区 —— 自由命名，taskq 不认识也不碰</h3>
  <p><b>materials/</b> 素材（split/pipeline 入口）· <b>specs/</b> 手写规格 · <b>logs/</b> 日志 · …随你，素材文档指给 split / pipeline 即可</p>
</div>

<h2>命令速查</h2>
<table>
  <thead><tr><th>命令</th><th>作用</th></tr></thead>
  <tbody>${cmdRows}</tbody>
</table>

<h2>核心概念</h2>
<ul class="concepts">
  <li><b>验收三态：</b>artifacts 产物（文件在不在）+ checks 断言（命令退出码非 0 不算完）+ review 评审（结论要覆盖）——缺一不算完</li>
  <li><b>接力协议：</b>run 输出 [TASKQ_PROMPT] 块 + 退出码；10 接力执行 / 12 拦截 / 0 清空</li>
  <li><b>批次聚焦：</b>新任务落最新批次，run/status 默认最新批次；--batch 点名，--batch all 全批次</li>
  <li><b>断点续跑：</b>进度写 PROGRESS.md，换会话 run 自动注入留痕续做；doing 超 24h 自动重拾</li>
  <li><b>失败重试：</b>attempts 上限 3 次，超限标记 failed 需人工介入（不无限重试）</li>
  <li><b>执行角色：</b>type 管形态，role 管专业（内置 10 角色，自定义放 .taskchain/ROLES/）</li>
</ul>

<h2>任务规格字段速览（SPEC.md 人话版）</h2>
<div class="zone">
  <p>每个任务 = 一个目录 + 一份 <b>SPEC.md</b>，分两半：上面 <code>---</code> 夹着的<b>档案卡</b>（机器读的硬指标，管「要什么、怎么验收」），下面<b>正文</b>（AI 读的自由描述，管「怎么做」，白话随便写）。</p>
</div>
<table>
  <thead><tr><th>字段</th><th>大白话</th><th>必填</th></tr></thead>
  <tbody>
    <tr><td><code>goal</code></td><td>这任务要干什么（一句话目标）</td><td>✅</td></tr>
    <tr><td><code>output</code></td><td>成果放哪——不写也认：默认落任务目录内 outputs/；写路径 = 指定位置</td><td>✅</td></tr>
    <tr><td><code>acceptance</code></td><td>怎么算做完——artifacts 交什么货 / checks 怎么验 / review 怎么评，至少一样</td><td>✅</td></tr>
    <tr><td><code>type</code></td><td>任务形态：doc 写文档 / data 理数据 / script 写脚本 / research 调研 / presentation 演示 / feature 功能 / bugfix 修缺陷</td><td>可选</td></tr>
    <tr><td><code>role</code></td><td>谁来干（不写由 AI 挑；想固定就写，如 document-writer）</td><td>可选</td></tr>
    <tr><td><code>priority</code></td><td>轻重缓急：P0 最急 / P1 / P2</td><td>可选</td></tr>
    <tr><td><code>tags</code></td><td>分类标签（筛任务用），如 [客户, 数据质量]</td><td>可选</td></tr>
    <tr><td><code>estimate</code></td><td>预计工时（小时），如 6</td><td>可选</td></tr>
    <tr><td><code>name</code> / <code>created-at</code></td><td>任务人名（可中文）/ 建档日期（自动落，不用管）</td><td>可选</td></tr>
    <tr><td><code>draft</code></td><td>草稿标记：true = 还没补全，run 会拦；补全后删掉这行</td><td>可选</td></tr>
    <tr><td><code>depends-on</code></td><td>排队关系：写任务 ID，表示等前面的先做完</td><td>可选</td></tr>
  </tbody>
</table>
<div class="zone">
  <p><b>执行计划（PLAN.md，批次级）：</b>taskq plan 列一批任务的执行顺序表，落批次 overview/PLAN.md（命名计划在 overview/plans/），可审可改；execute 默认「先谋后动」先落计划再领任务，按计划圈定跑 <b>taskq run --plans 计划名</b>。</p>
  <p><b>字段怎么改：</b>直接编辑器改 SPEC.md；机械项（补 output/acceptance/role、摘 draft）<b>taskq fix --yes</b> 代劳，改前自动归档 sources/。终端查详情：<b>taskq help spec</b></p>
</div>

<h2>可视化页面（都长在 queue/ 下，双击即看）</h2>
<div class="zone">
  <p>四扇门户同住 <b>queue/reports/</b>：<b>GUIDE.html</b> 进门（本页，init 自动生成）· <b>dashboard-{批次}.html</b> 看板（<b>status --panel</b> 五态统计卡 + 类型分布 + 工时对账 + 优先级/逾期，按批次落盘可并存；<b>PANEL.html</b> 是最新批次快捷入口）· <b>CLARIFY.html</b> 问题（<b>clarify --html</b> 体检四档分组）· <b>REPORT.html</b> 复盘（<b>report --html</b> 状态分布 + 失败红卡）——随对应命令刷新，与终端输出同源。</p>
</div>

<h2>常见问题</h2>
<div class="faq">
  <p><b>Q: 任务目录里多了个 outputs/，能删吗？</b><br>A: 那是任务产出，验收产物门禁核对文件在不在——删任务目录时连带清产出，平时不用单独删。</p>
  <p><b>Q: run 被拦截（退出码 12）怎么办？</b><br>A: 看拦截原因：draft 先 clarify 补全或 --skip-draft 强跑；模块缺共享 spec 先补 CONSTRAINTS.md；doing 有人干活等它 done；failed 修复后重新 done 验收。</p>
  <p><b>Q: 换会话/换工具怎么接着跑？</b><br>A: 账本在文件里，不在任何 AI 的脑子里——taskq run 一执行即续跑（PROGRESS.md 留痕自动注入）。</p>
  <p><b>Q: 想重跑某个任务？</b><br>A: taskq reset &lt;任务ID&gt;（软复位留痕保留 = 调整补充）；从头再来 taskq reset --all --hard。</p>
  <p><b>Q: 素材文档放哪？</b><br>A: 自组织区（如 materials/），taskq split materials/x.md 或 taskq pipeline materials/ 指过去。</p>
</div>

<footer>完整文档：https://github.com/windfallsheng/SpecTaskChain/tree/main/docs · Chain = 接力（relay），不是依赖（dependency）。</footer>
</body>
</html>`;
}

/** 生成引导页到 queue/reports/GUIDE.html（与 PANEL.html 同院），返回路径 */
export function generateGuideHtml(cfg: Pick<TaskQConfig, 'queueDir'>): string {
  const guidePath = join(cfg.queueDir, 'reports', 'GUIDE.html');
  mkdirSync(dirname(guidePath), { recursive: true });
  writeFileSync(guidePath, guideHtml(cfg), 'utf-8');
  return guidePath;
}
