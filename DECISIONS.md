# DECISIONS

架构与工程决策日志。记录**为什么**，不记录做了什么——做了什么在 git history 里。

新决策追加到文件末尾，不修改历史条目。决策被推翻时，新增一条引用旧条目编号并
说明推翻理由，旧条目保留。

格式：

```
## D<编号> — <标题>

- 日期：YYYY-MM-DD
- 状态：accepted | superseded by D<n> | reverted
- 背景：促使这个决策的约束或问题
- 决策：选了什么
- 理由：为什么不是其他选项
- 影响：谁会因此受限
```

---

## D001 — harness 工具用 Bash + Makefile，不用 TypeScript

- 日期：2026-09-15
- 状态：accepted
- 背景：todopi 的产品栈是 TypeScript + Bun，但仓库目前没有 `package.json`、
  没有 `src/`，README 明确声明 implementation has not started。harness 需要在
  这个「空仓库」状态下就能运行。
- 决策：`tools/harness.sh` 用 POSIX 风格 Bash 实现（兼容 macOS 自带的 bash 3.2），
  依赖仅 `git` / `make` / `jq`。不建 `package.json`。
- 理由：用 TypeScript 写 harness 会强制现在就建 `package.json`，等于提前 scaffold
  应用，与「implementation has not started」的事实冲突，也会让第一个真实 feature
  继承一堆不是它做的选择。Bash 的代价是可维护性，但 harness 脚本的复杂度上限
  很低，且随时可以在 CLI 可用后改写。
- 影响：脚本必须避开 bash 4+ 语法（`declare -A`、`mapfile`、`${var,,}`）。
  新增 harness 逻辑前先确认能在 bash 3.2 下跑。

## D002 — 前向状态先用 feature_list.json，规划迁移到 `.todopi/`

- 日期：2026-09-15
- 状态：accepted
- 背景：todopi 本身就是任务台账工具，自举（dogfood）在品牌与设计反馈上都有价值。
  但格式规格仍是 Draft，且没有 CLI 可用。
- 决策：当前用 `feature_list.json` + `PROGRESS.md`；迁移条件与字段映射写进
  [状态迁移契约](docs/harness/state-migration.md)，而不是留作口头计划。
- 理由：用未定稿的格式承载开发状态，会让 spec 的每次修订连带返工 harness；
  手写 `.todopi/tasks/*.md` 要人肉维护无环性和时间戳，正是产品要消灭的负担。
  把迁移条件写成契约，可以避免过渡形态变成永久形态。
- 影响：迁移必须在同一个 commit 内完成权威切换，不允许两套状态并存。

## D003 — feature_list 先建空表，不从 PRD 的 FR 机械翻译

- 日期：2026-09-15
- 状态：accepted
- 背景：PRD 有完整的 FR-A / FR-B / FR-D 编号，机械翻译可以立刻填满 feature_list。
- 决策：`features` 先留空数组，只固化结构与规则；第一批 feature 在 spec 定稿后
  单独 brainstorm。
- 理由：FR 是需求粒度，feature 是「一个 session 能做完且能被运行时证据验证的
  行为」粒度，两者不对齐。提前填满会造成大量长期 `not_started` 的噪音，
  并把「WIP=1」变成一种形式。
- 影响：harness 建成时 Scope 子系统是空的。这是已知状态，记录在 PROGRESS.md。
