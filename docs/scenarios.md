# 场景手册：从场景出发的完整使用过程

> 本手册按「你要干什么」组织，与 [commands.md](commands.md)（按命令查参数）互补。文中的所有命令输出均取自真实 CLI 运行，不是示意图。

## 两条路线总览：手动把关 vs 自动推进

SpecTaskChain 的一切命令都可归入两条路线。同一件事，两条路线都能做，差别只在**拦停点谁来点头**。

| 维度 | 手动路线（交互，默认） | 自动路线（非交互） |
| :--- | :--- | :--- |
| 拦停点 | 停下问用户，点头才继续 | 自动通过，**仅失败停下** |
| 触发方式 | 什么都不加就是手动；`taskq ask "…"` 编排默认交互 | `--auto` / 原话带「全自动」/ `--yes` |
| 典型拦停点 | split 拆分清单确认、clarify 体检门禁、fix 逐项确认、pipeline 拦停点 1/2 | `pipeline --auto`、`ask "…全自动"`、`fix --yes` |
| 适合场景 | 首次拆解、规格把关、心里没底的任务 | 跑熟了的队列、宿主 AI 接力、夜里无人值守 |

### 「自动」其实有三层，别混

1. **无人值守接力**（天然自动）：`taskq run` 输出下一任务的完整 prompt 并返回退出码 10，宿主 AI 执行完调 `taskq done` 再 `taskq run`，如此循环直到退出码 0。这个循环里**没有拦停点**——AI 一路接力，这就是最基本的「自动」。
2. **编排非交互**（显式要求）：`taskq ask "…全自动"` / `pipeline --auto` / `split --auto` 把拦停点也改成自动通过，只剩「失败停下」这一道闸。
3. **静默应用**：`taskq fix --yes` 把体检处方逐项确认改成一次性应用（宿主 AI 的授权开关）。

三条线叠加 = 全自动无人值守；只用第 1 层 = 接力自动、拦停点仍把关。你按需组合。

---

## 场景一：从零到交付（手动路线，新手必经）

目标：建一个任务，把规格补齐，跑完验收。这是全部命令的最小闭环。

### 第 1 步：init —— 初始化队列骨架

```bash
taskq init --tools qoder        # 骨架 + 宿主 AI 接力规则（可换 claude/cursor/windsurf/trae/codex）
```

产出 `queue/` 骨架与 `.taskchain/`（状态文件、自定义类型/角色/模板目录）。**幂等**：重复执行不破坏已有数据；CLI 升级后用 `taskq init --update` 刷新接力规则。

### 第 2 步：new —— 建任务（对话成规格）

```bash
taskq new "写三篇迁移文档" --type doc --draft
```

真实输出：

```
✅ 任务「task-xiesanpianqianyiwendang」已入队 → 批次 batch-001（draft 态：等待规格补全，补全前 taskq run 会拦截）

  类型：doc（非代码任务)
  可用类型：general / doc / script / data / research / presentation / feature / bugfix，自定义类型放 .taskchain/TASK_TYPES/{类型}.md
```

发生什么：

- 任务目录 `queue/batch-001/task-xiesanpianqianyiwendang/SPEC.md` 落盘，**恒定 draft 骨架起步**：goal 已填你的原话，output/acceptance 留空，`draft: true`。
- `--draft` = 静默落盘不请求 AI 草案；不带 `--draft` 时输出 `[TASKQ_SPEC_DRAFT]` 标记，宿主 AI 生成规格草案写回 SPEC.md。
- `--due 明天` / `--estimate 8` 等数据字段随时可带（见 [commands.md](commands.md#taskq-new)）。

### 第 3 步：clarify —— 随叫随到的体检

```bash
taskq clarify --task task-xiesanpianqianyiwendang
```

真实输出：

```
澄清报告（随叫随到的体检，处理权在你）

### ⛔ 阻塞（1）
- [task-xiesanpianqianyiwendang] 缺少必填项 acceptance（验收）（三必填：goal/output/acceptance）

### ⚠️ 建议（2）
- [task-xiesanpianqianyiwendang] 未估工时（estimate）——报告汇总不出预估总量…
- [task-xiesanpianqianyiwendang] 未指定角色——执行时 AI 按任务内容自动选择（类型建议：document-writer）…

### ⏳ 待定（1）
- [task-xiesanpianqianyiwendang] 规格标记为 draft（未澄清/未补全），执行前建议先补全

🔧 可自动修复 3 处：taskq fix --task task-xiesanpianqianyiwendang（--yes 应用 / --dry-run 预览）
```

发生什么：体检分四档——⛔ 阻塞（缺三必填等硬伤）/ ⚠️ 建议（模糊词、没估工时、没定角色）/ ⏳ 待定（draft 标记）/ 🤖 可执行性风险（超出 AI 能力圈，方案带评分）。处理权全在你：补规格、给默认值、标记 draft、无视。

### 第 4 步：fix —— 机械项一处修完

```bash
taskq fix --task task-xiesanpianqianyiwendang --dry-run   # 先预览处方
```

真实输出：

```
🔧 可自动修复 3 处：
  [1] task-xiesanpianqianyiwendang：补 role: document-writer（按类型 doc 自动匹配）
  [2] task-xiesanpianqianyiwendang：补 acceptance 三态骨架（产物=outputs/batch-001/task-xiesanpianqianyiwendang/；断言待填，评审待人工）
  [3] task-xiesanpianqianyiwendang：摘除 draft（三必填已齐，可以接力）

--dry-run：预览不落盘。确认后：taskq fix --yes
```

确认无误后 `taskq fix --yes` 一次性应用（**只修 A 档机械项，语义题一律不碰**；改前归档原文件到 `sources/`，幂等不重复改）。acceptance 的断言与评审是语义题，仍要你亲手补——这就是手动路线把守的关。

### 第 5 步：run —— 无人值守接力

```bash
taskq run
```

真实输出（规格补齐后）：

```
📍 断点面板（智能续跑：从当前状态往下走，不用告诉 CLI 从哪开始）

队列总览：共 1 个任务
  ✅ done: 0   ⛔ failed: 0   ▶ doing: 1   ⏳ todo: 0

▶ 接力推进：下个任务「task-xiesanpianqianyiwendang」（第 1 次尝试）

[TASKQ_PROMPT]
你正在执行 SpecTaskChain 队列中的一个任务（接力推进：干完这个，下个接着来）。

## 任务规格（SPEC.md 全文，用户自由表达，请完整理解）
### 目标
写三篇迁移文档
### 任务类型
doc（非代码任务，与代码世界绝缘)
### 产出位置
outputs/batch-001/task-xiesanpianqianyiwendang/
…
```

发生什么：断点面板先亮队列统计与下一个接力任务，然后输出该任务的**完整 prompt**（规格全文 + 验收标准 + 输出协议），并把任务占位 `doing`，返回退出码 10。宿主 AI 执行 prompt 内容即可。

> 如果规格仍是 draft，`taskq run` 会拦停（返回 12）并提示：`建议先 taskq clarify --task <ID> 补全；或 taskq run --skip-draft 强跑`。

### 第 6 步：done —— 验收登记

```bash
taskq done task-xiesanpianqianyiwendang --verdict "pass 三篇文档已生成" --spent 4
```

机器当场跑三态门禁（产物/断言/评审），全过输出：

```
✅ 「task-xiesanpianqianyiwendang」已登记完成（实际工时 4h）。继续接力：taskq run
```

没过输出（产物门禁不实，比如镜像院落还没写出文件）：

```
❌ 验收未通过（第 1/3 次尝试）。修正产出后重试：taskq done task-xiesanpianqianyiwendang --verdict "..."
```

发生什么：`--spent 4` 登记实际工时，报告自动长出「预估 vs 实际」偏差账；同一任务最多尝试 3 次，达上限标记 failed。验收通过后再 `taskq run` 接力下一个任务，直到退出码 0 队列清空。

### 第 7 步：report —— 有账可查

```bash
taskq report              # 文本账本：每次尝试、验收结论、工时偏差、逾期清单
taskq report --html       # queue/REPORT.html 复盘报告（双击即看）
```

至此手动路线闭环：**init → new → clarify → fix → run → done → report**。

---

## 场景二：无人值守接力（自动路线一）

目标：把整队任务交给宿主 AI 连续跑完，人只处理失败。

### 接力循环长什么样

```
taskq run  →  输出 prompt（任务占位 doing）→  宿主 AI 执行  →  taskq done  →  taskq run  →  …
（exit 10）                               （写产出）       （三态验收）     （下一个）
```

- **退出码 10** = 有下一任务，prompt 已输出，宿主 AI 干完继续接力；
- **退出码 12** = 拦停（draft 未补全 / 有任务 doing 中 / 任务 failed 需人工介入 / 模块缺共享 spec）；
- **退出码 0** = 队列清空，后台自动生成完成评估报告。

完整协议见 [relay-protocol.md](relay-protocol.md)。

### 执行中拦停（账本只能有一个执行者）

任务被 `run` 占位 doing 后，若没登记 done 就又跑 `run` / `execute`，CLI 拦停：

```
⏳ 任务「task-xiesanpianqianyiwendang」正在执行中（2026-11-04T07:35:15.378Z 领取）。执行者完成后会调 taskq done 登记；若执行者已中断，超过 24 小时自动重拾
```

### 批量版：execute 一次领 N 个

```bash
taskq execute --batch-size 3       # 一次领 3 个任务的完整 prompt（默认 3）
taskq execute --batch-size 5       # 一次领 5 个
taskq ask "一次领 5 个"            # 口语入口，同一件事
```

一次输出 N 个自包含 prompt，宿主 AI 逐个执行、逐个 `done` 登记、连续取批。适合「今晚把这一队全跑完」的无人值守场景。批次默认大小可持久化到 `config/BATCH.yaml` 的 `batch-size`。

---

## 场景三：一句话需求端到端（pipeline 双模式对照）

目标：一句话需求，从拆解到执行完一条龙。这是「自动 vs 非自动」对照最直观的场景。

### 手动路线（默认交互）

```bash
taskq pipeline "做一个用户积分功能"
```

真实输出（剧本头部）：

```
🏭 SpecTaskChain 端到端流水线：素材进 → 任务出 → 执行完 → 账可查

📝 素材为纯文字描述（未检测到文件路径）

[TASKQ_PIPELINE]
你是 SpecTaskChain 流水线编排者。按下面的五阶段剧本推进（交互（每个拦停点停下问用户））。
…
**拦停点 1**：输出拆分清单（目录名 + 一句话 goal + 模块归属）给用户确认，问「拆分对不对，要不要调整」——用户点头才进阶段 2。
```

三个拦停点：**1 拆分确认 → 2 体检门禁 → 3 失败介入**。手动路线下，1 和 2 都停下问用户。

### 自动路线（--auto）

```bash
taskq pipeline "做一个用户积分功能" --auto
```

真实输出（同处差异）：

```
[TASKQ_PIPELINE]
你是 SpecTaskChain 流水线编排者。按下面的五阶段剧本推进（非交互（--auto，拦停点自动通过，仅失败停下））。
```

发生什么：拦停点 1/2 自动通过；**拦停点 3（任务失败需人工介入）两种模式都停，永不自动通过**——机器不假装能自动修复。

### 同一需求走 ask 编排

```bash
taskq ask "拆分 docs/prd.md，然后澄清并执行，全自动"
```

真实输出（剧本头部）：

```
🎯 已编排「拆分任务 → 体检澄清 → 接力执行」流程（3 步，非交互（全自动））
📍 批次：batch-001

[TASKQ_ORCHESTRATE]
…
步骤 1/3：拆分任务（拦停点）
步骤 2/3：体检澄清（拦停点）
步骤 3/3：接力执行（拦停点）

执行约定：
- 退出码 10 = 接力继续；12 = 停下（draft 未补全 / doing 进行中 / failed 需人工介入），把情况亮给用户
- 非交互模式（用户原话要求全自动）：拦停点自动通过不打断；仅退出码 12（失败）时停下报告
[/TASKQ_ORCHESTRATE]
```

不带「全自动」时同一句话输出 `交互（默认）` 模式——拦停点逐个停下问用户。**这就是双模式的分水岭：原话里带不带「全自动」三个字。**

---

## 场景四：拆分素材（split 交互 vs 非交互）

目标：把一份文档/文字清单/截图拆成任务草案。

```bash
taskq split docs/prd.md                # 文件路径
taskq split "写周报邮件 / 整理会议纪要 / 复盘十月故障"   # 纯文字清单
taskq split docs/需求.png              # 截图：先「第 0 步视觉读取」转文字再拆
```

真实输出（纯文字素材）：

```
📄 拆分来源：对话文字（23 字符）

[TASKQ_PROMPT]
你是 SpecTaskChain 的任务拆分助手。把下面的素材拆分成任务草案，落盘到队列。

## 拆分规则（钉死的边界）
1. 拆分管「拆得对不对」：每个任务 = 英文 slug 目录名 + 一句话 goal + 正文初步内容…
2. 严禁编写 acceptance 验收三态——「怎么算做完」是每个任务的第一公民，留到逐个完善阶段由用户亲自点头。
3. 任务粒度适中：一个任务一件事，不拆太碎、不硬合并…
4. 模块级任务识别：标题层级（# 模块 / ## 子项）→ 模块目录 + 子任务平铺…
…
```

发生什么：宿主 AI 按规则拆出草案清单。**默认交互**——清单停下问「拆分对不对」；`split --auto` 非交互——清单不拦停直接往下走。拆分只负责「拆得对不对」，验收三态永远留给后续逐个完善阶段由用户点头（这是拆分管与执行管的边界）。

超长文档（>30000 字符）自动截断并亮明原文路径。

---

## 场景五：自然语言入口（ask 的懒人用法）

目标：平时说话怎么顺口就怎么说，CLI 负责听懂。识别全部命令：init / new / split / clarify / run / execute / pipeline / reset / done / list / status / report。

### 单意图一句话

```bash
taskq ask "建个任务：写三篇迁移文档"        # → new（对话成规格）
taskq ask "拆分任务：写三篇迁移文档"        # → split（提取素材后接力，退出码 10）
taskq ask "跑流水线 docs/新需求.md"         # → pipeline（端到端一条龙）
taskq ask "批量执行"                        # → execute（一次领 N 个完整 prompt）
taskq ask "一次领 5 个"                     # → execute --batch-size 5
taskq ask "澄清一下"                        # → clarify 全队列体检
taskq ask "跑队列"                          # → run 接力
taskq ask "重跑 34-cshidaima"               # → reset 定向任务（--hard 连留痕清空）
taskq ask "从头再来"                        # → reset --all --hard
taskq ask "看下进度"                        # → status
taskq ask "出个报告"                        # → report
taskq ask "初始化"                          # → init
```

### 复合意图编排（多动作词 + 时序词）

一句话带多个动作，不再只接第一段，而是输出 `[TASKQ_ORCHESTRATE]` 编排剧本：

```bash
taskq ask "澄清所有任务，然后批量执行"       # 编排：体检 → 执行（交互（默认））
taskq ask "拆分 docs/prd.md，然后澄清并执行，全自动"   # 编排 + 非交互
taskq ask "拆分，然后执行"                  # 拆分缺素材 → NEEDS_INFO 提示（不猜素材）
```

真实输出（交互版头部）：

```
🎯 已编排「体检澄清 → 接力执行」流程（2 步，交互（默认））
📍 批次：batch-001

[TASKQ_ORCHESTRATE]
你是 SpecTaskChain 编排执行者。按下面的步骤依次推进，每步用对应 CLI 命令执行，每步完成才能进下一步。

步骤 1/2：体检澄清（拦停点）
  - taskq clarify 全量体检；阻塞项先修（taskq fix --yes 机械项），非全绿不往下走
步骤 2/2：接力执行（拦停点）
  - taskq execute 批量接力，宿主 AI 循环续跑直到队列清空
```

语序特判：「执行前先澄清」→ 澄清排前（先 X 再 Y 的语序不会丢）。

### 懒人批次三件套（口语找批次）

1. **明说**走三层解析：精确编号（批次002 / batch-003 / 第二批）→ 相对位次（最新/上一/最早那批）→ 特征短语（「预算那批」扫批次名/意图/任务名打分，唯一最高分直落）。
2. **没说**默认「最近使用批次」——state.json 记忆，run/execute/new 领取、done 验收认领，记忆的批次已删自动回退最新。
3. **都不确定**：平局或零命中不瞎猜，输出 `[TASKQ_NEEDS_INFO]` 候选清单（批次名 + 任务数 + 命中证据）交 AI 挑。

```bash
taskq ask "预算那批有哪些任务"      # 语义定位批次（list 聚焦）
taskq ask "上一批继续跑"            # 相对位次：run 定向上一批
taskq ask "看下任务清单"            # 无批次词：默认最近使用批次
```

> 典型分歧场景：batch-002 已经建好，但你昨天一直在跑 batch-001。今天说「继续跑」——回 batch-001（最近使用），而不是跳去编号更大的 batch-002。

---

## 场景六：任务失败与重跑

目标：任务验收屡次不过、或想推倒重来。

### 失败是怎么产生的

`taskq done` 验收三态任一不过 → attempts +1（上限 3）；达上限 → 标记 failed：

```
❌ 验收未通过（第 1/3 次尝试）。修正产出后重试：taskq done task-xiesanpianqianyiwendang --verdict "..."
```

failed 后 `taskq run` 仍会重新拾起（断点面板指向它），返回 12 拦停——修复是人工介入的活，机器不假装能自动修复。

### 两条修复路

**路 A：修复产出，原地验收**（适合产出有瑕疵、规格本身没问题）

```bash
# 人工修好产出文件
taskq done task-xiesanpianqianyiwendang --verdict "pass 修复后重验"
```

**路 B：复位重跑**（适合规格也要改、或想从头再来）

```bash
taskq reset task-xiesanpianqianyiwendang            # 软复位：状态回 todo + attempts 清零（留痕保留 = 基于现有内容调整补充）
taskq reset task-xiesanpianqianyiwendang --hard     # 硬复位：连 PROGRESS.md 留痕清空（从头再来）
taskq reset batch-001                               # 复位整批
taskq reset --all --hard                            # 全队列从头再来（= ask "从头再来"）
```

两种模式都不删产出文件，重跑时按规格自然覆盖。复位后提示对应的定向接力命令（`taskq run --task/--module/--batch`）。

---

## 场景七：多批次并行（批次怎么用）

目标：多个主题同时推进，各不干扰。

### 建批次与入队

```bash
# 批次由任务首次入队自动创建；也可先手动建目录 + BATCH.md（写 name/purpose 供语义定位）
taskq new "写周报" --batch batch-001        # 指定批次入队（批次须已存在）
taskq new "整理发票" --batch batch-002      # 另起一批
```

### 聚焦与默认

```bash
taskq run --batch batch-001                  # 只跑指定批次
taskq run --batch all                        # 全批次平铺
taskq list --batch batch-002                 # 只看一批
taskq status                                # 总览：非最新且最近使用过会亮「← 最近使用」标记
```

### 批次「脾气」持久化

批次目录 `config/BATCH.yaml` 可写 `batch-size`（默认领几个）/ `max-attempts`（尝试上限）/ `skip-draft`（draft 不拦停）/ `reports`（是否出报告），对本批长期生效——一次配置，每次 `run/execute` 自动按批次脾气来。

---

## 附：场景 × 命令速查

| 你要干什么 | 手动路线（把关） | 自动路线（推进） |
| :--- | :--- | :--- |
| 建一个任务 | `taskq new "描述" --type doc` | `taskq new "描述" --draft`（静默落盘） |
| 补齐规格 | `taskq clarify --task ID` → 手动补 | `taskq fix --yes`（机械项一处修完） |
| 跑完一个任务 | `taskq run` → 执行 → `taskq done` | 宿主 AI 按退出码 10 自动循环接力 |
| 跑完一队任务 | `taskq execute --batch-size 3` | 同上（批量 prompt 连续取批） |
| 一句话需求到交付 | `taskq pipeline "需求"`（拦停点逐个点头） | `taskq pipeline "需求" --auto` / `ask "…全自动"` |
| 拆一份素材 | `taskq split docs/prd.md`（清单停下确认） | `taskq split docs/prd.md --auto` |
| 任务失败处理 | 人工修产出 → `done` 重验 | `reset ID --hard` 后重新接力 |
| 口语找批次 | `ask "预算那批有哪些任务"` | `ask "上一批继续跑"` / 不说即最近使用 |
| 看进度与账本 | `taskq status --panel` / `taskq report` | `ask "看下进度"` / `ask "出个报告"` |

更多参数细节：[commands.md](commands.md)；接力协议：[relay-protocol.md](relay-protocol.md)；规格写法：[spec-format.md](spec-format.md)；队列组织：[queue-structure.md](queue-structure.md)。
