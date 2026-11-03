# 项目目录布局：三类目录，各司其职

用 taskq 跑任务的项目里，目录只有三种身份。看懂这三类，就不会对「为什么多了个目录」「这个目录谁在管」犯迷糊。

## 第一类：队列本体（queue/）——taskq 唯一的管理区

任务、批次、状态账本都在这里。**除了它，taskq 不管理项目里的任何目录。**

```
queue/
├── batch-001/          ← 批次：一次要做的全部任务
│   ├── 01-task/        ← 任务目录（目录名 = 任务 ID）
│   │   └── SPEC.md
│   └── module-x/       ← 任务模块（共享 spec 的院落）
└── .taskchain/         ← state.json 账本 + 类型/角色/模板定义
```

完整规则见 [queue-structure.md](queue-structure.md)。

## 第二类：产出落位（docs/ data/ research/ …）——按任务类型自动归位

`taskq new "…" --type <类型>` 建任务时，类型决定了产出落到哪个目录。这是**默认约定**，任务执行时 prompt 里的「产出位置」和验收产物门禁都按它核对：

| 任务类型 | 默认产出目录 | 干什么的 |
| :--- | :--- | :--- |
| `doc` | `docs/` | 文档写作（Markdown，结构清晰、事实准确） |
| `research` | `research/` | 调研分析（结论有依据、引用标注来源） |
| `data` | `data/` | 数据整理（格式统一、含字段说明） |
| `presentation` | `presentation/` | 演示稿（Markdown 大纲 + 逐页内容） |
| `general` | `outputs/` | 通用任务（未声明类型时的回退） |
| `script` | `scripts/` | 脚本编写（代码任务） |
| `feature` / `bugfix` | `src/` | 功能开发 / 缺陷修复（代码任务） |

两条规则：

- **目录按需出现**：跑过 doc 类型任务才出现 `docs/`，跑过 data 类型才出现 `data/`。目录里的文件就是任务的产出——不是杂物，是账。
- **映射可以改**：自定义类型定义放 `.taskchain/TASK_TYPES/{类型}.md`，`output-dir` 想改成哪都行（见 [queue-structure.md](queue-structure.md) 的类型系统一节）。每个类型还带默认约束，执行时自动注入 prompt。

## 第三类：用户自组织区（materials/ specs/ logs/ …）——你说了算

这类目录 taskq **不认识也不管理**，名字、结构、用途完全由你定。典型用法：

| 目录 | 常见用途 | 与 taskq 的关系 |
| :--- | :--- | :--- |
| `materials/`（或 input/、raw/、素材/，随你叫） | 放待拆分的原材料文档 | 入口素材：`taskq split materials/x.md` 或 `taskq pipeline materials/` |
| `specs/` | 手写规格、接口文档等参考资料 | 可被 SPEC 引用，CLI 自动读取嵌入 prompt |
| `logs/` | 应用日志等真实数据 | 同上 |
| 任何你已有的目录 | 你的项目，你的地盘 | taskq 完全不碰 |

要点：**第二类目录是「任务做完什么，它就收什么」；第三类是「你放什么，它是什么」**。不要手动往 docs/data/research 里塞东西（它们收任务产出），素材类文件放第三类目录。

## 一个典型布局（SpecTaskChain-examples 示范）

```
项目根/
├── materials/      ← 第三类：入口素材（source-1.md …）
├── queue/          ← 第一类：队列本体（taskq 管）
├── docs/           ← 第二类：doc 类型产出（晨会纪要.md …）
├── data/           ← 第二类：data 类型产出（季度预算.csv …）
├── research/       ← 第二类：research 类型产出（竞品调研.md …）
├── presentation/   ← 第二类：presentation 类型产出
├── scripts/        ← 第二类：script 类型产出
└── specs/          ← 第三类：手写规格与参考资料
```

## 常见疑问

**跑完任务多了个 docs/，能不能删？** 那是任务产出，删了验收就缺货（产物门禁核对文件在不在）。不需要再删。

**为什么 materials/ 没人管？** 因为它是你的自由区。taskq 只关心你把它指给谁：split 拆它、pipeline 吃它。

**产出目录想统一放进 build/ 或 dist/ 之类？** 可以，自定义类型的 `output-dir` 写你要的路径即可；内置类型也可用同名自定义类型定义覆盖。
