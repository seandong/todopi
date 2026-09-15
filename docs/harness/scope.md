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

## 当前状态：空表

`features` 目前为空数组。这是有意的：v0.1 的 feature 拆分要在规格定稿**且技术方案
确认后**单独 brainstorm 一次，而不是从 PRD 的 FR 编号机械翻译过来——FR 是需求，
feature 是「一个 session 能做完并能被运行时证据验证的行为」，两者粒度不同。

格式规格已于 2026-09-15 定稿（见 DECISIONS.md D004），技术方案尚未确认，
因此本表继续为空。

添加第一批 feature 之前，先确认每一条都能回答：

1. 用户能观察到什么变化？
2. 什么命令能证明它做到了？
3. 这个命令失败时，agent 该改哪个文件？
