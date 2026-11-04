# 命令参考大全

用法：`taskq <命令> [参数]`。全局参数：`--help` / `-h`（帮助）、`--version` / `-v`（版本）。

> 按「你要干什么」找用法？先看 [scenarios.md](scenarios.md) 场景手册（七个典型场景的完整过程 + 手动/自动双路线对照）；本页按命令查参数。

## taskq init

初始化队列骨架（幂等，重复执行不破坏已有数据）。

```
queue/tasks/                    ← 任务平铺目录
queue/.taskchain/state.json     ← 状态文件
queue/.taskchain/TASK_TYPES/    ← 自定义类型目录（管形态）
queue/.taskchain/ROLES/         ← 自定义执行角色（管专业，可带 applies-to 绑定）
queue/.taskchain/TEMPLATES/     ← 规格正文模板（{type}.md 类型级 / SPEC.md 通用）
```

```
taskq init [--tools 工具名[,工具名]] [--update]
```

| 参数 | 说明 |
| :--- | :--- |
| `--tools 工具名` | 生成宿主 AI 接力规则文件（教宿主如何读队列、执行 [TASKQ_PROMPT]、按退出码接力）。支持逗号分隔多个工具 |
| `--update` | 增量升级：把**已生成**的宿主规则文件刷新到 CLI 当前版本（对齐 speccore init --update 惯例）+ 补齐新骨架目录，可搭配 `--tools` 指定只刷新部分工具 |

> init 本身幂等：重复执行不破坏已有数据；工具规则刷新用 `--update` 语义更明确。

### 示例

```bash
taskq init                              # 只建骨架
taskq init --tools qoder                # 骨架 + .qoder/rules/taskq-relay.md
taskq init --tools qoder,cursor         # 多工具，逗号分隔
taskq init --tools claude               # 骨架 + CLAUDE.md 追加接力协议块
taskq init --update                     # CLI 升级后：刷新所有已生成的规则文件到最新版
taskq init --update --tools qoder       # 只刷新 qoder 的规则文件
```

### 工具 → 规则文件映射

| 工具 | 规则文件 | 写入方式 |
| :--- | :--- | :--- |
| qoder | `.qoder/rules/taskq-relay.md` | 独立文件 |
| claude | `CLAUDE.md` | 追加锚点块（已有内容保留） |
| cursor | `.cursor/rules/taskq-relay.md` | 独立文件 |
| windsurf | `.windsurf/rules/taskq-relay.md` | 独立文件 |
| trae | `.trae/rules/taskq-relay.md` | 独立文件 |
| codex | `AGENTS.md` | 追加锚点块（已有内容保留） |

SKILL 入口（命令下拉可见，薄包装对齐 speccore ask）：总入口 `/taskq-ask` + 高频专属 `/taskq-new /taskq-run /taskq-clarify /taskq-done`，共 5 个。qoder → `.agents/skills/`、claude → `.claude/skills/`、cursor → `.cursor/skills/`（各 5 个 SKILL.md）；windsurf/trae 无项目级 skill 约定，仅生成规则文件。旧版总入口 `taskq`（≤0.2.8）在 init/--update 时自动迁移清理为 `taskq-ask`。

## taskq new

建任务或模块子任务。**恒定 draft 骨架起步**：goal 填入你的原话，output/acceptance 留空，`draft: true`。

```
taskq new <描述> [--name 目录名] [--type 类型] [--group 模块名] [--due 明天/2026-11-30] [--draft]
```

| 参数 | 说明 |
| :--- | :--- |
| `<描述>` | 任务目标（用户原话，写入 goal） |
| `--name` | 任务名：英文直接作目录 slug；中文转全拼（如 迁移文档 → qianyiwendang）同时原样写入 frontmatter `name` 显示名。缺省 `task-序号`（取当前最大编号 +1） |
| `--type` | 任务类型（缺省 general，8 内置类型见 [queue-structure.md](queue-structure.md#任务类型)） |
| `--group` | 模块名——建为模块子任务（共享 spec 的院落，自动创建 CONSTRAINTS.md 模板；模块名同样 slug 化，中文显示名记入模板标题） |
| `--draft` | 静默落盘 draft 骨架，不请求 AI 草案 |
| `--due` | 截止日期：`YYYY-MM-DD` 直通，「今天/明天/后天/本周X/下周X」口语自动转日期；逾期任务在 `taskq list` 亮 🔴晚N天，`report` 出逾期清单 |

命名机制 = 「对话成规格」的前半步：目录名是 ASCII 机器身份，显示名（`name` 字段）是人类可读身份。`taskq ask "建个叫 auth 的任务：写登录"` 也能识别创建命名（叫 X 的 / --name / --group / 放 X 模块）。

同名目录/任务 ID 已存在时拒绝覆盖（不会悄悄吞掉旧任务），换个名字或先改名旧任务。

不带 `--draft` 时，输出 `[TASKQ_SPEC_DRAFT]` 标记，请求宿主 AI 生成规格草案（补全 output/acceptance/正文）写回 SPEC.md。

## taskq clarify

随叫随到的体检（详见 [clarify.md](clarify.md)）。

```
taskq clarify [--task 任务ID] [--file SPEC路径] [--chain] [--html] [--decide] [--no-report] [--report]
```

| 参数 | 说明 |
| :--- | :--- |
| `--task <id>` | 体检单个任务（写完查） |
| `--file <path>` | 体检任意 SPEC.md 文件（未入队也行） |
| `--chain` | 链级体检（建链查）：依赖悬空 + 产出冲突 + 模块约束 + 命名重复 + 循环依赖——只查链执行必翻车的硬伤，不逐任务报三必填（建链前任务可能还没写完） |
| `--html` | 体检报告可视化：queue/CLARIFY.html（三档红黄灰分组卡片，推荐方案置顶带评分徽章） |
| `--no-report` / `--report` | 报告开关（临时）：本次不生成澄清评估报告 / 强制生成（覆盖批次配置 `reports: false`）；缺省走配置链 |
| `--decide` | 判断题通道（exec 档专属）：TTY 下逐项裁决 y 采纳当前方案 / n 换下一个方案 / s 跳过；采纳写回 SPEC.md frontmatter `decisions` 留痕，下次体检跳过已决信号；非 TTY 只提示不等待 |
| （无参数） | 全队列体检（翻车查）：链级硬伤 + 各任务三必填全量；结束后后台生成澄清评估报告（MD+HTML 落批次 overview/reports/，不阻断终端输出） |

机械项（补 output/acceptance 骨架/role/摘 draft）不用手改：尾部提示里 `taskq fix --yes` 一处搞定。

## taskq fix

体检处方的执行者——只修 A 档机械项（改完必对），语义题一律不碰。

```
taskq fix [--task 任务ID] [--yes] [--dry-run] [--no-overwrite] [--overwrite]
```

| 参数 | 说明 |
| :--- | :--- |
| （无参数） | 全队体检后展示处方清单：TTY 下逐项确认 [y/N]（回车跳过）；非 TTY 只提示不等待 |
| `--task <id>` | 只修单任务（覆盖开关按该任务所属批次的配置判定） |
| `--yes` | 静默应用全部处方（非交互模式/宿主 AI 的授权开关） |
| `--dry-run` | 只预览处方不落盘（改什么字段、改成什么值） |
| `--no-overwrite` | 覆盖开关（临时）：本次只提示处方不覆盖写回 |
| `--overwrite` | 覆盖开关（临时）：强制覆盖写回（压过批次配置 `overwrite: false`） |

覆盖开关四级链：CLI 临时（`--no-overwrite`/`--overwrite`）> 任务级（SPEC.md `overwrite: false`）> 批次级（config/BATCH.yaml `overwrite`，按任务所属批次判定）> 系统默认（覆盖）。

四条底线：只动 frontmatter 已知字段 / 正文一字不碰 / 改前归档原文件到任务目录 `sources/SPEC.md` / 幂等（已满足不重复改）。

## taskq run

阶段流水线推进器（参考 speccore run 精髓）。**无参 = 智能续跑**：断点面板（队列统计 + 下一步）前置，再接单任务接力——从当前状态自然往下，不用告诉 CLI 从哪开始；**带阶段参数 = preset/范围剧本**：clarify → split → execute → report，宿主 AI 按剧本接力推进。

```
taskq run [--skip-draft] [--batch 批次|all] [--task ID] [--module 模块ID] [--no-report] [--report]   # 无参：智能续跑
taskq run clarify                          # preset：从体检推到报告（英文/中文别名：体检/拆分/执行/报告）
taskq run clarify to execute               # 范围：阶段 A 到 B（to / .. / → 等价）
taskq run split docs/prd.md                # 拆分阶段带素材（素材填进剧本命令）
taskq run clarify --auto                   # 全自动闸口：拦停点自动通过，仅失败停下
taskq run split --batch-size 5 --auto      # 组合：批量大小 + 非交互
```

- **断点面板**：无参时先输出队列统计（done/failed/doing/todo + 下一个接力任务），再走原有接力协议（退出码 0/10/12 不变）。
- **范围含 split 且无素材**：输出 `[TASKQ_NEEDS_INFO]` 提示（文档路径 / 目录 / 纯文字清单 / 截图），不猜素材。
- `--task ID` / `--module 模块ID`：定向执行（只跑单任务或单模块全部子任务），无匹配时明确报错不悄悄跑全量。
- `--no-report` / `--report`：报告开关（临时）——本次不生成完成评估报告 / 强制生成（覆盖批次配置 `reports: false`）。报告默认生成；长期开关见 `config/BATCH.yaml` 的 `reports`（批次级）与 SPEC.md 的 `reports: false`（任务级退出）。

| 退出码 | 含义 | 后续动作 |
| :--- | :--- | :--- |
| `10` | 有下一任务，prompt 已输出（任务已占位 doing） | 执行 → `taskq done` → 再 `taskq run` |
| `12` | 拦截，四种情形：下一任务是 draft / 模块缺共享 spec / 有任务正在执行中 / 任务失败需人工介入 | 按摘要指引处理 |
| `0` | 队列已清空 | 完成（后台自动生成完成评估报告：MD+HTML 落批次 overview/reports/） |

完整协议见 [relay-protocol.md](relay-protocol.md)。

## taskq execute

批次接力：一次领取 N 个任务的完整 prompt，宿主 AI 逐个开子任务执行、逐个 `done` 登记、连续取批。批内各 prompt 独立自包含（不用 subagent 也成立），拦停语义同 run。

```
taskq execute [--batch-size N] [--skip-draft] [--batch 批次|all] [--task ID] [--module 模块ID] [--no-report] [--report]
```

- `--batch-size N`：每批领取的任务数（默认 3）。单 prompt 有防爆限额，批总长可控。口语入口同样支持：「一次领 5 个」「批量执行三个」（阿拉伯/中文数字均可）。**批次配置可持久化默认**：批次目录 `config/BATCH.yaml` 的 `batch-size` 为本批默认，CLI 临时指令只当次生效不写回。
- `--skip-draft`：跳过 draft 拦停（批次配置 `skip-draft: true` 可对本批长期生效）。
- `--batch 批次|all`：聚焦指定批次或全队列（默认最新批次；批次配置按聚焦批次读取，`all` 时用系统默认）。
- `--task ID` / `--module 模块ID`：定向执行（同 run）。
- 批内首个任务占位 doing 后即拦停：同批内已有任务处于 doing（上一棒未登记）时，先停——账本只能有一个执行者。
- 批次配置全貌（batch-size / max-attempts / skip-draft + 优先级链与兜底）见 `queue-structure.md` 的「批次配置（config/BATCH.yaml）」节。

## taskq split

文档/文字/截图拆任务：从一份素材拆出任务草案（拆 → 确认 → 逐个完善）。超长文档（>30000 字符）自动截断并亮明原文路径。

```
taskq split <文件或文字> [--group 模块名] [--type 类型] [--auto]
```

- **截图入口**：素材是图片（png/jpg/webp/gif/bmp）时输出「第 0 步：视觉读取」——宿主 AI 先视觉读取截图转文字清单（忠实原文，看不清标「（不清）」），再按同一套规则拆分。
- **模块级任务识别**：标题层级（# 模块 / ## 子项）→ 模块 + 子任务；共享前提的任务群 → --group 聚合；彼此独立的条目平铺为单独任务。
- **混乱内容容错**：先梳理条目骨架（编号/换行/表格行/连续短句），散点聚合、混排切开；无结构可依按段落切并标注建议复核。
- `--auto` 非交互：拆分清单不拦停直接往下走（默认交互：清单停下问用户「拆分对不对」）。

## taskq pipeline

端到端流水线：素材（描述/文件/目录/截图）进 → 拆分 → 澄清 → 批次执行 → 复盘，编排归宿主 AI，三个拦停点保人工确认。

```
taskq pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N] [--auto]
```

- **截图入口**：素材含图片时先「第 0 步：视觉读取」转文字清单再拆（同 split）。
- **交互/非交互双模式**：默认交互（拦停点 1 拆分确认 / 2 体检门禁停下问用户）；`--auto` 非交互（拦停点 1/2 自动通过）；拦停点 3（任务失败需人工介入）两种模式都停，永不自动通过。

## taskq done

验收登记：机器当场跑产物/断言门禁，宿主 AI 传评审结论。

```
taskq done <task-id> [--verdict "pass|fail + 评审结论"] [--spent 6]
```

- 三态全过 → 登记 done，提示 `taskq run` 接力下一个。
- 任一不过 → attempts +1（上限 3），修正产出后重试。
- 达上限 → 标记 failed；`taskq run` 返回 `12` 拦停（修复是人工介入的活，机器不假装能自动修复）——修复产出后重新 `taskq done` 验收，或 `taskq reset <id>` 复位整单重跑。
- 未找到任务 → 报错并提示 `taskq list`。
- `--spent 6` 登记实际工时（小时）：报告自动长出「预估 vs 实际」差值栏与偏差汇总（超支+/省时-），是复盘估时准确度的数据底子。

## taskq reset

重跑复位：状态回 todo + attempts 清零。软复位留痕保留（重跑 = 基于现有内容调整补充），`--hard` 连 PROGRESS.md 留痕清空（重跑 = 从头再来）。产物文件两种模式都不删，重跑时按规格自然覆盖。

```
taskq reset <task-id|模块ID|batch-NNN|--all> [--hard]
```

- 目标支持：单任务 ID / 模块 ID（全部子任务）/ 批次 / `--all` 全队列。
- 复位后提示对应的 `taskq run --task/--module/--batch` 定向接力命令。

## taskq list

队列清单：全部任务（含模块子任务）与类型一览。

## taskq status

队列总览。

```
taskq status [--panel]
```

- 无参数：文本总览（done / failed / doing / todo 计数 + 模块一览 + 下一个接力任务）。
- `--panel`：生成 HTML 可视化面板。

## taskq report

队列报告（执行留痕，有账可查）：每个任务的尝试次数、验收结论、完成时间。

```
taskq report [--batch 批次] [--status 状态] [--type 类型] [--html]
```

| 参数 | 说明 |
| :--- | :--- |
| `--html` | 复盘报告可视化：queue/REPORT.html（状态分布 + 执行记录 + 失败红卡） |

工时账：预估总工时 / 实际总工时（done 时 `--spent` 登记）/ 预估 vs 实际差值（超支+/省时-/持平）+ 偏差明细 / 逾期清单（`--due` 到期未完成，红标在 list）。

## taskq history

操作轨迹（队列写操作的时间线回放）：何时建了任务 / 领取 / 验收 / 复位，一条流水全记下。

```
taskq history [--batch 批次] [--task ID] [--since 日期] [--limit N]
```

| 参数 | 说明 |
| :--- | :--- |
| `--batch batch-001` | 只看某批次（默认全部批次；跨批次操作如 `reset --all` 不匹配任何批次） |
| `--task ID` | 任务一生追踪：只看某任务的全部轨迹（「这任务怎么验收了两次」的最佳答法） |
| `--since 今天\|昨天\|YYYY-MM-DD` | 时间窗（口语日期自动转 YYYY-MM-DD；UTC 日界含当天） |
| `--limit N` | 显示最近 N 条（默认 30；`--limit 0` = 全量；超量时末尾提示总数） |

只记写操作（new/run/execute/done/reset 五类自动留痕），只读命令（list/status/report）不记——流水不被刷屏淹没。数据落 `.taskchain/op-log.json`（JSONL 追加式，损坏行局部跳过）。

与 report 分工：report 按任务聚合总账（这个任务的一生），history 按时间线回放流水（这个队列的一天）。

口语直达（taskq ask）：「最近做了什么」→ 全批次流水；「XX 怎么了」→ 该任务的一生追踪；「昨天做了什么」→ 时间窗。AI 接力规则（taskq init 生成）已含开场播报约定：新会话先跑 `history --limit 5` 报「上次干到哪了」。

```
📜 操作轨迹（全部批次，最近 5 条，倒序）

2026-11-04T08:30:12Z  验收  task-34-cshidaima  [batch-001] — 验收通过，实际工时 6h
2026-11-04T07:35:15Z  领取  task-34-cshidaima  [batch-001] — 领取执行
2026-11-04T07:30:02Z  新建  task-34-cshidaima  [batch-001] — 写客户端待迁移代码模块
```

## taskq ask

自然语言入口：意图识别 + 参数提取 + 精确执行。识别全部 CLI 命令（init/new/split/clarify/run/execute/pipeline/reset/done/list/status/report）。

**复合意图编排**（多动作词 + 时序词，参考 speccore ask 模式4）：一句话带多个动作时不再只接第一段，而是输出 `[TASKQ_ORCHESTRATE]` 编排剧本（步骤/命令/拦停点/模式），宿主 AI 按序接力。

```
taskq ask "建个任务：写三篇迁移文档"
taskq ask "拆分任务：写三篇迁移文档"     # split：提取素材后接力（退出码 10）
taskq ask "跑流水线 docs/新需求.md"      # pipeline：端到端一条龙
taskq ask "批量执行"                    # execute：一次领 N 个完整 prompt
taskq ask "一次领 5 个"                 # execute：口语指定批次大小（--batch-size 5）
taskq ask "初始化"                      # init
taskq ask "澄清一下"
taskq ask "跑队列"
taskq ask "重跑 34-cshidaima"           # 重跑复位：定向任务/模块/批次/--all，--hard 连留痕清空
taskq ask "从头再来"                    # = reset --all --hard（连留痕清空全队列）
taskq ask "看下进度"
taskq ask "出个报告"
taskq ask "澄清所有任务，然后批量执行"   # 编排：体检 → 执行（不再丢段）
taskq ask "拆分 docs/prd.md，然后澄清并执行，全自动"  # 编排 + 非交互（拦停点自动通过）
taskq ask "拆分，然后执行"              # 拆分缺素材 → NEEDS_INFO 提示
taskq ask "预算那批有哪些任务"          # 懒人批次：语义定位批次（list 聚焦）
taskq ask "上一批继续跑"                # 相对位次：run 定向上一批
```

- 「先X再Y」语序特判：「执行前先澄清」→ 澄清排前。
- 模板变量：批次（批次002 → batch-002）/ 批量（一次领 5 个 → 5）从原话提取填进剧本。
- **懒人批次解析（三层递进）**：用户嘴里的「预算那批」「上一批」照样听懂——精确编号（批次002 / batch-003 / 第二批）→ 相对位次（最新/上一/最早那批）→ 特征短语语义扫描（扫批次名/意图/任务名/目标打分，唯一最高分直落）。平局或零命中不瞎猜，输出 `[TASKQ_NEEDS_INFO]` 候选清单（批次名 + 任务数 + 命中证据）交 AI 挑；run/execute/status/report/list/new 全部先行裁决，编排剧本的 --batch 也由它落定。
- **最近使用批次默认**：没提批次时默认落「最近使用批次」（state.json 记忆：run/execute/new 领取、done 验收通过认领）> 最新批次；记忆的批次已删自动回退最新——昨天一直在跑 batch-001，今天说「继续跑」就回 batch-001，不会跳去编号更大的 batch-002。

重跑说法识别：「重跑/重新执行/重做/重来/复位/重置」→ reset；「继续跑/接着跑/重新开始执行」→ run；「重新建个任务」→ new（互不误吞）。无目标时不猜只给用法。

识别失败时输出可用命令与话术示例。识别到的意图路由：clarify / run / execute / pipeline / split / init / status / report / list / new / done / reset。

## taskq help

帮助与引导体系：总览 → 引导页 / 单命令详情 / HTML 引导页。

```
taskq help                 # 总览：命令表 + 目录布局 + 核心概念
taskq help guide           # 引导页（上手三步 + 三类目录 + FAQ）
taskq help <命令>          # 单命令详情（如 taskq help run）
taskq help guide --html    # 生成 HTML 引导页 queue/GUIDE.html（双击即看）
```

> HTML 引导页 `queue/GUIDE.html`：`taskq init` 自动生成（输出含 `[TASKQ_GUIDE: <path>]` 标记，宿主 AI 展示给用户）；内容 = 上手三步 + 目录布局 + 命令速查 + 核心概念 + 常见问题，与 `taskq status --panel` 生成的 PANEL.html 同院。

### HTML 页面体系（都长在 queue/ 下，双击即看）

| 页面 | 入口 | 旅程位置 |
| :--- | :--- | :--- |
| GUIDE.html | init 自动生成 / `help guide --html` | 进门——工具说明书 |
| PANEL.html | `status --panel` | 现状——队列仪表盘 |
| CLARIFY.html | `clarify --html` | 问题——体检报告（三档红黄灰分组） |
| REPORT.html | `report --html` | 复盘——执行账本（状态分布 + 失败红卡） |
| 批次 overview/reports/ 下的 CLARIFY_REPORT / DONE_REPORT（MD+HTML） | 全量澄清 / 队列清空后自动生成（后台不阻断） | 档案——澄清评估与完成评估（每任务 + 总体评级） |
