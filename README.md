# SpecTaskChain

规格驱动的任务队列。**Chain = 接力（relay），不是依赖（dependency）。**

一次建一堆任务，无人值守在一个时间段内接力完成——做完一个接下一个，断了接着跑，直到队列清空。

> **账本在文件里，不在任何 AI 的脑子里。** 队列规格、任务状态、验收结论全部落盘。在 WorkBuddy 上执行到一半中止了，换 Qoder 接着跑，`taskq run` 一执行，谁来了都读到同一本账。规格是第一公民，AI 是可替换的执行者。

## 核心理念

- **队列是第一公民**：任务是平铺的一堆要做的事，大多数任务之间没有依赖关系；有共享 spec 时才引入任务模块。
- **规格轻而有骨**：SPEC.md 的 frontmatter 三必填（goal / output / acceptance）+ 正文自由，用户可增可删，保证读得到就行。
- **验收先行**：怎么算做完是必填第一公民——产物门禁（文件存在非空）+ 断言门禁（shell 退出码 0）+ 评审门禁（AI 审查结论），三态缺一不算完。
- **澄清随叫随到**：澄清是用户自己的操作行为，四个入口——写完查 / 建链查 / 翻车查 / 随口查。
- **上下文隔离**：不用 subagent 也成立——prompt 自包含（一次一任务的完整规格）+ 账本文件化（换会话续跑）+ 模块约束重读；且所有大文本进 prompt 前限额截断，超长亮明原文路径供 AI 按需 Read，上下文不爆炸。
- **CLI 是确定性机器**：只做扫描、校验、门禁、状态，不做外部副作用。发邮件、发通知这类动作由执行任务的宿主 AI 完成，机器负责给每一次副作用留字据。

## 安装

```bash
npm install -g spec-taskchain
```

## 升级

```bash
npm update -g spec-taskchain        # 升级 CLI 本体
taskq init --update                 # 项目根执行：刷新宿主接力规则 + 补齐骨架目录（幂等）
```

- **零配置零迁移**：CLI 不落任何配置文件，升级即用。`.taskchain/` 下的一切（state.json 账本、TASK_TYPES 类型、ROLES 角色、TEMPLATES 模板）都是你的资产，升级只补不碰。
- **升级动作只有一步**：`taskq init --update` 把宿主工具接力规则刷新到 CLI 当前版本（新能力说明随之更新），并补齐新骨架目录（ROLES/、TEMPLATES/）。
- **老资产零感知兼容**：旧式 `tasks/` 目录兼容第 0 批；旧角色名（coder/tester/doc-writer…）走别名归一，无需改名；已落盘的任务与模板原样可读。

## 快速开始

```bash
taskq init --tools qoder                             # 初始化骨架 + 生成宿主工具接力规则（--update 可刷新到最新版）
taskq new "写三篇迁移文档" --type doc                # 建任务：落盘 draft 骨架，AI 生成规格草案
taskq clarify --task 01-qianyiwendang               # 体检单个任务（三必填齐了没有、有没有模糊词）
taskq run                                           # 无人值守接力：输出下一任务的完整 prompt
taskq done 01-qianyiwendang --verdict "pass 结构清晰"  # 验收登记（产物/断言/评审三态门禁）
taskq status --panel                                # 队列总览 + HTML 可视化面板
taskq report                                        # 队列报告（执行留痕，有账可查）
taskq ask "看下进度"                                 # 口语入口
```

## 命令速查

| 命令 | 说明 |
| :--- | :--- |
| `taskq init [--tools 工具名[,工具名]] [--update]` | 初始化队列骨架（幂等）+ 生成/刷新宿主工具接力规则（qoder/claude/cursor/windsurf/trae/codex） |
| `taskq new <描述> [--type 类型] [--group 模块名] [--batch 批次] [--priority P1] [--tags a,b] [--estimate 8] [--draft]` | 建任务/模块子任务（恒定 draft 骨架起步） |
| `taskq clarify [--task ID] [--file 路径] [--chain]` | 随叫随到的体检（四入口） |
| `taskq pipeline <描述或文件或目录> [--type 类型] [--group 模块] [--batch 批次] [--batch-size N]` | 端到端流水线（素材进→拆分→澄清→执行→收尾，编排归宿主 AI） |
| `taskq run [--skip-draft] [--batch 批次\|all]` | 无人值守接力执行（默认聚焦最新批次；输出下一任务 prompt + 退出码） |
| `taskq execute [--batch-size N] [--skip-draft] [--batch 批次\|all]` | 批次接力（一次领取 N 个任务的完整 prompt，默认 3；拦停语义同 run） |
| `taskq done <task-id> [--verdict "..."]` | 验收登记（产物/断言/评审三态门禁） |
| `taskq list [--batch 批次] [--status 状态] [--type 类型]` | 队列清单（按批次分组，三扇窗筛选） |
| `taskq status [--panel] [--batch 批次\|all]` | 队列总览（--panel 生成 HTML 可视化面板） |
| `taskq report [--batch 批次] [--status 状态] [--type 类型]` | 队列报告（执行留痕，有账可查） |
| `taskq ask "自然语言"` | 口语入口（建任务/澄清/跑队列/看进度） |

完整参数与行为见 [docs/commands.md](docs/commands.md)。

## 文档导航

| 文档 | 内容 |
| :--- | :--- |
| [docs/quick-start.md](docs/quick-start.md) | 快速上手：五步闭环 + 写规格三式 |
| [docs/spec-format.md](docs/spec-format.md) | SPEC.md 规格格式：三必填、验收三态、完整示例 |
| [docs/queue-structure.md](docs/queue-structure.md) | 队列组织：平铺任务 / 任务模块 / 依赖 / 类型系统 / 状态文件 |
| [docs/acceptance.md](docs/acceptance.md) | 验收三态门禁详解 + 留痕即产物原则 |
| [docs/relay-protocol.md](docs/relay-protocol.md) | AI 接力协议：退出码、prompt 块、跨工具续跑 |
| [docs/clarify.md](docs/clarify.md) | 澄清体检：四入口、三级信号、处理四式 |
| [docs/commands.md](docs/commands.md) | 命令参考大全 |
| [docs/design.md](docs/design.md) | 设计决策、能力边界与路线图 |

## 队列结构

```
queue/
├── batch-001/               ← 批次目录：一次要做的全部任务（下次要再建 batch-002…）
│   ├── BATCH.md             ← [可选] 批次元数据（name/purpose/created-at）
│   ├── 01-qianyiwendang/    ← 顶层任务：目录名 = 任务 ID（编号全局递增）
│   │   └── SPEC.md
│   └── module-auth/         ← 任务模块（共享 spec 的院落，module- 前缀）
│       ├── CONSTRAINTS.md   ← 模块公共约束（顶部可加 name/purpose/created-at 元数据）
│       └── 02-denglujiekou/ ← 第三层子任务
│           └── SPEC.md
└── .taskchain/
    ├── state.json          ← 状态文件（断点续跑的唯一事实源）
    ├── TASK_TYPES/         ← 自定义任务类型定义（管形态）
    ├── ROLES/              ← 自定义执行角色（管专业，可带 applies-to 绑定）
    └── TEMPLATES/          ← 规格正文模板（{type}.md 类型级 / SPEC.md 通用）
```

**批次（batch-NNN）**：一次要做的所有任务装一个批次目录。`taskq run`/`status` 默认聚焦最新批次（新批次插队先跑），老批次 `--batch` 点名再跑；旧式 `tasks/` 目录兼容为第 0 批。

**元数据（都可选）**：任务 SPEC.md 的 `created-at`/`priority`/`tags`/`estimate`（new 自动落 created-at，`--priority P1 --tags 客户,Q4 --estimate 8` 一次落全）；批次 BATCH.md 与模块 CONSTRAINTS.md 顶部 frontmatter 挂 name/purpose/created-at。list/report 支持 `--batch`/`--status`/`--type` 三扇窗筛选，任务行带 ⚑优先级 ⏱工时徽章，报告汇总总工时与优先级分布。

## AI 接力协议（一句话版）

`taskq run` 输出 `[TASKQ_PROMPT]` 块并返回退出码，宿主 AI 据此接力：

- `0`：队列已清空，全部完成
- `10`：有下一任务——执行 prompt 块内容 → `taskq done` 登记验收 → 再次 `taskq run`
- `12`：拦截——四种情形：下一任务是 draft（先 clarify 补全或 `--skip-draft` 强跑）/ 模块缺共享 spec（先补 CONSTRAINTS.md）/ 有任务正在执行中（doing 占位，执行者完成后 done）/ 任务失败需人工介入（修复后重新 `taskq done` 验收）

完整协议（含跨工具续跑、无人值守与人工介入的边界）见 [docs/relay-protocol.md](docs/relay-protocol.md)。

## 能力清单（v0.2.1）

- **批次架构**：batch-NNN 多批次目录，聚焦语义（new 落最新 / run 跑最新 / --batch 点名），旧 tasks 兼容
- **命名仪式**：任务目录语义 slug（--name 优先 → goal 全拼 → 类型键兜底），模块 module- 前缀，编号全局递增不撞账本键
- **元数据与筛选**：created-at/priority/tags/estimate + 批次/模块可选元数据 + list/report 三扇窗筛选
- **执行角色（role）**：type 管形态、role 管专业——内置 10 专业化角色（document-writer/code-engineer/debug-engineer/data-analyst…，旧名别名兼容）+ 自定义 .taskchain/ROLES/（同名覆盖内置，applies-to 按类型/任务自动套用）；什么都没指定时 AI 按任务内容自动选角（类型建议可推翻）
- **规格模板**：正文按模板骨架落盘——任务 TEMPLATE.md > .taskchain/TEMPLATES/{类型}.md > TEMPLATES/SPEC.md 通用 > 系统内置，用户逐层覆盖
- **批次接力（execute）**：一次领取 N 个任务的完整 prompt，宿主 AI 按序执行、逐个 done、连续取批
- **端到端流水线（pipeline）**：素材（描述/文件/目录）进 → 拆分 → 澄清 → 批次执行 → 复盘，三个拦停点保人工确认
- `taskq split`：从一份文档拆分出任务草案（拆 → 确认 → 逐个完善）
- 引用消解：SPEC 中引用的文件/图片/链接由 CLI 读取真实内容嵌入 prompt
- 模块约束加固：CONSTRAINTS.md 缺失即阻塞，绝不静默裸奔
- 执行留痕：PROGRESS.md 承载步骤级进度，断点恢复到 skill 步骤边界
- 动作义务：执行 prompt 钉死「动作型要求是任务的一部分，必须执行」
- 上下文防爆：规格正文 / 留痕 / 约束 / 引用 / 拆分输入进 prompt 前一律截断（各有限额），超长亮明原文路径供宿主 AI 按需 Read；引用注入双层限额（单件 16K + 总量 20K + 6 件）——单 prompt 封顶，批内 N 个独立注入总长可控

## License

MIT
