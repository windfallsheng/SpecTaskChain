# 命令参考大全

用法：`taskq <命令> [参数]`。全局参数：`--help` / `-h`（帮助）、`--version` / `-v`（版本）。

## taskq init

初始化队列骨架（幂等，重复执行不破坏已有数据）。

```
queue/tasks/                    ← 任务平铺目录
queue/.taskchain/state.json     ← 状态文件
queue/.taskchain/TASK_TYPES/    ← 自定义类型目录
```

## taskq new

建任务或模块子任务。**恒定 draft 骨架起步**：goal 填入你的原话，output/acceptance 留空，`draft: true`。

```
taskq new <描述> [--name 目录名] [--type 类型] [--group 模块名] [--draft]
```

| 参数 | 说明 |
| :--- | :--- |
| `<描述>` | 任务目标（用户原话，写入 goal） |
| `--name` | 自定义目录名（英文 slug，缺省 `task-序号`；中文自动转随机序号占位） |
| `--type` | 任务类型（缺省 general，8 内置类型见 [queue-structure.md](queue-structure.md#任务类型)） |
| `--group` | 模块名——建为模块子任务（共享 spec 的院落，自动创建 CONSTRAINTS.md 模板） |
| `--draft` | 静默落盘 draft 骨架，不请求 AI 草案 |

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
| `--chain` | 全链体检：依赖悬空 + 产出冲突（建链查） |
| （无参数） | 全队列体检（翻车查） |

## taskq run

无人值守接力执行。输出第一个未完成任务的完整执行 prompt，**通过退出码与宿主 AI 对话**：

```
taskq run [--skip-draft]
```

| 退出码 | 含义 | 后续动作 |
| :--- | :--- | :--- |
| `10` | 有下一任务，prompt 已输出 | 执行 → `taskq done` → 再 `taskq run` |
| `12` | 下一任务是 draft | `taskq clarify` 补全，或 `--skip-draft` 强跑 |
| `0` | 队列已清空 | 完成 |

完整协议见 [relay-protocol.md](relay-protocol.md)。

## taskq done

验收登记：机器当场跑产物/断言门禁，宿主 AI 传评审结论。

```
taskq done <task-id> [--verdict "pass|fail + 评审结论"]
```

- 三态全过 → 登记 done，提示 `taskq run` 接力下一个。
- 任一不过 → attempts +1（上限 3），修正产出后重试。
- 达上限 → 标记 failed；`taskq run` 仍会重新拾起（修好继续）。
- 未找到任务 → 报错并提示 `taskq list`。

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

自然语言入口：意图识别 + 参数提取 + 精确执行。

```
taskq ask "建个任务：写三篇迁移文档"
taskq ask "澄清一下"
taskq ask "跑队列"
taskq ask "看下进度"
taskq ask "出个报告"
```

识别失败时输出可用命令与话术示例。识别到的意图路由：clarify / run / status / report / list / new / done。
