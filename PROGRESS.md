# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `edb5741` —— v0.1 拆成 21 个 feature，三个里程碑。本行记录写它时的 HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（4 条通过、5 条不适用）/ typecheck（`not_applicable`）
- `make test`: `pass` —— `fixtures` 通过（`tools/check-fixtures.mjs`：15 valid /
  9 invalid，spec §6.2 的 8 条不变量 8/8 有对应样例）；`unit-test` 仍
  `not_applicable`（尚无 `tests/` 与 `src/`）。这是本仓库第一个真实的运行时证据
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

`feature_list.json` 已于 2026-09-16 填入 21 条（M1 七条 / M2 六条 / M3 八条），
拆分依据见 DECISIONS D011。当前没有 feature 处于 `active`，下一步是 activate F01。

## Next Steps

按顺序，每条都是可立即执行的动作：

1. ~~评审格式规格~~ 已完成（2026-09-15）：规格 Stable，PRD 1.1，11 个问题逐条
   落文档。结论见 DECISIONS.md D004。
2. ~~核实六家 agent 的外部事实~~ 已完成（2026-09-16）：结果写入 PRD §17，
   FR-A2 按核实结果重写。查出三处出入，其中 Cursor 与 Gemini CLI 都已支持钩子
   （PRD 1.1 写的「规则文件加命令」已过期）、pi 的压缩事件选错了方向。
3. ~~确认技术方案~~ 已完成（2026-09-16）：十条选型附实测数据，见 DECISIONS D006。
4. ~~拆出 v0.1 的第一批 feature~~ 已完成（2026-09-16）：21 条，三个里程碑，
   依据见 DECISIONS D011。
5. **`make activate F=F01`**，然后用 `superpowers:writing-plans` 为它写实现计划
   （存 `docs/plans/`，不用 skill 默认的 `docs/superpowers/plans/`——`docs/harness/`
   已是本仓库放过程文档的地方，再引入带工具名的路径会让权威地图多一个待解释条目）。
   写 plan 的过程会逼出 `src/ARCHITECTURE.md` 的初稿，因为写不出模块划分就写不出
   符合 writing-plans 标准的步骤。
6. F01 同时要落地工具链：`package.json`（依赖只有三个）、`tsconfig.json`、lockfile、
   `src/ARCHITECTURE.md`，并更新 `docs/harness/index.md` 的「有意缺省」表。
   **实测事实**：Node 22.22 直接执行 `.ts` 且 `node --test` 直接吃 `.ts`，
   不需要构建步骤也不需要 `tsx`/`ts-node`；`typescript` 只作为 devDependency 供
   `tsc --noEmit` 用。但类型剥离不做类型导向的代码生成——`enum` 会在运行时报
   SyntaxError 而 `tsc --noEmit` 却能通过（已由 ARCH-013 挡住）。
7. `src/` 出现后立即生效的规则：ARCH-007（禁 `Bun.*`）、ARCH-008（DTO 边界）、
   ARCH-011（禁任务索引）、ARCH-013（禁 enum/namespace/装饰器）；
   `package.json` 出现后生效的：ARCH-010（依赖白名单）、ARCH-012（禁 bun test）。

## Blockers

无。

## 更新约定

- Current State 每次 clock-out 必须更新，至少包含 commit 与 `make check` 结果。
  `Last commit` 写的是写这行时的 HEAD；`make clean-check` 校验它在当前历史中，
  并校验最后一个 commit 确实带上了本文件。
- 一个 session 结束时若 VCR < 1.0，必须在 In Progress 写明卡在哪一层、
  下一步要跑什么命令。
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
