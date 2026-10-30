# CHANGELOG

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
