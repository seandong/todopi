# todopi Scope 契约

Scope 子系统防止两件事：一次做太多，和「做完了」的含糊判断。

## feature_list.json 结构

顶层是一个对象，不是数组：

```json
{
  "version": 1,
  "schema": {
    "fields": ["id", "behavior", "verification", "state", "depends_on", "evidence", "layers"]
  },
  "features": []
}
```

`schema.fields` 是给人和校验器看的字段清单，harness 不依赖它。

每个 feature 条目：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | `F` + 两位数字，如 `F01`。不可复用、不可重编号 |
| `behavior` | string | 是 | 用户可观察的行为，一句话。不是任务名，是结果 |
| `verification` | string | 是 | 人读的验收判据：怎样算做到了 |
| `state` | enum | 是 | `not_started` / `active` / `passing` |
| `depends_on` | string[] | 否 | 依赖的 feature id；依赖未 `passing` 时不得 activate |
| `evidence` | string | 是 | 由 harness 写入，格式 `commit <sha>, verified <UTC>`。未通过时为空串 |
| `layers` | object[] | 是 | 每层 `{ "label", "cmd", "repair" }`，见下 |

`layers[]` 的每一项：

- `label` —— `static` / `runtime` / `system` 之一，对应
  [验证契约](verification.md) 的三层。
- `cmd` —— 可直接执行的命令行，从仓库根运行。
- `repair` —— **失败时打给 agent 看的修复指引**。必须点名具体文件、函数或配置项，
  不能写「检查代码」这种无操作性的话。这个字段是 feature_list 里最容易敷衍、
  也最值钱的一项。

## 规则

### WIP = 1

任意时刻最多一个任务处于 `status: in_progress`。

2026-09-23 自举之前，这条由 `make activate` 在**动作发生时**拒绝。现在由
**ARCH-023 持续检查**——`make check` 每次都数一遍。这是一次明确的**降级**：从
「当场拒绝」变成「事后发现」。换来的是它不挑入口：不论谁、用什么方式让第二个任务
变成 `in_progress` 都会红。理由与全部损失见
[迁移计划](../plans/2026-09-23-bootstrap.md)。

要换任务，先 `todopi done` 跑完当前这个，或 `todopi release` 退回并在 PROGRESS.md
的 Blockers 里说明原因。

### one session per task

每个任务必须能在一个 session 内完成。如果预计跨 session，就在 claim 之前拆开。
跨 session 的 `in_progress` 任务是 context 丢失的主要来源。

### 状态机

自 2026-09-23 自举起，状态机是 todopi 的，见格式规格 §6.1：

```
open ──claim──> in_progress ──done(verify 通过)──> closed/done
  ^                  │
  └────release───────┘        closed ──reopen──> open
```

**旧状态机（历史记录）**：

```
not_started ──activate──> active ──verify-feature(全层 pass)──> passing
     ^                       │
     └───────release─────────┘
```

它有三条约束是新状态机没有的，**迁移时全部降级**，逐条记在
[迁移计划](../plans/2026-09-23-bootstrap.md)的损失表里：

- 不允许跳级（`not_started` 不能直接变 `passing`）。todopi 允许 `open → done`，
  不必先 claim——现在靠 AGENTS.md 的工作流约定「先 claim 再干活」。
- `passing` 是终态。todopi 有 `reopen`，那是格式规格的一部分，不该为本项目的
  偏好去改产品。「历史证据不被改写」因此从机器约束降为约定。
- **MUST NOT 手工编辑 `state` 或 `evidence`。** 对应的现在是：MUST NOT 手工把任务
  改成 `closed`——完成判据由 `todopi done` 跑 `verify` 得出。

### VCR（Verified Completion Ratio）—— 已随 `make vcr` 一起删除

**这是迁移损失表的第十一条**（评审在执行后指出，前十条没有它）。

`make vcr` 曾输出 `passing / (active + passing)`，并在 session 末尾提醒「有 feature
被 activate 但没验证通过」。它的计数源是 `feature_list.json` 的 `state` 字段，
随文件一起消失了。

**没有替代物。** 对应的信号现在分散在两处：`make status` 显示就绪队列与在做的任务，
ARCH-023 在第二个任务变成 `in_progress` 时报警。但「这个 session 有没有把认领的活
干完」这个提醒没有了——换成 `make clean-check` 的 state-updated 一维间接兜着：
工作区有改动而 PROGRESS 没更新就会红。

## 当前状态：21 条，三个里程碑

`features` 于 2026-09-16 填入 21 条，拆分依据见 [DECISIONS D011](../../DECISIONS.md)。
顶层的 `milestones` 键给出分组与各自的完成信号：

| 里程碑 | feature | 完成信号 |
|---|---|---|
| M1 | F01–F07 | [状态迁移契约](state-migration.md) 的三个触发条件全部满足，仓库切换到用 todopi 管自己 |
| M2 | F08–F13 | 日常回路完整，dogfooding 不再需要手工绕开任何环节 |
| M3 | F14–F21 | PRD §13 首发清单中与代码相关的条目全部可勾 |

**M1 与 M2 不委派，M3 的八个 feature 可交给 subagent 顺序完成。**
判据是「它会不会锁定后面所有 feature 都要继承的决定」——M1/M2 每一个都在定
目录结构、DTO 边界、领域模型形状，或需要 dogfooding 反馈的措辞；M3 的八个是
叶子节点（没有东西依赖它们），且规格已细到不需要再做设计判断。

WIP=1 禁止的是**并行**（ARCH-023 会在下一次 `make check` 抓到第二个
`in_progress`），不禁止顺序委派。委派在这个仓库比在一般仓库更安全，因为完成判据
不由 agent 说了算：`todopi done` 会跑任务的 `verify`，不通过就关不掉。

新增 feature 时，每一条都要能回答：

1. 用户能观察到什么变化？
2. 什么命令能证明它做到了？
3. 这个命令失败时，agent 该改哪个文件？

第三问对应 `layers[].repair`，是最容易敷衍也最值钱的一项——它必须点名具体文件
或函数。委派场景下它尤其重要：subagent 拿不到这几天的论证过程，repair 是它
唯一的现场指引。
