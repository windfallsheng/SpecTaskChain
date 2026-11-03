# 队列组织与状态

队列是第一公民：一堆任务平铺，无人值守接力完成。三种关系正交——**共享上下文（任务模块）、执行顺序（依赖声明）、接力完成（队列本身）**。

## 目录组织

```
queue/
├── batch-001/               ← 批次目录：一次要做的全部任务（当前批次，新任务落这里）
│   ├── BATCH.md             ← [可选] 批次元数据（name/purpose/created-at）
│   ├── 01-task-01/           ← 顶层任务：目录 = 任务 ID
│   │   └── SPEC.md
│   └── module-auth/          ← 任务模块：共享 spec 的院落（module- 前缀 = CLI 生成时的模块标记）
│       ├── CONSTRAINTS.md    ← 模块公共约束（每次执行子任务前重读；顶部可加 name/purpose/created-at 元数据）
│       └── 02-task-02/       ← 第三层子任务：目录名 = 任务 ID
│           └── SPEC.md
├── batch-002/               ← 下次要做的另一批任务（mkdir 手工建，建完即插队为最新批次）
├── GUIDE.html               ← HTML 引导页（init 生成；同院兄弟：PANEL/CLARIFY/REPORT.html）
└── .taskchain/
    ├── state.json            ← 状态文件
    ├── TASK_TYPES/           ← 自定义任务类型定义
    ├── ROLES/                ← 自定义执行角色定义
    └── TEMPLATES/            ← 规格正文模板（类型级 + 通用级）
```

规则：

- **批次目录 = 「一次要做的所有任务」的容器**：`batch-{NNN}`（NNN 三位补零）。下次要用再建下一个（`mkdir queue/batch-002`），可建任意多个。旧式 `tasks/` 兼容为第 0 批（老项目继续工作）。
- **聚焦语义**：`taskq run`/`status` 默认只聚焦最新批次（数字序最大者；无 batch-* 时 tasks 兜底）；`taskq new` 默认把新任务落最新批次；老批次用 `--batch <批次名>` 手动指定，`--batch all` 全批次。
- **任务 ID = 目录名**（如 `01-task-01`、`module-auth/02-task-02` 的子任务 ID 是 `02-task-02`）。
- **编号全局递增**：序号跨所有批次取最大 +1（batch-002 里的任务接着排，不从 01 重新开始）——任务 ID 全局唯一，state.json 的键永不撞车。
- 顶层含 `SPEC.md` 的目录是任务；否则按模块目录扫描（`CONSTRAINTS.md` + 第三层子任务）。
- **命名仪式**：CLI 新建时任务目录 = `{NN}-{slug}`（`--name` 优先；无 `--name` 时从 goal 提取语义 slug，中文转全拼，提不出用任务类型键兜底——`01-script` 而非 `01-task`）；模块目录 = `module-{slug}`（语义化前缀一眼区分于任务目录，已带前缀不叠加）；批次目录 = `batch-{NNN}`。用户手工建的目录不受仪式约束——扫描只认结构（有无 SPEC.md），名字叫什么都认。
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

## 元数据（可选：不写照样跑）

三层各有户口本，**静态归规格、动态归账本、聚合靠推导**——都可不填，填了就有筛选和汇总的能力：

### 任务（SPEC.md frontmatter）

```yaml
---
type: doc
created-at: 2026-10-28     # 创建日期（new 自动落盘；手工建的任务以目录出生时间兜底）
priority: P1               # 优先级（P0/P1/P2 或自由值）
tags:                      # 标签（自由关键词，跨批次按主题筛）
  - 客户
  - Q4
estimate: 8                # 预估工时（小时）
role: security-reviewer    # 执行角色（type 管形态，role 管专业；见「执行角色」章）
goal: ...
output: ...
acceptance: ...
---
```

`taskq new "描述" --priority P1 --tags 客户,Q4 --estimate 8` 一次落全。

### 批次（BATCH.md）与模块（CONSTRAINTS.md 顶部）

```yaml
---
name: 十月攻坚批次        # 显示名（list 展示）
purpose: 一批要做的全部任务  # 一句话意图
created-at: 2026-10-01
---
```

- `BATCH.md` 放批次目录根下；模块元数据写在 `CONSTRAINTS.md` 顶部 frontmatter（注入 prompt 时自动剥离，只注入约束正文）。
- 批次/模块的**完成状态与进度不落盘**——从任务状态聚合推导（单一事实源是 state.json）。

### 批次配置（BATCH.yaml）——每个批次的「脾气」

```yaml
version: 1           # schema 版本戳（升级维护用）
batch-size: 3        # 每批领取任务数（一次 execute 领几个）
max-attempts: 3      # 任务失败重试上限（验收不通过累计达上限即 failed）
skip-draft: false    # 是否跳过 draft 拦停（true = 未澄清也照跑）
```

- **自动生成**：建批次（`taskq new` 首个批次 / `init`）自动落盘，注释详尽；已存在绝不覆盖（用户手改是最高优先级资产）。
- **优先级链（每项独立生效）**：CLI 临时指令 > 批次配置 > 系统默认——`taskq execute --batch-size 2` 只当次生效不写回；`taskq ask "一次领 5 个"` 同理。
- **三级兜底**：文件缺失 → 全默认；内容损坏 → 备份 BATCH.yaml.bak + 告警 + 全默认；单字段异常（负数/非数/类型错）→ 只回落该字段，其余照常生效。
- **升级维护**：只加键不改语义；旧文件缺新键自动取系统默认，未知键忽略，双向向前兼容，无需迁移脚本。

### 筛选三扇窗（list / report）

```bash
taskq list --batch batch-001 --status todo --type doc   # AND 组合

taskq report --status failed                             # 报告同样可筛
```

- `--batch` 聚焦批次 / `--status` 按状态 / `--type` 按类型；无命中时明确提示而非空列表。
- `list` 任务行展示优先级/工时徽章（⚑P1 ⏱8h）；`report` 执行记录表含优先级列，尾部汇总预估总工时与优先级分布。

## 依赖声明（可选属性）

```yaml
depends-on:
  - 01-task-data
```

- 只有声明 `depends-on` 的任务才参与拓扑排序，多数任务按目录序平铺。
- 依赖目标不存在 → clarify 报 ⛔ 阻塞（依赖悬空）。
- 循环依赖不阻断执行：按原序平铺，clarify 建议排查。

## 执行顺序

1. **默认只接力最新批次**（`--batch` 可指定老批次或 `all` 全批次）；批次内先顶层任务（目录序），再模块子任务（目录序）。
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

## 执行角色（可选：type 管形态，role 管专业）

`role` 与 `type` 正交：type 管「产出什么形态」（代码与否/产出位置/默认约束），role 管「以什么专业身份干」（角色立场/专业关注点/角色禁忌，执行时注入 prompt）。

- **内置角色**（10 个，命名语义化 + 专业化）：generalist（通才兜底）/ document-writer（文档写作）/ code-engineer（代码工程）/ debug-engineer（缺陷修复）/ test-engineer（测试工程）/ security-reviewer（安全审查）/ devops-engineer（运维工程）/ data-analyst（数据分析）/ research-analyst（调研分析）/ presentation-designer（演示设计）。旧名（doc-writer/coder/tester/ops/analyst/designer）走别名零感知兼容
- **自定义角色**：`.taskchain/ROLES/{角色}.md`（YAML frontmatter：stance/focus/taboos/description/applies-to），与 TASK_TYPES 同模式；同名自定义角色覆盖内置（用户压过系统）
- **角色绑定（applies-to）**：定义角色时声明适用场合——`types: [doc, research]` 按任务类型套用，`tasks: [01-xxx]` 按任务 ID 精确套用（压过类型绑定）。同一类型多个角色绑定 → 取文件名字典序第一个，执行 prompt 与 clarify 都会亮明冲突
- **AI 自动选择（内容驱动）**：任务既没显式 role 也没绑定命中时，执行 prompt 注入角色菜单 + 类型建议（bugfix→debug-engineer、data→data-analyst……），宿主 AI 按任务内容定夺最专业的角色，可推翻建议；选定后建议把 role 写回 SPEC.md 固化（下次免重复决策）。clarify 也会提示未固化角色
- **声明了但找不到定义**：执行 prompt 亮明回退通才，clarify 也会提示

## 规格模板（生成 SPEC 正文的骨架）

new 落盘时正文即模板骨架，宿主 AI 在骨架内补全细节；对话成规格的 prompt 也会按模板引导。覆盖链（具体到通用，用户覆盖系统）：

1. **任务级**：任务目录内 `TEMPLATE.md`（某个任务自有的模板，最高优先）
2. **类型级**：`.taskchain/TEMPLATES/{类型}.md`（如 doc.md / bugfix.md，只管这一种类型）
3. **通用级**：`.taskchain/TEMPLATES/SPEC.md`（所有类型的兜底骨架）
4. **系统内置**：8 种类型各有一套内置骨架（doc 有背景/大纲/结构，bugfix 有问题/根因/修复/回归……）

new 输出会亮明本次模板来源；模板只管正文章节骨架，frontmatter 三必填（goal/output/acceptance）与 draft 标记不受模板影响。

## 批次接力（taskq execute）与端到端流水线（taskq pipeline）

- `taskq execute [--batch-size N]`：run 的批量化——一次领取 N 个任务的完整 prompt（默认 3），宿主 AI 按序执行逐个 done，批内全部完成再次 execute 取下一批。拦停语义与 run 完全一致（draft/模块缺共享 spec/doing 活跃/failed 需人工介入），批截止于拦停任务并亮明原因。
- `taskq pipeline <描述或文件或目录>`：端到端流水线剧本——采集（CLI 确定性：目录递归文本文件/多文件/纯文字）→ 拆分（宿主 AI，只出 goal+初步内容）→ 澄清（用户亲自点头验收三态）→ 执行（execute 批次接力）→ 收尾（report 复盘）。三个拦停点（拆分清单确认/澄清全绿/失败介入），编排归宿主 AI。

## 状态文件（state.json）

```json
{
  "version": 1,
  "tasks": {
    "01-task-01": {
      "status": "done",            // todo / doing / done / failed / draft
      "attempts": 2,               // 尝试次数
      "doneAt": "2026-10-12T10:00:00.000Z",
      "doingAt": "2026-10-12T09:00:00.000Z",  // 领取时间（doing 占位，超 24h 自动重拾）
      "verdict": "pass 结构清晰"    // 验收结论
    }
  }
}
```

- **断点续跑的唯一事实源**：任务状态、尝试次数、验收结论全部落盘。
- 状态文件损坏时备份为 `state.json.bak` + stderr 告警，按空状态处理——重跑比丢账更诚实。
- `state.json` 是机器账本，手动改前先备份；跨工具接力（换 IDE/换 AI 工具）不需要任何迁移——文件就在队列里。

## 上下文防爆（prompt 尺寸有上限）

执行 prompt 自包含但不会无限膨胀——无上限注入必爆上下文（Speccore 项目的教训）。所有大文本进 prompt 前一律截断，超长时亮明原文路径，宿主 AI 按需 Read：

| 注入源 | 上限 | 截断策略 |
|:---|:---|:---|
| 规格正文（SPEC.md） | 12000 字符 | 截头部 + 亮明 SPEC.md 路径 |
| 执行留痕（PROGRESS.md） | 4000 字符 | 留尾部（断点续跑看「最新做到哪」） |
| 模块约束（CONSTRAINTS.md） | 8000 字符 | 截头部 + 亮明 CONSTRAINTS.md 路径 |
| 引用资料（references） | 4000 / 16384 字符单件 + 20000 总量 + 6 件数量 | 双层限额（对齐 speccore：超预算只亮路径） |
| 流水线素材（pipeline） | 20000 / 50000 字符 | 单文件 / 总量 |
| 拆分输入（split） | 30000 字符 | 截头部 + 建议按章节分段拆分 |

批内 N 个 prompt 各自独立注入，单 prompt 封顶 → 批总长 = N × 单上限，可控。

## 断点续跑语义

任何时候中止（会话断、工具崩、人走开），下次 `taskq run` 重新扫描全队列 + 读状态，确定性找到第一个未完成任务继续。规格与状态在第一公民位置，执行者 AI 是谁不重要。
