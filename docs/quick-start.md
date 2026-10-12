# 快速上手

五步闭环：**init → new → clarify → run → done**。跑通一遍，你就理解了 SpecTaskChain 的全部工作方式。

## 第一步：init —— 初始化队列骨架

```bash
taskq init
```

产出（幂等，重复执行不破坏已有数据）：

```
queue/
├── tasks/                       ← 任务平铺在这里
└── .taskchain/
    ├── state.json               ← 状态文件（断点续跑的唯一事实源）
    └── TASK_TYPES/              ← 自定义任务类型定义
```

## 第二步：new —— 建任务（对话成规格）

```bash
taskq new "写三篇数据迁移文档，覆盖用户、订单、支付模块" --type doc
```

发生了什么：

1. 任务目录 `queue/tasks/01-task-01/SPEC.md` 落盘，**恒定 draft 骨架起步**（goal 已填你的原话，output/acceptance 留空，`draft: true`）。
2. 输出 `[TASKQ_SPEC_DRAFT]` 标记——请求宿主 AI 生成规格草案：补全 output（产出位置）、acceptance（验收三态）、正文细节。
3. AI 写回 SPEC.md 后，任务从骨架变成完整规格。

**写规格三式**：

| 式 | 场景 | 命令 |
| :--- | :--- | :--- |
| 对话成规格 | 一句话描述，AI 展开成完整规格 | `taskq new "描述"` |
| 验收先行 | 心里已有「怎么算做完」，直接写完整 SPEC.md | 手动写文件 |
| 渐进补全 | 先占个坑，稍后补 | `taskq new "描述" --draft`（不请求 AI 草案） |

## 第三步：clarify —— 随叫随到的体检

```bash
taskq clarify --task 01-task-01
```

体检报告分三级：⛔ 阻塞（缺三必填、依赖悬空、产出冲突）/ ⚠️ 建议（模糊词、指代不明、验收只有软门禁）/ ⏳ 待定（draft 标记）。

处理权全在你：补（改规格）/ 给默认值（不吭声按默认走）/ 标记 draft（执行前再补）/ 无视（自己的队列自己负责）。详见 [clarify.md](clarify.md)。

## 第四步：run —— 无人值守接力

```bash
taskq run
```

输出下一个未完成任务的完整 prompt（规格全文 + 模块公共约束 + 验收标准 + 输出协议），并返回退出码：

- `10`：宿主 AI 执行 prompt 内容 → 完成后 `taskq done` 登记验收 → 再次 `taskq run` 接力下一个
- `12`：下一任务是 draft（规格未补全）——先 clarify 补全，或 `--skip-draft` 强跑
- `0`：队列已清空，全部完成

完整协议见 [relay-protocol.md](relay-protocol.md)。

## 第五步：done —— 验收登记

```bash
taskq done 01-task-01 --verdict "pass 三篇文档结构清晰，覆盖三个模块"
```

机器当场跑门禁：

```
✅ 产物门禁 [docs/migration-*.md] 命中 3 个
✅ 断言门禁 [grep -q '订单' docs/migration-user.md] exit=0
🧠 评审门禁：pass 三篇文档结构清晰，覆盖三个模块
✅ 验收通过
```

验收没过？修正产出后重试 `taskq done`。同一任务最多尝试 3 次，之后标记 failed（`taskq run` 仍会重新拾起，修好继续）。详见 [acceptance.md](acceptance.md)。

## 循环

```
taskq run  →  AI 执行 prompt  →  taskq done  →  taskq run  →  ...
（exit 10）                   （验收三态）      （接力下一个）
```

直到 `taskq run` 返回 `0`——队列清空，无人值守接力完成。

## 贯穿全程的两个「随叫随到」

- `taskq status --panel`：队列总览 + HTML 可视化面板
- `taskq report`：队列报告（每个任务的尝试次数、验收结论、耗时，有账可查）

## 下一步

- 规格怎么写：[spec-format.md](spec-format.md)
- 队列怎么组织：[queue-structure.md](queue-structure.md)
- 验收怎么设计：[acceptance.md](acceptance.md)
