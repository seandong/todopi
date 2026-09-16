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

任意时刻最多一个 feature 处于 `state: active`。`make activate F=<id>` 在已有
active feature 时会拒绝。要换任务，先把当前 feature 跑到 `passing`，或显式退回
`not_started` 并在 PROGRESS.md 的 Blockers 里说明原因。

### one session per feature

每个 feature 必须能在一个 session 内完成。如果预计跨 session，就在 activate 之前
拆成多个 feature。跨 session 的 active feature 是 context 丢失的主要来源。

### 状态机

```
not_started ──activate──> active ──verify-feature(全层 pass)──> passing
     ^                       │
     └───────release─────────┘
```

- 不允许跳级：`not_started` 不能直接变 `passing`。
- `passing` 是终态。行为需要修改时新开一个 feature，不把 `passing` 改回去——
  历史证据的价值在于它不被改写。
- **MUST NOT 手工编辑 `state` 或 `evidence`。** 它们由 `tools/harness.sh` 写入。
  手工改 `passing` 会让 evidence 与实际状态脱节，而 evidence 是这个 harness
  唯一的可信输出。

### VCR（Verified Completion Ratio）

`make vcr` 输出 `passing / (active + passing)`。

- 没有任何 activated feature 时，VCR 无定义，输出 `n/a`。
- VCR < 1.0 表示有 feature 被 activate 但没验证通过。这是正常的工作中状态，
  但一个 session 结束时 VCR 仍 < 1.0，说明工作跨 session 了——
  在 PROGRESS.md 里如实记录，不要靠记忆。

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

WIP=1 禁止的是**并行**（第二个 `make activate` 会被拒，且 `feature_list.json` 与
`PROGRESS.md` 都是单文件），不禁止顺序委派。委派在这个仓库比在一般仓库更安全，
因为完成判据不由 agent 说了算：`state` 与 `evidence` 只能由 `make verify-feature`
在三层真的通过后写入。

新增 feature 时，每一条都要能回答：

1. 用户能观察到什么变化？
2. 什么命令能证明它做到了？
3. 这个命令失败时，agent 该改哪个文件？

第三问对应 `layers[].repair`，是最容易敷衍也最值钱的一项——它必须点名具体文件
或函数。委派场景下它尤其重要：subagent 拿不到这几天的论证过程，repair 是它
唯一的现场指引。
