// HTML 视觉主题：SpecCore 同源暗色科技风（深蓝底 + 青色主色 + 扫描线网格 + 发光卡片）
// 各报告/看板页共享基础 CSS（DARK_CSS）与背景层（SCAN_LAYERS），页面私有样式在各自 <style> 内追加。

export const DARK_CSS = `
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b1929;--card:rgba(13,31,56,.9);--border:rgba(14,165,233,.15);--cyan:#0ea5e9;--green:#14b8a6;--orange:#f97316;--purple:#6366f1;--red:#f87171;--text:#bae6fd;--muted:#5b7fa5}
body{font-family:'SF Mono','JetBrains Mono',Menlo,Consolas,'PingFang SC','Hiragino Sans GB',monospace;background:var(--bg);color:var(--text);line-height:1.7}
h1{font-size:26px;margin:0 0 4px;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:1px;display:inline-block}
h2{margin-top:28px;font-size:17px;color:var(--cyan);border-bottom:1px solid var(--border);padding-bottom:8px;letter-spacing:.5px}
.sub{color:var(--muted);font-size:13px;margin-bottom:22px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 18px;text-align:center;backdrop-filter:blur(4px);box-shadow:0 0 24px rgba(14,165,233,.06)}
.stat .num{font-size:26px;font-weight:700;letter-spacing:1px}
.stat .lab{font-size:12px;color:var(--muted);margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;font-size:13.5px;border-bottom:1px solid rgba(14,165,233,.08)}
th{background:rgba(14,165,233,.08);color:var(--cyan);font-weight:600;letter-spacing:.5px}
tr:hover td{background:rgba(14,165,233,.03)}
.group{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--cyan);border-radius:12px;padding:8px 18px;margin:12px 0}
.group h3{font-size:15px;margin:10px 0;color:var(--text);display:flex;align-items:center;gap:8px}
.badge{color:#0b1929;font-size:12px;border-radius:9px;padding:1px 8px;font-weight:700}
.item{padding:7px 0;border-top:1px solid rgba(14,165,233,.08)}
.item:first-of-type{border-top:none}
.item b{font-size:13px;color:var(--cyan)}
.item p{margin:3px 0 0;font-size:13.5px}
.opt{display:flex;gap:8px;align-items:flex-start;background:rgba(14,165,233,.05);border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin:6px 0 0;font-size:13px}
.opt b{font-size:13px;color:var(--cyan);white-space:nowrap}
.opt .how{color:var(--text);flex:1}
.zone{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 18px;font-size:14px;margin:8px 0}
.fail{background:var(--card);border:1px solid rgba(248,113,113,.3);border-left:4px solid var(--red);border-radius:12px;padding:10px 16px;margin:8px 0}
.fail b{color:var(--red)}
.fail p{margin:4px 0 0;font-size:13px;color:var(--muted)}
.retry{background:var(--card);border:1px solid rgba(249,115,22,.25);border-radius:12px;padding:10px 16px;margin:8px 0;font-size:14px;color:#fdba74}
.clean{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:40px 20px;text-align:center}
.clean .big{font-size:44px}
.clean p{color:var(--muted);font-size:14px;margin:8px 0 0}
.tip{color:var(--muted);font-size:13px;margin-top:18px;border-top:1px solid var(--border);padding-top:12px}
footer{margin-top:32px;color:var(--muted);font-size:12.5px}
a{color:var(--cyan)}
`;

/** 全屏背景装饰层：扫描线 + 网格（插在 <body> 开头） */
export const SCAN_LAYERS = `<div class="scanlines"></div>
<div class="grid-pattern"></div>`;

/** 背景层配套样式（配合 SCAN_LAYERS 使用） */
export const SCAN_CSS = `
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(14,165,233,.015) 2px,rgba(14,165,233,.015) 4px);pointer-events:none;z-index:999}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(14,165,233,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.02) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
`;
