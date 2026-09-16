# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `6c1ab7c` —— 技术方案确认、外部事实核实、PRD 合并为中文单本。本行记录写它时的 HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（4 条通过、5 条不适用）/ typecheck（`not_applicable`）
- `make test`: `not_applicable` —— 尚无 `tests/` 与 `src/`
- `make e2e`: `not_applicable` —— 尚无可执行 CLI
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: 58/73，CRITICAL 6/7，RECOMMENDED 52/66。唯一的
  CRITICAL FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省。
  其余 WARN 项同样是有意偏差，逐条见 `docs/harness/index.md` 的「有意缺省的部分」
- VCR: `n/a` —— 尚无 activated feature
- 代码状态：**implementation has not started**。仓库中只有产品文档、格式规格、
  格式语料库（`spec/fixtures/`，14 valid + 9 invalid，已自洽验证）和本 harness。

## In Progress

无。当前没有 feature 处于 `active`。

`feature_list.json` 的 `features` 是空数组，这是有意的——v0.1 的 feature 拆分要在
技术方案确认后单独做一次 brainstorm，理由见
[Scope 契约](docs/harness/scope.md#当前状态空表)。格式规格已于 2026-09-15 定稿，
但拆 feature 还缺技术方案这一环（见 Next Steps）。

## Next Steps

按顺序，每条都是可立即执行的动作：

1. ~~评审格式规格~~ 已完成（2026-09-15）：规格 Stable，PRD 1.1，11 个问题逐条
   落文档。结论见 DECISIONS.md D004。
2. ~~核实六家 agent 的外部事实~~ 已完成（2026-09-16）：结果写入 PRD §17，
   FR-A2 按核实结果重写。查出三处出入，其中 Cursor 与 Gemini CLI 都已支持钩子
   （PRD 1.1 写的「规则文件加命令」已过期）、pi 的压缩事件选错了方向。
3. ~~确认技术方案~~ 已完成（2026-09-16）：十条选型附实测数据，见 DECISIONS D006。
4. **拆出 v0.1 的第一批 feature**，写入 `feature_list.json`。每条必须能回答
   Scope 契约末尾的三个问题。这是当前的下一步动作。
5. 第一个 feature 建议是格式层的读（解析 `.todopi/tasks/*.md` 并校验 spec 的
   MUST 条款），而不是 `todopi init`——读比写更容易建立测试基线，而且
   `spec/fixtures/` 已经提供了现成的测试语料（14 valid + 9 invalid）。
6. 建立 `src/` 与 `package.json` 时：依赖只有三个（`yaml`、`commander`、
   `fractional-indexing`，均零传递依赖），同步补上 lockfile 与
   `src/ARCHITECTURE.md`，并更新 `docs/harness/index.md` 的「有意缺省」表。
   注意 ARCH-007（禁 `Bun.*`）与 ARCH-008（DTO 边界）在 `src/` 出现后即生效。

## Blockers

无。

## 更新约定

- Current State 每次 clock-out 必须更新，至少包含 commit 与 `make check` 结果。
  `Last commit` 写的是写这行时的 HEAD；`make clean-check` 校验它在当前历史中，
  并校验最后一个 commit 确实带上了本文件。
- 一个 session 结束时若 VCR < 1.0，必须在 In Progress 写明卡在哪一层、
  下一步要跑什么命令。
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
