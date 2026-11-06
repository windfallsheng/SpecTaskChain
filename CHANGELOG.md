# CHANGELOG

**v0.2.40：pipeline 定位归位（宿主 AI 编排入口）+ 产出归巢体检清零**：

- **pipeline 定位归位**：pipeline 本就不是终端用户手动敲的命令（CLI 只出剧本 + 采集素材，编排归宿主 AI），说明书里不再推给用户——help 命令总览与 guide 速查表标注「宿主 AI 编排入口，对话说需求即走，无需手动敲」，help pipeline 详情页加定位说明，素材入口与 FAQ 改口「split 入口，或对 AI 说需求走全流程」；ask 口语入口「跑流水线」照常路由（用户对 AI 说、AI 内部调，本命用法不动）
- **产出归巢体检清零**：docs/queue-structure 任务类型表 general 行旧镜像落点归巢（outputs/{批次}/{任务目录}/ → 任务目录内 outputs/）；init.ts 目录布局与 SKILL 模板主入口两处 pipeline 字样同步弱化；examples 现场 GUIDE.html 重新生成（plan 小节 + pipeline 弱化 + 字段速览 + overview 全齐）
- 测试 484 全绿；版本号 readVersion 动态读无硬编码漂移


**v0.2.39：产出落位归巢（任务目录内 outputs/）+ 任务规格字段说明书 + 六页暗色换装**：

- **产出落位归巢（方向性修正）**：默认产出不再镜像到项目根 outputs/{批次}/{任务目录}/，而是住进任务自己的 outputs/（queue/{批次}/{任务目录}/outputs/，产出与任务同住）——文档类精确落 {slug}.md，代码/data 类落院落不猜文件名；优先级三级：任务描述/SPEC.md 明确指定路径 > 用户改过的 output 字段 > 任务目录内 outputs/ 默认；fixer/clarify 调用链全量传 root（相对路径落位），help/guide/init 文案与 README/docs 六篇同步，「镜像队列层级」旧词清零；examples 现场三任务双形态实测（指定 data/ 不被碰、清空 output 默认落位落盘 + fix-log 留痕 + sources/ 归档）
- **任务规格字段说明书（人话版）**：新增 taskq help spec 终端入口——SPEC.md 每个字段大白话翻译（档案卡/正文两分法、三必填 goal/output/acceptance 逐条讲、八可选字段带改法示例、改法三板斧：编辑器直改 / fix --yes 代劳 / sources 归档可找回）；HTML 引导页与 help guide 加「任务规格字段速览」节（字段/大白话/必填三列表格，code 胶囊样式）；docs/spec-format.md 加人话版速查表；引导页文案五件套补齐「字段速览」
- **六页暗色换装（SpecCore DNA）**：新建 html-theme.ts 共享暗色主题（深蓝底 + 青紫渐变 + 扫描线背景层），clarify/panel/report/assessment/plan/guide 六个 HTML 生成器统一换装；文档引用路径归位 queue/reports/GUIDE.html，「三档红黄灰」→「四档红黄灰靛」描述同步
- 文档同步：README、docs 七份（commands/directory-layout/queue-structure/relay-protocol/scenarios/spec-format 等）；测试 484（+6 守护：help spec 详情 / guide 字段速览 / HTML 字段速览节 / fix 留痕补 root / 全量断言镜像路径改归巢路径）


**产出落位镜像队列层级：outputs/ 单一产出总仓 + 批次防线三刀（出生证明/拦截落账/SKILL 防错）**：

- **产出总仓 outputs/ 镜像队列层级**：默认产出不再按类型归位（docs/data/research…），统一进 outputs/{批次}/{任务目录}/，与 queue/ 同构（task-/module-/模块子任务层级原样保留）；任务 SPEC.md 的 output 或描述里明确指定的路径仍最高优先；类型定义（task-type）删 outputDir、批次配置（batch-config）删 output-dirs/nest-outputs 两键——类型只管形态与约束，不再决定落点
- **批次出生证明**：scanQueue 只认带 BATCH.yaml（config/ 或批次根）或已有任务内容的 batch- 目录；空壳目录（先 mkdir 再建任务的旁门）不识别为批次，new --batch 指向空壳即拦截报错
- **拦截落账**：op-log.json 成功与拦截同账（拦截 note 带 ❌/⛔ 前缀）——new 批次拦截、run/execute 八处拦停（批次不存在/定向无匹配/failed/模块缺共享 spec/draft/批内拦停）全部留痕，批次翻转与意图偏差一查账本便知
- **SKILL 防错文案**：taskq-new 模板补两条纪律——批次只能由 taskq new 创建（禁止先 mkdir 空壳目录），复盘先读 queue/.taskchain/op-log.json
- 文档同步：README、docs 四份（directory-layout/queue-structure/scenarios/spec-format）、help/guide/init 文案全量收口；测试 480（+2 出生证明三态与空壳拦截落账，原 478 断言全量改镜像路径）

**全面检查第二波：SKILL 模板源补齐 taskq-plan + 口径统一（不是抽检，是同类全实例扫描）**：

- **病灶①模板源缺 taskq-plan**：此前 examples 里的 taskq-plan/taskq-run v0.2.37 是直改产物，CLI 模板源（init.ts renderSkillFiles）只有 5 个 SKILL——任何新项目 `taskq init` 都不会生成计划 SKILL，且旧 taskq-run 模板无「先谋后动/--plans/--replan」语义。修复：模板源新增 taskq-plan 子模板（全景/命名计划、--list/--show、--plans 按计划执行、先谋后动沿用与 --replan 语义、frontmatter tasks 机读锚点、plan-format 三形态、失败降级一行警告），taskq-run 模板补齐计划语义与计划外待办提示；examples 产物经 `taskq init --update` 从模板源重生成，漂移消除
- **病灶②clarify 三档残留**：CLARIFY.html 渲染器早已四档（⛔⚠️⏳🤖），但 clarify.ts/help.ts/guide.ts 注释与 html-pages.test.ts 名称仍写「三档红黄灰」——统一为「四档红黄灰靛」
- **病灶③help 计数滞后**：init 说明「5 个 SKILL」→「6 个 SKILL」（+ /taskq-plan），help.test/fixes.test 断言同步（fixes.test 新增 plan SKILL 语义断言：先谋后动/--plans/--replan）
- 真机闭环：全新 init 生成 6 SKILL → execute 首列计划落盘 → 新增任务被圈定集挡门外 → 圈定任务完成后「计划外待办 --replan」提示 → --replan 重列纳入 → 483 测试三轮全绿

**可靠执行全链路体检：四处协议旁门关闭 + 一处断言毫秒赌博根治**：

- **隐患①协议旁门关闭**：runner.ts 三处 + done.ts 一处拦截文案引导「手动把 state.json 中该任务状态改为 todo」——违反状态只归 CLI 原则，全部改为引导 `taskq reset <id>` 复位（走 CLI 状态机，attempts 计数与留痕不旁落）
- **隐患②文案口径对齐**：batchRelay failed 拦停文案不区分「达上限/未达上限」（实际未达上限也报达上限），改为与 relayNext 同构的三元判断
- **隐患③评审门禁补漏**：review 启用而宿主 AI 忘传 --verdict 时评审门禁静默放行（verdictPassed 空串即通过）——done 入口加拦截：评审门禁启用时回执不可缺，机器不替 AI 放行
- **测试断言毫秒赌博根治**：plan.test 用例 `not.toContain('3.')` 撞时间戳毫秒位（53.9xx 过、53.3xx 挂）——此前误判为「并发环境偶发」，实为断言依赖 createdAt 随机毫秒；改为断言任务 goal 不入计划
- 体检通过项：状态写入收敛（writeState 仅 runner 持有，reset 为唯一旁路且确定性复位）；两入口 [TASKQ_PROMPT] 块同构且带回执约定；fixer 仅四类机械修复项；新任务英译接力零痕迹拦截幂等续跑；ask 编排候选清单幂等可解；语义活（拆分/澄清/英译/评审结论）均有确定性兜底

**ask 口语入口对新功能点全面补齐（意图识别 + 参数提取 + 编排）**：

- **「按计划执行/执行计划/跑计划」→ run 的 --plans 语义**（此前误入 plan 意图只列不跑，彻底断链）：plan 意图触发器移除「执行计划」，run 意图新增按计划三词；「按计划执行 A,B」提取 planNames 名单（整体匹配防「按计划」吞「执行」进捕获组），run/execute 两入口 resolvePlans 解析任务集，缺计划报错 exit 12 不瞎猜
- **「重列计划/重新列计划」→ plan**：覆盖重列天然即 --replan 语义
- **「看板/面板/dashboard」→ status 生成 HTML 看板**：status 意图新增看板词，ask status case 检测看板词自动开 panel（dashboard-{批次}.html）
- **「先列计划再执行」→ 编排含 plan 步骤**：ACTION_WORDS 加列计划/排计划，LABELS 加「列执行计划」标签（gate false），stepCommand 输出 taskq plan
- **剥壳表补「看」系动词**：「看看批次看板」的「看看」不再误当批次特征词（剥尽视作当前批，防 NEEDS_INFO 误拦截）
- 测试 483（+5：按计划执行/重列计划/看板词/编排 plan 步骤/看系剥壳）

**批次看板按批次落盘：dashboard-{批次}.html 可并存 + PANEL.html 快捷入口**：

- **文件名规则**：`status --panel` 落 `queue/reports/dashboard-{批次}.html`（一批次一文件、历史批次可并存归档）；`--batch all` 落 `dashboard-all.html`；缺省最新批次（解析语义与 queueSummary 一致：最近使用批次 > 最新批次）
- **PANEL.html 保留为快捷入口**：缺省生成时同步刷新，meta refresh 指向最新批次看板（双击即达，永远不覆盖 dashboard 本体）
- help/guide 文案同步（四页门户描述更新为 dashboard-{批次}.html）
- 测试 478（+1：文件名规则与快捷入口断言）

**全链路体检修复：空队列仪式、计划外待办提示、help/SKILL 同步**：

- **空队列 execute 不打架**：planBeforeExecute 检测队列为空直接跳过仪式——消除「先建任务」与「队列已清空」两句自相矛盾的输出
- **计划圈定任务跑完 ≠ 队列清空**：batchRelay 与 relayNext 双路径在无待领任务时，若按计划执行（--plans/沿用计划）且队列还有计划外待办，如实提示「计划圈定任务已完成（N 个）。队列另有 M 个任务不在本计划内——taskq execute --replan 重列全景计划即可纳入接力」，不再误报「队列已清空」；未领取任务在 state.json 无状态条目（无条目 = 待办）也已纳入统计
- **help.ts pipeline 文案同步五阶段**：补「3 列计划（非拦停）→ 4 执行（已有计划自动沿用）」；taskq-run SKILL 升级 v0.2.37（阶段剧本/--plans 按计划执行/先谋后动全语义）
- 测试 477（+2：空队列跳过仪式、计划外待办提示含未领取无状态条目场景）

**执行的就是这个计划：计划圈定执行范围 + SKILL/流水线衔接补全**：

- **全景计划带 frontmatter 机读锚点**：与命名计划同构，PLAN.md 落盘带 tasks 清单——execute 沿用计划时按计划圈定任务集执行（不再退化为全部待办）；旧版无 frontmatter 计划兼容退化为全部待办
- **planBeforeExecute 返回任务集**：仪式从纯提示升级为 { text, planTaskIds }，cli.ts/ask.ts 两个 execute 入口先仪式后接力（任务集与 --plans 合流，--plans 优先）；沿用提示标注「按计划圈定任务集执行（N 个任务）」
- **--replan 语义闭环**：重列后新任务纳入计划（真机验证：圈定 1 任务 → 新增任务被计划排除 → --replan 后 3 任务全纳入）
- **run 报错文案补 plan 阶段**（五阶段齐全）；taskq-plan SKILL 升级 v0.2.37（沿用/--replan/先谋后动/流水线点/多计划执行全语义）
- 测试 475（plan.test 沿用用例补 planTaskIds 断言；全量并发下 planCommand 用例偶发失败经连续多轮确认环境偶发，非产品缺陷）

**计划与执行无缝衔接：已有计划直接沿用，不再重复列**：

- **execute 谋已定不再重谋**：批次已有 PLAN.md/PLAN.html 时，execute 前置仪式直接沿用现成计划（提示一行），不重复生成、不覆盖用户审阅后的人工调整；任务增减后要刷新用 `--replan` 强制重列
- **流水线两阶段衔接**：pipeline 阶段 3 列计划落盘即被阶段 4 沿用——未圈定范围 execute 直接按全景计划接力，命名了计划则 `taskq execute --plans 计划名` 只跑计划圈定任务；run 剧本 execute 阶段文案同步「已有计划自动沿用」
- help execute 行补 [--replan]
- 测试 475（+1：沿用不重列与 --replan 强制重列）

**计划默认双生落盘 + 计划生成不阻塞主流程**：

- **plan-format 默认值 md → html**：不配置时计划默认同时落 PLAN.md（底稿人读机读）与 PLAN.html（同视觉页双击即看）；批次 BATCH.yaml 仍可用 plan-format: md（只底稿）/ none（只终端）收紧
- **执行前计划生成加保险丝**：planBeforeExecute 全程 try/catch——写盘失败或渲染出错降级为一行警告（⚠️ 已跳过，不影响任务接力），execute 主流程照常领取任务；run 剧本 plan 阶段文案明示「生成失败不阻断执行」
- 测试 474（+1：计划生成异常降级不阻断；默认双生断言并入既有用例）

**PANEL.html 升级为批次看板：五态统计卡 + 类型分布 + 工时对账 + 优先级/逾期维度**。原面板只有一条进度条和一张清单表，现在按 speccore dashboard 思路补全多维度视图：

- **五态统计卡**：总任务 / 已完成 / 进行中 / 待办 / 失败五张卡（draft 计入待办）
- **任务类型分布**：按 spec.type 动态聚合（不硬编码清单，自定义类型照常入列），每类型一张卡——色徽章 + 完成数 + 预估工时小计 + 迷你进度条，8 色循环同 PLAN.html 视觉语言
- **工时对账**：预估合计（estimate 聚合）vs 实际登记（done 任务 spent 聚合），有账可算时给出偏差（正=超支，负=省时）
- **优先级分布**：P0/P1/P2 彩色徽章（有数据才显示该区）
- **逾期红标**：due 早于今天且未 done 的任务在截止列红色加粗
- **任务表扩九列**：状态图标/任务/类型/状态/优先级/预估/实际/截止/目标
- **批次聚焦**：--panel 透传 --batch（修掉旧账：以前 --panel 永远渲染全量、忽略 --batch），标题标注批次名；缺省聚焦最新批次、--batch all 全量
- 测试 473（+3：五态卡与类型分布与工时对账 / 优先级与逾期 / 批次聚焦）

**先谋后动：执行多条任务默认先列计划**。计划不再是可选步骤，而是批量执行的前置仪式：

- **execute 默认先计划**：`taskq execute` 领取任务前默认先落全景执行计划（批次 overview/PLAN.md，形态走 plan-format 配置），计划段前置亮给用户再领任务；`--no-plan` 强制跳过
- **定向执行免仪式**：带 `--task/--module/--plans` 定向时用户已指定范围，不重复生成计划（自己的队列自己负责）；口语入口「批量执行」照走仪式
- **run 剧本加 plan 阶段**：preset 五阶段 clarify → split → plan → execute → report，`run plan to execute` 可只跑「列计划 → 接力执行」两段；aliases plan/计划/列计划/排计划
- **pipeline 剧本加列计划阶段**：六阶段 拆分 → 澄清 → 列计划（确定性一步，非拦停）→ 执行 → 收尾；计划是执行依据，生成即可往下走
- 测试 470（+3：planBeforeExecute 三态 / ask 批量执行先计划落盘 / run 剧本五阶段与 plan 别名）

**计划升级一等资产：命名计划 + 形态配置 + 按计划执行 + 列表与详情**。taskq plan 从一次性视图升级为可引用的执行资产：

- **命名计划**：`taskq plan --name "计划名" [--tasks a,b] [--module m]` 对部分任务或功能模块圈定计划，落批次 `overview/plans/{slug}.md`；md 头部 frontmatter 的 tasks 清单是机读锚点（--plans 执行的依据），人读机读同一份底稿
- **生成形态配置**：BATCH.yaml 新增 `plan-format: md | html | none`——md 只落底稿（默认）、html 伴生同院视觉 HTML 页（与 GUIDE/PANEL/CLARIFY/REPORT 同语言，状态分布条 + 拓扑清单 + 关键路径）、none 只终端输出不落盘（一次性视图，不可被 --plans 引用）；CLI 临时覆盖 `--format`
- **按计划执行**：`taskq run --plans a,b` / `taskq execute --plans a,b` 多计划任务并集、仍按拓扑序接力；与 --task/--module 并集叠加；计划不存在明确报错（exit 12）
- **查看计划**：`taskq plan --list` 列计划资产（名称/任务数/形态/创建时间）、`taskq plan --show <名>` 渲染详情带当前状态
- **意图与技能**：ask 引擎新增 plan 意图（「列计划/做计划/看计划」须配动词才触发，弱信号「计划」不误触）；examples 项目新增 taskq-plan SKILL 薄包装
- 全景计划（无 --name）沿用 overview/PLAN.md，html 形态时伴生 PLAN.html；测试 467（+9）

**依赖声明手动一步到位 + 执行时疑似上游点名**。依赖关系的手动/自动两条路都补齐了最后一里：

- **手动模式**：`taskq new --depends-on a,b` 建任务时一步声明多依赖（SPEC.md 落 depends-on 列表块）——不再事后手编 YAML；多依赖拓扑/悬空环检测/上下游摘要此前已就位，入口补齐后整条链路通顺
- **自动模式（AI 判断）**：执行 prompt 新增「疑似上游（未声明 depends-on）」段——任务引用了他人将要产出的文件却未声明依赖时点名（产物路径 + 所属任务 + 判断规则），执行 AI 从此有据可依：需要真实内容则反馈用户补依赖，仅参考路径则忽略。与 clarify 隐式推导同一套匹配（精确 + 后缀兜底），豁免三态不变（已声明/自己产物/无主文件）
- 为什么不做机械自动补依赖：引用上游产物 ≠ 需要其完成（可能只是参考格式）——语义判断留给 AI，CLI 只给精准素材（处理权在人）
- 测试 458（+4：多依赖落盘 / 多上游分组去重 / 豁免三态 / prompt 段出现与缺席）

**产出目录批次可配置 + 任务归巢**。默认落位从「类型硬编码 + 扁平」升级为「批次可配 + 任务院落」：

- **批次产出目录覆盖**：`config/BATCH.yaml` 新增 `output-dirs`（类型 → 目录映射）——本批 doc 类归 `deliverables/`、data 类归 `data-2027/`，覆盖内置归位表；未列出的类型按内置走，字段损坏逐项回落不连坐
- **默认落位任务归巢**：新增 `nest-outputs`（默认 true）——CLI 推断默认落位时生成 `{输出目录}{任务slug}/{任务slug}.md`（任务院落：多产物聚一处、互不踩踏、删任务即删目录）；false 回到扁平
- **用户指定永不套目录**：SPEC.md 的 output 或描述里明确指定的产出路径，批次覆盖与归巢一律不介入——用户表达最高优先级（三查规则不变）
- clarify 建议 / fix 机械修复 / 归巢落位三处共用单一事实来源（defaultOutputFor 加 opts，fixer 重复实现删除）；优先级链：用户指定 > 批次 output-dirs > 类型内置 outputDir
- 测试 454（+5：批次解析两态 / 归巢落位 / 批次覆盖 / 指定优先）

**依赖与计划三层落地**。依赖分析从「隐式引擎」升级为「开局全景」——CLI 把关系算清楚写进上下文，AI 不再靠悟：

- **隐式依赖推导**：任务引用了他人的产物却未声明 depends-on → clarify 亮建议「引用上游产物 X（任务 A 产出）但未声明 depends-on——不补则 A 可能后跑，执行时拿不到真实产物只能脑补」。只建议不自动改（依赖声明是用户的表达）；已声明/引用自己产物/引用无主文件一律豁免
- **执行计划显性化**：新命令 `taskq plan`——拓扑顺序 + 依赖边 + 模块分组 + 关键路径（最长依赖链），默认落盘批次 overview/PLAN.md；`taskq execute` 开局附计划摘要（任务数/待做/依赖边/关键路径/接下来）
- **下游接力预告**：任务 prompt 新增「下游接力预告」段——谁 depends-on 我、它引用了我的哪个产物，产出路径与格式对齐下游（上游服务下游，而非下游追着猜）；与既有「上游依赖完成摘要」段合成上下游全景
- 核心模块 plan.ts（buildPlanModel/renderPlan/renderPlanBrief）；测试 445（+6：隐式推导两态 / 计划模型 / 渲染摘要 / 下游段两态）

**口语模糊词词表增强 + Excel 引用消解**。正常人说大白话的含糊全被抓到：

- **口语动作词**：VAGUE_WORDS 增「整理一下/弄弄/搞个/搞一下/弄一下/改一下/检查下/有点/最近」——「帮忙弄弄」「搞个周报」这类不可验收的表达此前零命中
- **口语指代词**：AMBIGUOUS_REFS 增「上次/这次/那天/同行/那个」——「上次开会说的事」「那个大客户」此前执行时只能靠猜
- **Excel 进入引用链路**：bareRe 扩展名补 xlsx/xls，预算表等 Excel 引用可被消解与检测
- examples batch-003 六个口语模糊任务全命中（「上次开会说的事整理一下」等），重量任务零误伤
- 测试 439（+2：口语词表六态 / xlsx-xls 引用）

**clarify 体检误报修复**。体检不再误伤合法形态：

- **纯目录落位不判冲突**：output 是 `docs/`、`src/` 等占位目录时不再互撞——产出冲突只看具体文件路径
- **上游产物引用豁免**：下游引用上游将要产出的文件（depends-on 链）不再报「引用悬空」——collectArtifacts 收集全队列 acceptance 产物，后缀匹配兜底
- **bareRe 反引号截断根治**：反引号是路径包裹符，不再被负向后行排除——「`data/x.csv`」提取完整路径而非 basename（此前引用消解读错文件）
- 测试 439（437 基础上 +2）

**产出物位置三查**。产出位置的规则显性化：用户指定优先，类型默认兜底。

- **用户指定优先**：任务描述里明确说了产出位置（「写到 docs/x.md」「优化 src/x.ts」）→ clarify 亮明「output 未填/不一致」，fix 机械修复直接按指定位置补（fix-log 留痕「按任务描述指出的产出位置」）；「读 data/x.csv」等输入引用不误提取
- **默认落位显性化**：产出位置未指明 → clarify 建议按类型默认落位（doc→docs/{slug}.md、general→outputs/…），代码/数据类型提示明确文件或目录
- 新增共享模块 output-location（extractStatedPaths/defaultOutputFor），clarify 与 fixer 共用单一事实来源；测试 434（+7：提取/指定优先/输入引用不误报/三查四态）

## 0.2.35（2026-11-05）

**taskq new 英译接力**。纯中文任务名不再直接落拼音目录——默认「先英文、再拼音」：

- **拦截接力**：`--name` 未指定且 goal 是纯中文 → 输出 `[TASKQ_PROMPT]` + exitCode 10，宿主 AI 英译后带 `--name` 续跑（`taskq new "原话" --name "english-slug"`）；没有合适的英文才降级拼音或中文（CLI 自动转全拼）
- **名字已定不打断**：`--name` 一旦存在（用户/AI 明确起名）即视为名字已定，中文转全拼、英文直接用，不拦截——幂等，续跑不会二次打断
- **拉丁片段不拦**：goal 含英文词（如「写 MySQL 慢查询脚本」）直接提取，只有纯中文才接力
- **零痕迹拦截**：拦在 scanQueue 之前，不建目录、不写批次配置，宿主 AI 续跑前队列不动
- **ask 同步**：`taskq ask "建个任务：…"` 同样接力（exitCode 10 传播）
- **重名 hash 保留**：同 slug 不同内容依旧拼内容短 hash（state 键不撞车）
- taskq-new SKILL 增加英译接力规范（宿主 AI 收到 PROMPT 的处置守则）
- 测试 423（+5：拦截 / 续跑 / 拼音降级 / 拉丁片段不拦 / 中文 name 不拦）

**澄清留痕（可追溯）**。澄清动作不再黑箱——自动模式下用户事后可查「澄清了什么、选了哪个方案」：

- **SPEC.md 澄清记录章节**：澄清（补正文）后请在正文尾部写「## 澄清记录」——逐条列原模糊点 / 备选方案 / 应用的方案与理由；无人值守（自动）模式必写，交互模式用户全程在场可免（clarify 报告 MD 版尾部与 HTML 版 tip 区、taskq-clarify SKILL 三处同步守则）
- **fix 机械修留痕**：fix 写回时 frontmatter 自动追加 fix-log 累积日志（日期 + 应用项列表），正文一字不碰的底线不变；幂等（无改动不写日志）
- **留痕体系四件套**：澄清记录（AI 补正文）+ fix-log（机械修）+ decisions（--decide 裁决）+ sources/ 归档（改前原版）
- 测试 424（+1：fix-log 落盘 / 正文不碰 / 幂等不重复）

**上游依赖完成摘要**。依赖不再只是排序与门禁——下游 prompt 注入上游做成了什么：

- **依赖摘要段**：任务声明 depends-on 时，执行 prompt 新增「上游依赖完成摘要」——上游 goal + verdict（评审结论）+ 产物清单（含存在性检查），不注入上游全文（防爆、防串味）
- **衔接而非脑补**：下游知道「上游做成了什么、评审怎么说的、产物在哪」，引用产物路径时 CLI 已在「引用的资料」段给出真实内容
- **防御提示**：上游未完成却轮到下游（脏数据）时亮明状态提示
- 测试 425（+1：摘要注入 / 产物清单 / 无依赖不注入 / 防御分支）

**依赖体系补漏**。定向执行不再静默绕过依赖顺序：

- **定向执行依赖警告**：`--task/--module` 定向执行时上游未完成 → summary 亮明「依赖未完成仍定向执行」警告（不拦截——定向是明确意图，自己的队列自己负责）
- **跨 filter 找上游修复**：定向执行会滤掉上游任务，此前依赖摘要段会丢——改为 filter 前保存全量 ID 映射，摘要与警告都跨 filter 生效
- **verdict 注入截断**：上游评审结论注入下游时 200 字符截断（防爆一致性）

**澄清留痕闭环**。体检补上「留痕没写完」的检测：

- **空章节检测**：正文有「## 澄清记录」标题但无实质条目 → suggest「章节为空——补条目：原模糊点 / 备选方案 / 应用的方案与理由」
- 测试 427（+2：定向警告跨 filter / 空章节三态）

## 0.2.34（2026-11-04）

**done 状态机修复**。验收未通过不再「一刀切 failed」：

- **未达上限回 todo**：第 N 次验收失败（N < max-attempts）→ 任务回 todo 可重试，接力能再次领取；failed 只属于达上限（此前第 1 次失败就标 failed，接力被 exit 12 拦停谎报「达上限」——一个失败尝试就能掐死整条链）
- **verdict 不污染**：失败路径不再写 AI 评审文本（此前 status=failed 配 verdict=「pass …」自相矛盾）；机器判定优先
- **failed 拦停提示动态化**：按 attempts vs 上限给出准确提示（防御旧脏数据谎报）
- **draft 验收拦截**：draft 任务（规格未补全）done 直接拦——验收门禁空跑无意义，与 run 拦 draft 同一语义
- 测试 417（+4：回 todo / 达上限才 failed / 接力重领 / draft 拦截）

**clarify 正文澄清度体检**。体检不再只看字段完备，也看内容实质：

- **正文澄清度三查**：正文空白 / 正文只是 goal 的复制品 / 正文残留模板占位符（骨架未填实）→ 各报建议级信号——此前这三种形态只要三必填齐全就被盖章「规格干净，无需澄清」（example 实测 8/36 任务正文零澄清，其中 2 个被体检误评干净）
- **占位符单一事实来源**：占位符集合从内置模板（`builtinTemplatePlaceholders`）导出，体检与模板永不脱节
- 测试 418（+1：正文澄清度三查）

**队列级视图归位 queue/reports/**。GUIDE.html / PANEL.html / CLARIFY.html / REPORT.html / QUEUE_REPORT.md 五个队列级视图文件不再平铺 queue/ 顶层，统一收进 queue/reports/（与批次级 overview/reports/ 命名呼应，queue/ 顶层只剩批次目录与 .taskchain）：

- **落盘迁移**：init 引导页、status --panel 面板、clarify --html 体检、report 账本 / --html 复盘全部写 queue/reports/（目录自动创建）
- **文案同步**：help 说明、引导页门户段落、报告 footer、命令成功提示全部指向新路径
- 旧位置文件不自动迁移：升级后手动把 queue/GUIDE.html 等挪进 queue/reports/ 即可（CLI 不删用户文件）

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
