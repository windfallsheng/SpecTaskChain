# CHANGELOG

## 0.2.25（2026-11-04）

**报告开关配置化**：是否生成澄清/完成评估报告，默认生成，四级可调。

- 批次级：`config/BATCH.yaml` 新增 `reports: true/false`（false = 本批次整体关闭）；系统默认 true，字段缺省/损坏自动回落
- 任务级：SPEC.md frontmatter 新增 `reports: false`（该任务退出评估报告，探索性任务不想进报告用；缺省参与）
- CLI 临时：`taskq clarify/run/execute --no-report` 当次关闭，`--report` 强制出一次（覆盖批次关闭）；均只当次生效不写回
- 优先级链：CLI 临时 > 任务级 > 批次级 > 系统默认；关闭时输出一行原因提示，全部任务退出的批次不生成空报告
- 测试 297 → 312

## 0.2.24（2026-11-04）

**批次配置归位**：BATCH.yaml 迁入批次内 `config/` 目录，与用户任务/模块内容分开。

- 新落盘地 `queue/{批次}/config/BATCH.yaml`；config/ 目录专司批次配置，未来扩展别的配置文件（hooks/env 等）都往这里放
- 旧版本（≤0.2.23）批次根目录的 BATCH.yaml 读侧兜底兼容，不炸存量队列；`taskq new`/`init` 时自动迁移到 config/（内容原样复制、校验一致后移除旧文件，用户手改内容零丢失）
- 队列扫描器把 config/ 与 overview/、隐藏目录一并列为保留目录（不误判为模块）
- 测试 294 → 297

## 0.2.23（2026-11-04）

**体检处方 taskq fix**：澄清建议一键写回 SPEC.md，交互/非交互双模式。

- `taskq fix` 只修 A 档机械项（改完必对）：补 output（非代码类型按输出目录推断）/ 补 acceptance 三态骨架 / 摘 draft（三必填齐）/ 补 role（类型映射，generalist 兜底不写）
- 交互（TTY）：逐项展示处方 [y/N] 确认，处理权在人；非交互（宿主 AI/管道）：只提示不等待，`--yes` 授权静默应用；`--dry-run` 预览不落盘
- 四条底线：只动 frontmatter 已知字段 / 正文一字不碰 / 改前备份 SPEC.md.bak / 幂等（已满足不重复改）
- clarify 全量体检尾部附处方提示；help/pipeline 指南同步
- 修复：批次内 overview/ 目录（评估报告落盘地）不再被扫描为模块（误报「缺公共约束」）；acceptance 幂等判定不再把 `review: ''` 空引号误当已有评审
- 新增 `fixer.ts`（规则 + 行级编辑 + 备份）/ `fix.ts`（命令）；测试 278 → 294

## 0.2.22（2026-11-04）

**评估报告**：澄清与完成两个节点自动生成报告，后台不阻断主流程。

- `taskq clarify` 全量体检后 → 澄清评估报告（每任务澄清状态逐条 + 总体评级/维度统计），落 `queue/{批次}/overview/reports/CLARIFY_REPORT-*.md/.html`
- `taskq run`/`execute` 队列清空时 → 完成评估报告（每任务验收结论/完成时刻 + 完成率/重试统计与总评），落同目录 `DONE_REPORT-*.md/.html`
- 报告由 detached 后台 worker 渲染写盘（主进程 unref 立即返回）；worker 失败只落 `.log` 不阻断队列
- 命名区分 CLARIFY_REPORT / DONE_REPORT；同批同日覆盖为最新状态；完成报告仅在「真有过执行」时生成（防空转噪音）
- 新增 `assessment.ts`（聚合器 + 双渲染器 + 派发）/ `report-worker.ts`（后台 worker 入口）；测试 266 → 278

## 0.2.0（2026-10-30）

**破坏性变更**：队列目录从旧式 `queue/tasks/` 升级为多批次 `queue/batch-{NNN}/`（旧 `tasks/` 目录兼容为第 0 批，老项目照常工作）。

### 批次架构

- 批次目录 = 「一次要做的全部任务」的容器，可建任意多个（`mkdir queue/batch-002`）
- 聚焦语义：`new` 默认落最新批次 / `run`·`status` 默认聚焦最新批次（新批次插队先跑）/ `--batch` 点名老批次 / `--batch all` 全批次
- 任务编号全局递增（跨批次取最大 +1），任务 ID 全局唯一，state.json 键永不撞车
- `new --batch` 指定批次、批次不存在时报错提示现有批次

### 命名仪式

- 任务目录 `{NN}-{slug}`：`--name` 优先 → 无 `--name` 从 goal 提取语义 slug（中文全拼）→ 提不出用任务类型键兜底（`01-script` 而非 `01-task`）
- 模块目录 `module-{slug}`（语义化前缀，已带不叠加）；批次目录 `batch-{NNN}`（三位补零，数字序排序）
- 手工建目录不受仪式约束——扫描只认结构（有无 SPEC.md）

### 元数据与筛选

- 任务 SPEC.md 新增可选字段：`created-at`（new 自动落盘，手工任务以目录出生时间兜底）/ `priority` / `tags` / `estimate`
- `new` 支持 `--priority` / `--tags` / `--estimate` 参数
- 批次 `BATCH.md` 与模块 `CONSTRAINTS.md` 顶部 frontmatter 挂 name/purpose/created-at（可选，不写照样跑；CONSTRAINTS 注入 prompt 时自动剥离元数据）
- `list` / `report` 支持 `--batch` / `--status` / `--type` 三扇窗筛选（AND 组合），无命中时明确提示
- list 任务行带 ⚑优先级 ⏱工时徽章、批次显示名；report 执行记录表含优先级列，尾部汇总预估总工时与优先级分布

### 测试

- 新增 `batch.test.ts`（批次扫描/聚焦/编号递增/接力聚焦）、`meta.test.ts`（元数据解析/兜底/筛选），全量 109 个测试
