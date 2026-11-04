# CHANGELOG

## 0.2.33（2026-11-04）

**裸 new 拦截**。`taskq new` 不带任务描述时不再兜底建「未命名任务」占位——直接提示用法、不建目录；拦截路径不设接力退出码（提示用法 exit 0，带描述建任务才 exit 10 接力）。守卫下沉到 newCommand 命令层（对齐 split 无素材拦截手势），测试 +1（裸 new 不建目录 + 用法提示）。

## 0.2.32（2026-11-04）

**history 的 AI 交互四件套**。轨迹账不只给人看——ask 口语直达、任务一生追踪、时间窗、AI 开场播报，宿主 AI 从此随问随查、开场主动报账。

- **ask 口语接入**：意图词典加 history（「最近做了什么」「操作历史」「XX 怎么了」「昨天做了什么」四类句式直落 `taskq history`）；任务 ID 提取改完整捕获（task- 前缀不再被吃掉）
- **任务一生追踪**：`history --task ID` 只看某任务全部轨迹（新建 → 领取 → 验收 → 复位一条线）；「这任务怎么验收了两次」的最佳答法
- **时间窗**：`history --since 今天|昨天|前天|YYYY-MM-DD`（parseDue 口语日期复用，UTC 日界含当天）
- **AI 开场播报**：init 生成的宿主接力规则加「会话开场与轨迹」小节——新会话先 `history --limit 5` 报上次进度再 `status` 报断点
- 测试 413（新增 oplog 7：target/since 过滤 + 渲染 + ask 口语三句式集成）

## 0.2.31（2026-11-04）

**操作轨迹账（taskq history）**。队列写操作的时间线回放——何时建了任务 / 领取 / 验收 / 复位，一条流水全记下；state.json 记当前态、op-log 记时间线，两本账各管一半。

- **数据层**：op-log.json（JSONL 追加式，单行原子写；损坏行局部跳过不拖累全账）；appendOpLog 自动打时间戳，readOpLog 倒序 / 批次过滤 / limit 截断
- **写点挂载**：new 建任务 / run·execute 领取 / done 验收（通过·未通过·达上限三种都记）/ reset 复位——五类写操作自动留痕
- **命令**：taskq history [--batch 批次] [--limit N]（默认最近 30 条，--limit 0 全量）；只记写操作，只读命令不刷屏
- **与 report 分工**：report 按任务聚合总账（这个任务的一生），history 按时间线回放流水（这个队列的一天）
- **文档**：README 文档导航与正文共 13 处链接转绝对 GitHub 地址（npm 页面可点）；help 总览补文档入口行
- 测试 406（新增 oplog 9：追加 / 倒序 / 截断 / 过滤 / 容错 / 渲染 / 集成）

## 0.2.30（2026-11-04）

**场景手册（docs/scenarios.md）**。说明文档补全：七个典型场景的完整使用过程——手动把关 vs 自动推进双路线对照、「自动」三层辨析（无人值守接力 / 编排非交互 / 静默应用）、pipeline 双模式逐句对照、任务失败与重跑双路修复、多批次并行；所有输出示例取自真实 CLI 运行；README / quick-start / commands.md 三处导航打通。

**clarify 推荐方案 + 评分 + 判断题通道**。可执行性风险（exec 档）每条方案带 10 分制评分与唯一 ✅ 推荐方案（附推荐理由），`--decide` 判断题逐项裁决（y 采纳 / n 换方案 / s 跳过），采纳写回 SPEC.md `decisions` 留痕，下次体检自动跳过已决信号。

- **数据层**：ExecOption 扩展 score/recommended/reason；六类 exec 信号（认证凭据/权限审批/物理动作/平台账号/资金合规/外部等待）全部预置评分（9/8/7 或 9/8/6）与唯一推荐 + 推荐理由
- **渲染层**：终端与 CLARIFY.html 推荐方案置顶 + 评分徽章 + 推荐理由（✅ 推荐 / score/10 / 推荐理由行）
- **交互层**：`clarify --decide` 判断题通道——TTY 逐项裁决（y 采纳 / n 换方案 / s 跳过）；非 TTY 只提示不等待；`overwrite: false` 任务与模块级 exec issue 只提示不落盘；采纳前原 SPEC.md 归档 sources/（与 fix 同手法）
- **已决跳过**：SPEC.md frontmatter `decisions`（风险标签→方案名）裁决过的类别下次体检不再报
- **修复**：readLineSync EAGAIN 缺陷（node 把 TTY stdin 置非阻塞，无输入时 readSync 立即抛 EAGAIN 导致交互闪退；fix 的 TTY 确认同病）——EAGAIN/EWOULDBLOCK 时 Atomics.wait 休眠重试
- 测试 365（新增 clarify-decide 9：六信号唯一推荐 / HTML 推荐置顶 / 已决跳过 / frontmatter 往返 / applyDecision 幂等与归档 / --decide 非 TTY 三态）

**ask 懒人批次解析（三层递进）**。用户嘴里的「预算那批」「上一批」不再是死格式——精确编号 → 相对位次 → 特征短语语义扫描，三层落定真实批次；平局/零命中不瞎猜，亮候选清单交 AI。

- **口径识别**（parseBatchRef）：批次002 / batch-003 / 第二批 → 精确；最新/上一/最早那批 → 相对位次；「预算那批」→ 特征短语（剥壳去虚词）；「批量执行」不误伤
- **语义落定**（batch-resolve）：精确编号存在性校验 / 位次按数字序定位（单批次「上一批」= 它并注明）/ 特征短语扫批次内容打分（完整包含 +3、双字滑窗 +1），唯一最高分直落，平局或零命中 → 候选清单（批次名 + 任务数 + 命中证据）
- **ask 七路接入**：run/execute/status/report/list/new 全部先行裁决（未决输出 [TASKQ_NEEDS_INFO] 候选清单，退出码 0 不接力）；编排剧本批次模板落定后注入 --batch（�� 批次行附语义证据）
- 测试 382（新增 batch-resolve 17：口径识别 4 / 语义落定 8 / 候选渲染 1 / ask 端到端 4）

**最近使用批次默认（没明说就回最近干活的地方）**。用户不提批次时，不再一律跳「最新批次」——state.json 记 lastUsedBatch，run/execute/new/done 的写操作自动认领；昨天一直跑 batch-001，今天说「继续跑」就回 batch-001，不会跳去编号更大的 batch-002。

- **状态层**：state.json 顶层 lastUsedBatch（原子落盘，不碰 tasks 原账）；resolveDefaultBatch = 最近使用（须批次仍存在）> 最新；selectBatch 第三参接默认批次
- **写点认领**：run/execute 接力领取 / new 落盘 / done 验收通过，四处写操作自动记忆；queueSummary 对「最近使用 ≠ 最新」亮「← 最近使用」标记
- **ask 空引用裁决**：settleBatch 不再空手而归——无批次词的六路命令与编排剧本默认落最近使用批次
- 测试 397（新增 2：最近使用优先落 batch-001 而非最新 / 记忆批次已删回退最新）

**工时与截止：实际工时（--spent）+ 截止日期（--due）+ 偏差账**。任务数据补齐平常工作最常用的两个维度——预估之外有实耗，报告自动长出「预估 vs 实际」差值栏与偏差汇总；截止日期让计划感落进任务，逾期亮红。

- **数据层**：TaskSpec 新增 `due`（口语「今天/明天/下周X」parseDue 自动转 YYYY-MM-DD）；TaskRunState 新增 `spent`（done 验收登记，attempts/doneAt 同层持久）
- **入口**：`new --due 明天` / `done --spent 6`（cli 双路透传，spent 非法值静默）
- **展示层**：list 任务行 🕐实耗 + 📅截止徽章（逾期 🔴晚N天）；status 逾期计数；report 工时账（实际总工时 / 预估 vs 实际差值（超支+/省时-/持平）/ 偏差明细 / 逾期清单），REPORT.html 同步（工时（估/实）列 + 逾期红卡）；daysOverdue 公共口径三处共用
- **clarify 工时体检**：estimate 缺失（长不出偏差账）或单任务 >40h（估算失真，建议 taskq split）→ 建议档
- 测试 395（新增 hours 13：due 口语解析 4 / spent 登记 2 / report 偏差账与逾期 4 / list 红标 1 / clarify 体检 3）

**ask 编排 + run 流水线 + split/pipeline 双模式（参考 speccore 精髓）**。一句话带多个动作不再丢段；run 从单任务接力升级为阶段流水线推进器；截图/乱文档也能拆任务，交互/非交互双模式。

- **ask 复合意图编排**（speccore 模式4）：多动作词 + 时序词（然后/接着/再/最后/并且/同时/先）命中 → `[TASKQ_ORCHESTRATE]` 编排剧本（步骤/命令/拦停点/模式），宿主 AI 按序接力；「先X再Y」语序特判（执行前先澄清 → 澄清在前）；模板变量提取（批次002 → batch-002 / 一次领 5 个 → 5 / 全自动 → 非交互）；拆分缺素材 → `[TASKQ_NEEDS_INFO]`
- **run 阶段流水线**：无参 = 智能续跑（断点面板 + 单任务接力，退出码协议不变）；preset/范围语法（`run clarify`、`run clarify to execute`、`run split docs/prd.md`，中文别名体检/拆分/执行/报告）；`--auto` 全自动闸口（拦停点自动通过，仅失败停下）；范围含 split 且无素材 → NEEDS_INFO
- **split 增强**：截图入口（图片素材 → 第 0 步视觉读取转文字清单，忠实原文不脑补）；模块级任务识别（标题层级 → 模块 + 子任务，共享前提 → --group 聚合）；混乱内容容错（条目骨架梳理/散点聚合/无结构按段落切并标注复核）；`--auto` 非交互（清单即确认直接往下）
- **pipeline 双模式**：默认交互（拦停点 1/2 停下问用户）；`--auto` 非交互（拦停点 1/2 自动通过）；拦停点 3（任务失败）两种模式都停；截图入口同 split
- 新增标记协议：`[TASKQ_ORCHESTRATE]` / `[TASKQ_RUN_PLAN]` / `[TASKQ_NEEDS_INFO]`
- 测试 355（新增 orchestrate 28：编排/范围解析/剧本/截图/双模式）

## 0.2.29（2026-11-04）

**命名简化：去掉序号，重名拼短 hash**。用户不关注目录顺序——任务名来自 `--name` 或从 goal 提取的语义 slug，目录不再带序号；同名时拼内容短 hash 区分（重名不打架）。

- 目录名 = `task-{slug}`：无序号；`--name` 优先（已带 `task-` 前缀则尊重原样），无 `--name` 从 goal 提取语义 slug（中文转全拼，类型键兜底）
- 重名（队列中已有同 ID）→ 拼内容短 hash：`task-xiewendang-7d56cb`（sha1 前 6 位，同内容幂等不漂移）；同名同内容重复建两次后第三次报错提示换名
- 模块子任务同样无序号：目录名 = `{slug}`，撞名同样拼 hash
- clarify 判重升级：完整 ID 跨批次/跨模块重复 → blocking（state 键撞车拦截）；slug 重复建议取消（hash 机制已自动区分）
- 测试 327（断言全部换新格式）

## 0.2.28（2026-11-04）

**命名仪式纠正：task- 前缀提到目录名最前**。普通任务目录 = `task-{NN}-{slug}`（前版 `{NN}-task-{slug}` 作废），与模块 `module-` 前缀风格一致——前缀一律打头。

- 目录名 = `task-{NN}-{slug}`：`task-` 打头，序号紧跟其后（全局递增不变），语义 slug 收尾
- `--name` 已带 `task-` 前缀 → 尊重原样不叠加不加序号；无 `--name` 从 goal 提取语义 slug（中文转全拼，类型键兜底）
- 编号提取兼容三格式：`task-03-xxx` / `03-task-xxx` / `03-xxx` 均占号；slugFromDir 同步兼容，clarify/fix 读侧无感
- 测试 325（断言全部换新格式）

## 0.2.27（2026-11-04）

**任务命名仪式带 task- 前缀**：普通任务目录默认 `{NN}-task-{slug}`，与模块 `module-` 前缀同风格。

- 新建时自动加 `task-` 前缀（`--name` 已带前缀不叠加，`--name 'task-01'` 直接作 slug）；序号仍打头，编号全局递增不变
- 语义 slug 提取不变：`--name` 优先，无 `--name` 从 goal 提取（中文转全拼，提不出用任务类型键兜底）
- 老目录（`{NN}-{slug}`）读侧全兼容：clarify 命名体检、fix 输出推断统一用 slugFromDir 剥仪式前缀
- 测试 323 → 325

## 0.2.26（2026-11-04）

**fix 覆盖开关配置化**：澄清处方是否覆盖写回用户原来的 SPEC.md，默认覆盖，四级可调；覆盖前原文件归档。

- 归档：覆盖前把用户原写的 SPEC.md 存进任务目录 `sources/SPEC.md`（目录自动创建，用户原来的写法随时可找回；不再用同目录 .bak）
- 批次级：`config/BATCH.yaml` 新增 `overwrite: true/false`（false = 本批次任务默认不覆盖）；按任务所属批次逐一判定——定向修单任务用其批次配置，全队修各任务各自批次互不牵连
- 任务级：SPEC.md frontmatter 新增 `overwrite: false`（该任务处方只提示不落盘；缺省允许覆盖）
- CLI 临时：`taskq fix --no-overwrite` 当次只提示不写回，`--overwrite` 强制覆盖一次（压过批次关闭）；均只当次生效不写回
- 优先级链：CLI 临时 > 任务级 > 批次级 > 系统默认；被拦任务在输出中点名提示原因与临时覆盖命令
- 测试 321 → 323

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
