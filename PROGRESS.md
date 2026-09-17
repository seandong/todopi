# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `3e89ce4` —— F02 实现计划。本行记录写它时的 HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（12 条通过、1 条不适用）/ typecheck（`pass`，tsc --noEmit）
- `make test`: `pass` —— `fixtures`（语料质量）+ `unit-test`（`node --test`，
  116 个用例）。其中 52 个是语料库驱动的一致性断言，已用变异测试确认它们会咬
- `make e2e`: `pass` —— `e2e:f01-doctor` 9 项断言（退出码 0/1/4、`--json`、环路径打印）
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: 58/73，CRITICAL 6/7，RECOMMENDED 52/66。唯一的
  CRITICAL FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省。
  其余 WARN 项同样是有意偏差，逐条见 `docs/harness/index.md` 的「有意缺省的部分」
- VCR: `1.0` —— F01 `passing`，evidence 由 harness 写入
- 代码状态：**F01 已完成**。`src/` 有四层（`format` / `domain` / `output` / `commands`）
  共 11 个文件，`todopi doctor` 可用。依赖三个：`commander`、`yaml`（运行时）与
  `typescript`、`@types/node`（开发时）。

## In Progress

**F02 `init`** —— `state: active`，实现计划已写：
[docs/plans/2026-09-17-f02-init.md](docs/plans/2026-09-17-f02-init.md)（5 个 task）。
尚未开始写代码。

F01 已 `passing` 并合回 `main`（`--no-ff`，合并后在 main 上重跑三层确认绿），
分支已删除。**尚未推送到 remote。**

`feature_list.json` 于 2026-09-16 填入 21 条（M1 七条 / M2 六条 / M3 八条），
拆分依据见 DECISIONS D011。

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
5. ~~activate F01、写计划并执行~~ 已完成（2026-09-16）：9 个 task 逐个 TDD 通过，
   计划在 [docs/plans/2026-09-16-f01-doctor.md](docs/plans/2026-09-16-f01-doctor.md)。
6. ~~把 `feat/f01-doctor` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
7. ~~activate F02 并写计划~~ 已完成。**下一步：执行 plan 的 Task 1**（协议文本）。
   计划对 F02 的边界做了两处收紧：**原子写包含在内**（config.yml 写到一半账本就坏了，
   15 行的事，F03 的锁建在它之上而不是替换它），**文件锁不包含**（spec §8 的锁针对
   任务文件的读-校验-写，init 不写任务文件）；**不碰 `CLAUDE.md`**——那是 FR-Q5a 与
   F14 `setup claude` 的事，它就在 FR-Q5 隔壁，很容易顺手做掉而撑大 F02。F02 依赖 F01，且它是写入端的第一步——
   会拖进 config.yml 的写、`.gitignore`、AGENTS.md 追加与幂等判定，但**还不需要**
   发射器、原子写与文件锁（那些在 F03 `add`）。

## Blockers

无。

## 更新约定

- Current State 每次 clock-out 必须更新，至少包含 commit 与 `make check` 结果。
  `Last commit` 写的是写这行时的 HEAD；`make clean-check` 校验它在当前历史中，
  并校验最后一个 commit 确实带上了本文件。
- 一个 session 结束时若 VCR < 1.0，必须在 In Progress 写明卡在哪一层、
  下一步要跑什么命令。
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
