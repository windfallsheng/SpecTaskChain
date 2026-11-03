# 契约冻结审计报告（1.0 冲刺 · 第一道坎）

> 本报告是 1.0 冲刺的第一份产出：把 SpecTaskChain 的五大机器间契约逐项审计，判定可冻结性，并钉死「冻结后若要演进，走什么通道」。
> 审计基准版本：0.2.14。审计方法：源码定义 ↔ 对外文档逐字段对照。

## 五大契约一览

| 契约 | 源码定义 | 对外文档 | 判定 |
| :--- | :--- | :--- | :--- |
| SPEC.md 规格格式 | `src/core/task-spec.ts` | [spec-format.md](spec-format.md) | ✅ 可冻结 |
| 队列目录布局 | `src/core/config.ts` + `src/core/queue.ts` | [queue-structure.md](queue-structure.md) | ✅ 可冻结 |
| state.json 账本 | `src/core/config.ts`（TaskRunState） | [queue-structure.md](queue-structure.md) | ✅ 可冻结（预留演进通道） |
| 退出码协议 | `src/core/runner.ts` + `src/cli.ts` | [relay-protocol.md](relay-protocol.md) | ✅ 可冻结 |
| [TASKQ_*] 标记协议 | 各 commands 输出 | [relay-protocol.md](relay-protocol.md) | ✅ 可冻结 |

## 审计发现（8 项，已全部处置）

### 文档漂移（5 项，已修正）

1. **spec-format.md 字段表不完整**——缺 `created-at` / `priority` / `tags` / `estimate` / `role` 五个元数据字段（代码早已支持）。已补全，并指向 queue-structure.md 元数据章。
2. **queue-structure.md 的 state.json 示例缺 `doingAt`**——doing 占位的领取时间戳（24h 超时重拾的依据），代码有、文档无。已补。
3. **state.json 损坏处理未写全**——文档只说「按空状态处理」，实际代码还会备份 `state.json.bak` + stderr 告警。已补。
4. **退出码 12 情形表不全**——批次不存在、定向目标不存在也是 12，此前只写了四种；`1`（兜底异常）完全未提。已补全为六情形 + exit 1 说明。
5. **目录树漏画两院一页**——`.taskchain/` 下 ROLES/ 与 TEMPLATES/ 缺席，queue/ 下的 HTML 四页（GUIDE/PANEL/CLARIFY/REPORT.html）未入树。已补。

### 结构风险（2 项，钉死演进通道）

6. **state.json 的 `version: 1` 是死字段**——结构当前稳定，但没有任何版本迁移逻辑。冻结承诺的前提是「1.0 后结构不再破坏性变更」；若未来真需要变，必须走 `version: 2` + 读侧迁移（读旧版升新版），绝不允许「写侧直接换格式让老项目账本失效」。**结论：结构冻结，version 字段保留作为演进通道的钥匙。**
7. **极简 YAML 解析器边界 = 契约边界**——SPEC.md frontmatter 用的是自研解析器，只支持两层缩进、内联数组、单双引号标量；不追求完整 YAML。这是刻意设计（轻而有骨），但 1.0 后这些边界就是契约的一部分：**frontmatter 只承载机器检查项，复杂结构进正文**。解析器边界已在 spec-format.md「解析器边界」节写明，冻结不扩容。

## 冻结承诺（发 1.0 时的语义）

以下契约自 1.0 起承诺**向后兼容**：老项目升级工具后，无需迁移即可继续接力：

- **SPEC.md**：三必填（goal/output/acceptance）+ 全部可选字段的解析语义；兼容简写（artifact/check 平铺）保留但标注为「旧式，不建议新写」。
- **队列目录布局**：`queue/batch-{NNN}/` + 旧式 `tasks/`（第 0 批）+ 顶层任务（含 SPEC.md）+ 模块（含 CONSTRAINTS.md）+ `.taskchain/{state.json,TASK_TYPES,ROLES,TEMPLATES}`；扫描只认结构，命名仪式不是契约。
- **state.json**：`{version: 1, tasks: {id: {status, attempts, doneAt?, doingAt?, verdict?}}}`；五态 todo/doing/done/failed/draft；损坏时 .bak 备份 + 空状态兜底。
- **退出码**：10 有任务 / 12 拦截（六情形）/ 0 清空 / 1 兜底异常。
- **[TASKQ_*] 标记**：PROMPT/SPEC_DRAFT/PIPELINE/GUIDE 四类块的边界与语义。

## 演进通道（冻结 ≠ 冻结死）

契约要演进时，只走三条路，且必须同步更新本报告：

1. **向后兼容的增量**（如新增可选 frontmatter 字段、新增退出码值）——正常发版，文档同步。
2. **结构性变更**（如 state.json 加字段）——`version` 升 2，读侧带迁移，写侧永远写新版；老版本工具读新账本必须降级可读或明确报版本。
3. **破坏性变更**——不允许出现在 1.x；只能进 2.0，且在 1.x 末期提供弃用预告。

## 1.0 剩余验证（本报告的后续动作）

- [ ] 真实项目全流程验证（非演示项目）：建任务 → 澄清 → 无人值守接力 → 归档 → 复盘
- [ ] 错误路径补强测试：损坏 SPEC.md / 损坏 state.json / 异常引用 / 重复 init
- [ ] design.md 体检（与 0.2.x 实装状态对齐）

---

*本报告生成于 0.2.14 契约审计；后续版本若动契约，必须同步更新本文。*
