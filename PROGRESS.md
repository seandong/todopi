# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `f2a89d4` —— harness 初始化。本行记录写它时的 HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-sync /
  arch-rules（3 条通过、3 条不适用）/ typecheck（`not_applicable`）
- `make test`: `not_applicable` —— 尚无 `tests/` 与 `src/`
- `make e2e`: `not_applicable` —— 尚无可执行 CLI
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: CRITICAL 6/7，RECOMMENDED 50/66。唯一的 CRITICAL
  FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省，见
  `docs/harness/index.md` 的「有意缺省的部分」
- VCR: `n/a` —— 尚无 activated feature
- 代码状态：**implementation has not started**。仓库中只有产品文档、格式规格和
  本 harness。

## In Progress

无。当前没有 feature 处于 `active`。

`feature_list.json` 的 `features` 是空数组，这是有意的——v0.1 的 feature 拆分要在
`spec/todopi-format-v1.md` 定稿后单独做一次 brainstorm，理由见
[Scope 契约](docs/harness/scope.md#当前状态空表)。

## Next Steps

按顺序，每条都是可立即执行的动作：

1. 评审 `spec/todopi-format-v1.md`（当前状态 Draft for review），把状态推进到
   Stable 或记录待决问题。格式定稿前不要开始实现，否则格式层要返工。
2. 基于定稿的 spec 拆出 v0.1 的第一批 feature，写入 `feature_list.json`。
   每条必须能回答 Scope 契约末尾的三个问题。
3. 第一个 feature 建议是格式层的读（解析 `.todopi/tasks/*.md` 并校验 spec 的
   MUST 条款），而不是 `todopi init`——读比写更容易建立测试基线。
4. 建立 `src/` 与 `package.json` 时，同步补上依赖 lockfile 和
   `src/ARCHITECTURE.md`，并更新 `docs/harness/index.md` 的「有意缺省」表。

## Blockers

无。

## 更新约定

- Current State 每次 clock-out 必须更新，至少包含 commit 与 `make check` 结果。
  `Last commit` 写的是写这行时的 HEAD；`make clean-check` 校验它在当前历史中，
  并校验最后一个 commit 确实带上了本文件。
- 一个 session 结束时若 VCR < 1.0，必须在 In Progress 写明卡在哪一层、
  下一步要跑什么命令。
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
