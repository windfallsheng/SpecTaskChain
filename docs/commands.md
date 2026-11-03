# 命令参考大全

用法：`taskq <命令> [参数]`。全局参数：`--help` / `-h`（帮助）、`--version` / `-v`（版本）。

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
taskq new <描述> [--name 目录名] [--type 类型] [--group 模块名] [--draft]
```

| 参数 | 说明 |
| :--- | :--- |
| `<描述>` | 任务目标（用户原话，写入 goal） |
| `--name` | 任务名：英文直接作目录 slug；中文转全拼（如 迁移文档 → qianyiwendang）同时原样写入 frontmatter `name` 显示名。缺省 `task-序号`（取当前最大编号 +1） |
| `--type` | 任务类型（缺省 general，8 内置类型见 [queue-structure.md](queue-structure.md#任务类型)） |
| `--group` | 模块名——建为模块子任务（共享 spec 的院落，自动创建 CONSTRAINTS.md 模板；模块名同样 slug 化，中文显示名记入模板标题） |
| `--draft` | 静默落盘 draft 骨架，不请求 AI 草案 |

命名机制 = 「对话成规格」的前半步：目录名是 ASCII 机器身份，显示名（`name` 字段）是人类可读身份。`taskq ask "建个叫 auth 的任务：写登录"` 也能识别创建命名（叫 X 的 / --name / --group / 放 X 模块）。

同名目录/任务 ID 已存在时拒绝覆盖（不会悄悄吞掉旧任务），换个名字或先改名旧任务。

不带 `--draft` 时，输出 `[TASKQ_SPEC_DRAFT]` 标记，请求宿主 AI 生成规格草案（补全 output/acceptance/正文）写回 SPEC.md。

## taskq clarify

随叫随到的体检（详见 [clarify.md](clarify.md)）。

```
taskq clarify [--task 任务ID] [--file SPEC路径] [--chain]
```

| 参数 | 说明 |
| :--- | :--- |
| `--task <id>` | 体检单个任务（写完查） |
| `--file <path>` | 体检任意 SPEC.md 文件（未入队也行） |
| `--chain` | 链级体检（建链查）：依赖悬空 + 产出冲突 + 模块约束 + 命名重复 + 循环依赖——只查链执行必翻车的硬伤，不逐任务报三必填（建链前任务可能还没写完） |
| （无参数） | 全队列体检（翻车查）：链级硬伤 + 各任务三必填全量 |

## taskq run

无人值守接力执行。输出第一个未完成任务的完整执行 prompt，**通过退出码与宿主 AI 对话**：

```
taskq run [--skip-draft] [--batch 批次|all] [--task ID] [--module 模块ID]
```

- `--task ID` / `--module 模块ID`：定向执行（只跑单任务或单模块全部子任务），无匹配时明确报错不悄悄跑全量。

| 退出码 | 含义 | 后续动作 |
| :--- | :--- | :--- |
| `10` | 有下一任务，prompt 已输出（任务已占位 doing） | 执行 → `taskq done` → 再 `taskq run` |
| `12` | 拦截，四种情形：下一任务是 draft / 模块缺共享 spec / 有任务正在执行中 / 任务失败需人工介入 | 按摘要指引处理 |
| `0` | 队列已清空 | 完成 |

完整协议见 [relay-protocol.md](relay-protocol.md)。

## taskq execute

批次接力：一次领取 N 个任务的完整 prompt，宿主 AI 逐个开子任务执行、逐个 `done` 登记、连续取批。批内各 prompt 独立自包含（不用 subagent 也成立），拦停语义同 run。

```
taskq execute [--batch-size N] [--skip-draft] [--batch 批次|all] [--task ID] [--module 模块ID]
```

- `--batch-size N`：每批领取的任务数（默认 3）。单 prompt 有防爆限额，批总长可控。
- `--batch 批次|all`：聚焦指定批次或全队列（默认最新批次）。
- `--task ID` / `--module 模块ID`：定向执行（同 run）。
- 批内首个任务占位 doing 后即拦停：同批内已有任务处于 doing（上一棒未登记）时，先停——账本只能有一个执行者。

## taskq split

文档拆任务：从一份 MD 或纯文字拆出任务草案（拆 → 确认 → 逐个完善）。超长文档（>30000 字符）自动截断并亮明原文路径。

```
taskq split <文件或文字> [--group 模块名] [--type 类型]
```

## taskq pipeline

端到端流水线：素材（描述/文件/目录）进 → 拆分 → 澄清 → 批次执行 → 复盘，编排归宿主 AI，三个拦停点保人工确认。

```
taskq pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N]
```

## taskq done

验收登记：机器当场跑产物/断言门禁，宿主 AI 传评审结论。

```
taskq done <task-id> [--verdict "pass|fail + 评审结论"]
```

- 三态全过 → 登记 done，提示 `taskq run` 接力下一个。
- 任一不过 → attempts +1（上限 3），修正产出后重试。
- 达上限 → 标记 failed；`taskq run` 返回 `12` 拦停（修复是人工介入的活，机器不假装能自动修复）——修复产出后重新 `taskq done` 验收，或 `taskq reset <id>` 复位整单重跑。
- 未找到任务 → 报错并提示 `taskq list`。

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

## taskq ask

自然语言入口：意图识别 + 参数提取 + 精确执行。识别全部 CLI 命令（init/new/split/clarify/run/execute/pipeline/reset/done/list/status/report）。

```
taskq ask "建个任务：写三篇迁移文档"
taskq ask "拆分任务：写三篇迁移文档"  # split：提取素材后接力（退出码 10）
taskq ask "跑流水线 docs/新需求.md"  # pipeline：端到端一条龙
taskq ask "批量执行"                # execute：一次领 N 个完整 prompt
taskq ask "初始化"                  # init
taskq ask "澄清一下"
taskq ask "跑队列"
taskq ask "重跑 34-cshidaima"     # 重跑复位：定向任务/模块/批次/--all，--hard 连留痕清空
taskq ask "从头再来"              # = reset --all --hard（连留痕清空全队列）
taskq ask "看下进度"
taskq ask "出个报告"
```

重跑说法识别：「重跑/重新执行/重做/重来/复位/重置」→ reset；「继续跑/接着跑/重新开始执行」→ run；「重新建个任务」→ new（互不误吞）。无目标时不猜只给用法。

识别失败时输出可用命令与话术示例。识别到的意图路由：clarify / run / execute / pipeline / split / init / status / report / list / new / done / reset。
