# 队列组织与状态

队列是第一公民：一堆任务平铺，无人值守接力完成。三种关系正交——**共享上下文（任务模块）、执行顺序（依赖声明）、接力完成（队列本身）**。

## 目录组织

```
queue/
├── tasks/                    ← 任务平铺（按目录名排序）
│   ├── 01-task-01/           ← 顶层任务：目录 = 任务 ID
│   │   └── SPEC.md
│   └── auth/                 ← 任务模块：共享 spec 的院落
│       ├── CONSTRAINTS.md    ← 模块公共约束（每次执行子任务前重读）
│       └── 01-task-02/       ← 第三层子任务：目录名 = 任务 ID
│           └── SPEC.md
└── .taskchain/
    ├── state.json            ← 状态文件
    └── TASK_TYPES/           ← 自定义任务类型定义
```

规则：

- **任务 ID = 目录名**（如 `01-task-01`、`auth/01-task-02` 的子任务 ID 是 `01-task-02`）。
- 顶层含 `SPEC.md` 的目录是任务；否则按模块目录扫描（`CONSTRAINTS.md` + 第三层子任务）。
- 任务目录内可自由放置材料文件（图片、数据等）：在 SPEC.md 正文中引用（`[标题](相对路径)` 或裸路径），执行时由 CLI 消解为真实内容嵌入 prompt（基准 = 项目根）；引用的文件不存在会报阻塞，绝不静默跳过。
- 代码与产出**不在任务目录内**：代码写到 SPEC.md 的 `output` 声明的项目根路径，任务目录只放规格。

## 任务模块（共享 spec 的院落）

一组子任务共享同一份前提时，聚合成模块：

```bash
taskq new "登录页表单校验" --group auth --type feature
```

- `CONSTRAINTS.md` 是模块的公共约束（相当于共享 spec），**每次执行子任务前都重新读取**，注入该子任务的执行 prompt——等于每个子任务执行时都重置一遍必须的提示词。
- `CONSTRAINTS.md` 缺失或为空 = 阻塞（`taskq run` 返回 exit 12，clarify 报 blocking）——共享 spec 是必读前提，绝不静默裸奔。
- 首个子任务入模块时自动创建 `CONSTRAINTS.md` 模板，往里填共享约束即可。
- 模块约束不替代子任务规格：子任务自己的 SPEC.md 三必填照旧。

## 依赖声明（可选属性）

```yaml
depends-on:
  - 01-task-data
```

- 只有声明 `depends-on` 的任务才参与拓扑排序，多数任务按目录序平铺。
- 依赖目标不存在 → clarify 报 ⛔ 阻塞（依赖悬空）。
- 循环依赖不阻断执行：按原序平铺，clarify 建议排查。

## 执行顺序

1. 先顶层任务（目录序），再模块子任务（目录序）。
2. 声明了 `depends-on` 的任务按依赖深度排序（依赖先执行），同深度保持目录序。
3. `taskq run` 每次找**第一个未完成任务**（状态为 todo / draft / failed 或不存在记录）。

## 任务类型

内置 8 种：

| 类型 | 代码形态 | 默认产出 | 说明 |
| :--- | :--- | :--- | :--- |
| `general` | 否 | `outputs/` | 通用任务（缺省回退） |
| `doc` | 否 | `docs/` | 文档写作 |
| `script` | 是 | `scripts/` | 脚本编写 |
| `data` | 否 | `data/` | 数据整理 |
| `research` | 否 | `research/` | 调研分析 |
| `presentation` | 否 | `presentation/` | 演示稿 |
| `feature` | 是 | `src/` | 功能开发 |
| `bugfix` | 是 | `src/` | 缺陷修复 |

自定义类型：`.taskchain/TASK_TYPES/{类型}.md`（YAML frontmatter）：

```yaml
---
code: true                 # 是否为代码任务
output-dir: tools/
constraints:               # 类型默认约束，每次执行注入 prompt
  - 脚本可独立运行，含必要注释与错误处理
description: 内部工具开发
---
```

类型定义文件不存在或损坏时回退通用非代码定义。核心规则：**非代码类型默认与代码世界绝缘，显式声明 `code: true` 才切代码形态**——执行 prompt 里会明确告知 AI。

## 状态文件（state.json）

```json
{
  "version": 1,
  "tasks": {
    "01-task-01": {
      "status": "done",            // todo / doing / done / failed / draft
      "attempts": 2,               // 尝试次数
      "doneAt": "2026-10-12T10:00:00.000Z",
      "verdict": "pass 结构清晰"    // 验收结论
    }
  }
}
```

- **断点续跑的唯一事实源**：任务状态、尝试次数、验收结论全部落盘。
- 状态缺失（文件损坏）时按空状态处理，任务视为未完成重新接力。
- `state.json` 是机器账本，手动改前先备份；跨工具接力（换 IDE/换 AI 工具）不需要任何迁移——文件就在队列里。

## 断点续跑语义

任何时候中止（会话断、工具崩、人走开），下次 `taskq run` 重新扫描全队列 + 读状态，确定性找到第一个未完成任务继续。规格与状态在第一公民位置，执行者 AI 是谁不重要。
