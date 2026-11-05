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

## 第二类：产出院落（任务目录内 outputs/）——产出与任务同住

每个任务的产出默认落在**自己的任务目录内 `outputs/`**——哪个任务的货一眼即知，删任务目录连带清产出：

```
queue/batch-002/task-xiewendang/SPEC.md
queue/batch-002/task-xiewendang/outputs/xiewendang.md   ← 文档类精确到 {slug}.md

queue/batch-003/module-budget/yusuan-cesuan/SPEC.md
queue/batch-003/module-budget/yusuan-cesuan/outputs/    ← 代码/数据类不猜文件名，落院落目录
```

两条规则：

- **用户指定最高优先**：任务描述里明确说了产出位置（「写到 docs/xx.md」「生成到 src/auth/」）或手动改过 output 字段 → 按指定走；都没说 → 任务目录内 `outputs/` 兜底。类型只影响任务形态与默认约束，不再决定落点。
- **产出与任务同住**：多批次并行也不混——batch-002 的产出只在 batch-002 各任务目录里，batch-003 的只在 batch-003。目录按需出现：跑了哪个任务，哪个任务目录里就长出 `outputs/`。

## 第三类：用户自组织区（materials/ specs/ logs/ …）——你说了算

这类目录 taskq **不认识也不管理**，名字、结构、用途完全由你定。典型用法：

| 目录 | 常见用途 | 与 taskq 的关系 |
| :--- | :--- | :--- |
| `materials/`（或 input/、raw/、素材/，随你叫） | 放待拆分的原材料文档 | 入口素材：`taskq split materials/x.md` 或 `taskq pipeline materials/` |
| `specs/` | 手写规格、接口文档等参考资料 | 可被 SPEC 引用，CLI 自动读取嵌入 prompt |
| `logs/` | 应用日志等真实数据 | 同上 |
| 任何你已有的目录 | 你的项目，你的地盘 | taskq 完全不碰 |

要点：**第二类是「任务做完什么，它就收什么」；第三类是「你放什么，它是什么」**。不要手动往 outputs/ 里塞东西（它只收任务产出），素材类文件放第三类目录。

## 一个典型布局（SpecTaskChain-examples 示范）

```
项目根/
├── materials/      ← 第三类：入口素材（source-1.md …）
├── queue/          ← 第一类：队列本体（taskq 管）
│   └── batch-001/  ←     批次目录
│       ├── task-chenhui-jiyao/          ← 任务目录
│       │   └── outputs/chenhui-jiyao.md  ← 第二类：产出院落（产出与任务同住）
│       └── task-jidu-yusuan/
│           └── outputs/jidu-yusuan.csv
└── specs/          ← 第三类：手写规格与参考资料
```

## 常见疑问

**任务目录里多了个 outputs/，能不能删？** 那是任务产出，删了验收就缺货（产物门禁核对文件在不在）。不需要再删。

**为什么 materials/ 没人管？** 因为它是你的自由区。taskq 只关心你把它指给谁：split 拆它、pipeline 吃它。

**产出不想落任务目录，想落到别处？** 在任务描述里明确写产出路径（「写到 build/xx.md」）即可——用户指定最高优先；或建任务后编辑 SPEC.md 的 `output` 字段。
