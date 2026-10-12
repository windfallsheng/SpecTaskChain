# SPEC.md 规格格式

**轻而有骨**：frontmatter 承载机器检查项（三必填），正文承载 AI 阅读项（自由表达）。

```
任务目录/
└── SPEC.md        ← 唯一必读文件
    ├── frontmatter（三必填 + 可选字段）
    └── 正文（自由，执行时全文注入 prompt）
```

## frontmatter 字段

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `goal` | ✅ | 目标，一句话也行（任务要做什么） |
| `output` | ✅ | 产出位置（相对项目根的目录，如 `docs/`、`src/auth/`） |
| `acceptance` | ✅ | 验收三态：artifacts + checks + review（至少一项非空） |
| `name` | 可选 | 显示名（人类可读，可中文）；目录名是 ASCII 机器身份，两者分工 |
| `type` | 可选 | 任务类型，缺省 `general`（见 [queue-structure.md](queue-structure.md#任务类型)） |
| `depends-on` | 可选 | 依赖的任务 ID 列表，声明后才参与拓扑排序 |
| `draft` | 可选 | `true` = 规格未补全，`taskq run` 会拦截（`--skip-draft` 强跑） |

## acceptance 三态写法

```yaml
acceptance:
  artifacts:          # 产物门禁：文件存在且非空（机器可查）
    - path: docs/migration-*.md     # glob 风格，* 不跨目录
      min: 3                        # 最少命中数（缺省 1）
  checks:             # 断言门禁：shell 命令退出码 0（机器可查）
    - grep -q '订单表' docs/migration-order.md
  review: 三篇文档结构一致，字段映射准确   # 评审门禁：AI 审查标准（软门禁）
```

兼容简写（单条场景）：`artifact` / `artifact-min` / `check` / `review` 可平铺在顶层，效果等同。三态至少一项非空才算填了 acceptance。

## 完整示例

```yaml
---
type: doc
goal: 写季度汇报 PPT 并发给张总
output: reports/
depends-on:
  - 01-task-data
acceptance:
  artifacts:
    - path: reports/quarterly.pptx
    - path: reports/.sent-marker.txt      # 发件留痕
  checks:
    - grep -q 'zhang@company.com' reports/.sent-marker.txt
  review: PPT 结构完整，邮件已发送，用户已收到通知
---
1. 写 PPT 到 reports/quarterly.pptx
2. 通过系统 Mail 发送给 zhang@company.com，主题「季度汇报」，正文附 PPT
3. 发件成功后把发件记录（收件人/时间/主题）写入 reports/.sent-marker.txt
4. 全部完成后在对话中明确通知用户
```

要点：

- 正文是自由文本，执行时**全文注入** prompt，AI 完整理解。
- 正文中的引用（`[标题](相对路径)` / 裸路径 / URL）由 CLI 消解：本地文件读全文嵌入、图片给绝对路径供视觉读取、外部链接尝试抓取。**基准 = 项目根**（与 output/artifacts 一致）。读不到会报 clarify 阻塞 + prompt 告警。
- 动作型要求（发邮件、发通知、上传……）写在正文里，是任务的一部分，必须执行。
- **留痕即产物**：副作用动作必须有留痕（如 `.sent-marker.txt`），留痕进产物门禁，机器才查得清。

## 执行留痕（PROGRESS.md）

任务目录内可放 `PROGRESS.md`：执行时每完成一个阶段更新一句（做到了哪、在等什么）。断点续跑时全文注入 prompt，提示「按留痕续做，不要从头重做」——跨会话、跨工具续跑都靠它接上。

## draft 语义

- `draft: true`：规格未补全。`taskq run` 返回退出码 `12` 拦截，提示先 clarify；`--skip-draft` 强跑。
- 退出码 `12` 的另一种情况：模块子任务缺共享 spec（CONSTRAINTS.md 缺失/为空）——先补写模块约束再接力。
- `taskq new` 建的任务恒定 `draft: true` 起步——补全规格（clarify 通过）后把 `draft: true` 删掉即可放行。

## 解析器边界

内置极简 YAML 解析器，只服务 SPEC.md 的结构：

- 支持两层缩进（section 层 + 列表项层 + 子键层），不追求完整 YAML 规范。
- 顶层值、列表项值支持 `"..."` / `'...'` 引号（自动剥离）。
- 顶层 `key: [a, b]` 内联数组会解析为列表。
- 解析失败的任务会被静默跳过（不会报错，`taskq list` 里看不到它——体检靠 clarify 的 --file 入口）。
