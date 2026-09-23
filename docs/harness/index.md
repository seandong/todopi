# todopi Harness 权威地图

本仓库只有一套 coding-agent harness。它服务于一件事：让 agent 跨 session、跨工具
（Claude Code / Codex / OpenCode / pi / Cursor / Gemini CLI）接手 todopi 的开发时，
起点一致、范围受控、完成有据。没有第二套工具专属规则。

## 权威顺序

冲突时以序号小的为准。

1. `AGENTS.md` —— 项目不变量、安全边界、路由。
2. `spec/todopi-format-v1.md` —— **normative**。`.todopi/` 磁盘格式的唯一权威，
   第三方可据此独立实现。改它等于改产品契约。
3. `tools/harness.sh` 与 `docs/harness/verification.md` —— 可执行的生命周期与
   验证行为。文档描述契约，脚本是契约的实现；两者不一致时以脚本的实际行为为准，
   并立刻修文档。
4. `.todopi/`、`PROGRESS.md`、`DECISIONS.md` —— 前向状态。
   「现在在做什么、做到哪、为什么这么定」的唯一权威。
5. `docs/product/**` —— 产品意图与需求。**不具备运行时权威**：它说要做什么，
   不说现在做到哪、该怎么验证。

## 历史文档

- `docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md` 是 2026-09-14 的
  调研与 30 条决策日志，是历史记录。其中的结论若仍有效，应已进入 PRD 或 spec；
  没进去的不要当作现行决定执行。
- `docs/product/todopi-prd.md` 是产品需求，中文单本（DECISIONS D006）。
  它与 `spec/todopi-format-v1.md` 冲突时以 spec 为准——spec 是 normative，
  第三方据它实现；PRD 描述的是本 CLI 的产品行为。

历史文档保留原路径以便追溯。它们里的命令和状态陈述是当时的证据，不是现在的启动指令。

## Session 生命周期

完整步骤见 `AGENTS.md`。骨架是：

1. 只读环境诊断（`make doctor`）；
2. 读当前状态（`PROGRESS.md` + `make status`）并确认基线为绿；
3. 认领**恰好一个**任务（`todopi ls --ready` → `todopi claim <id>`）；
4. 实现，逐层验证，不跳层；人核对任务正文的验收判据（散文，机器不查）；
5. `git commit` 代码**加上 `claim` 留下的账本改动**，再 `todopi done <id>`——
   它跑任务的 `verify` 并把 `commit=<HEAD7> dirty=<bool>` 记进 Log；放在提交之后
   那条证据才指得实，而漏掉 `claim` 的改动会让它 `dirty=true`；
6. 更新 `PROGRESS.md`，提交 `done` 的账本改动，**最后**跑 `make clean-check`。

## 状态层与自举计划

**2026-09-23 自举完成。** 前向状态现在放在 `.todopi/` + `PROGRESS.md`，
`feature_list.json` 已删除。todopi 用自己管理自己的开发任务。

迁移的字段映射与触发条件见[状态迁移契约](state-migration.md)（已转为历史记录）；
**这次迁移丢掉了什么、拿什么替代、哪些没有替代物**，见
[迁移计划](../plans/2026-09-23-bootstrap.md)的损失表——十条，其中三条没有替代物。

## 有意缺省的部分

以下是 learn-harness-engineering 课程列出、但本仓库**当前有意不建**的组件。
不是遗漏，条件满足时再补：

| 组件 | 为什么现在不建 | 何时补 |
|---|---|---|
| ~~依赖 lockfile~~ | ~~还没有任何依赖，也没有 `package.json`~~ —— 2026-09-16 随 F01 落地，`package-lock.json` 已存在 | 已补齐 |
| ~~`src/ARCHITECTURE.md`~~ | ~~还没有 `src/`~~ —— 2026-09-16 随 F01 落地 | 已补齐 |
| `docs/quality-document.md`（模块健康分） | 还没有模块可评分。 | 有 3 个以上模块时 |
| `templates/sprint-contract.md`、`templates/evaluator-rubric.md`、`scripts/session-trace.sh`（课程 L11 观测层） | 单人 + 少量 agent，观测层的成本高于收益。 | 出现并行 agent 或返工率变高时 |
| `.harness/traces/` 与 session 事件流 | 同上，属于 L11 观测层。 | 同上 |
| triprec 式 Gate / modernization state 模型 | 那是遗留工程的恢复模型，todopi 是 greenfield。 | 不计划引入 |
| 独立的 `scripts/verify-feature.sh`、`scripts/check-arch.sh`、`scripts/clean-state-check.sh` | 这三件事都实现为 `tools/harness.sh` 的子命令。单一入口让状态词汇、结果落盘和退出码只有一套实现；拆成三个脚本会立刻产生三份漂移的副本。 | 不计划引入 |

课程自带的 `tools/audit-harness.sh` 会把上表中的项报成 WARN，把 lockfile 报成
CRITICAL FAIL。这些是已知且有意的偏差，不要为了让校验器变绿而制造空壳文件——
伪造的 lockfile 和只做转发的包装脚本，比缺失更有害。审计方式：`make audit`。

## 相关文档

- [工程规则](engineering-rules.md) —— 实现、调试、依赖、评审的具体要求
- [验证契约](verification.md) —— 三层模型、状态词汇、降级规则、结果留存
- [Scope 契约](scope.md) —— 任务粒度、WIP=1、状态机
- [状态迁移契约](state-migration.md) —— 迁移到 `.todopi/` 的字段映射与触发条件
