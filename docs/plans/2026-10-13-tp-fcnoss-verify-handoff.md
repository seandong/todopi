# 交接待验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让代码已改、检查待跑的明确报告在下一次 prime 和 handoff 中可见，且不冒充验证通过。

**Architecture:** `note` 在原有锁内写入路径追加两个 v1 Log 新动词；纯领域函数按完整 Log 的文件顺序推导本轮待验证信息。`prime` 和 `handoff` 分别投影该状态到既有文本和 JSON；成功的 `done` 仍是唯一运行时通过证据。

**Tech Stack:** TypeScript、Node.js ≥ 20、Commander、CommonMark、node:test。

**Spec:** `spec/todopi-format-v1.md` §5.3.3/§9；任务 `.todopi/tasks/tp-fcnoss.md`；设计边界来自独立方案评审（2026-10-13）。

## Global Constraints

- 不增加 frontmatter 字段，不改变格式版本 1 的既有派生规则或 JSON 封闭枚举。
- `note` 普通文本行为保留；事件只由明确 flag 写入，普通 note 和验收勾选不推断状态。
- 待验证是操作者报告；`clear` 只撤销报告。`done verify=pass` 且无 `forced=true` 才是当时验证通过的证据；失败或拒绝的 done 不留通过证据。
- `release`/再次 `claim` 保留待验证报告；`done`/`closed`/`reopened` 终结该轮报告，仅在任务当前 `in_progress` 时展示。
- prime 的待验证提示即使预算紧也保留；最近 Log 中的待验证条目也必须有界，长文本转义后截取并给 `todopi show <id> --full` 指针，命令进入 JSON。被裁掉的任务若有待验证报告，仍逐项展示有界下一步。
- 用户可见 CLI、README、spec 和协议先写英文；`handoff --check` 保持零写入，Cursor 结束钩子仍仅输出 `{}`。

---

### Task 1: 事件与 CLI 输入

**Files:** `src/domain/verification-pending.ts`（新建，纯函数）；`src/commands/note.ts`；`src/cli.ts`；`src/output/dto/worklog.ts`；`src/output/render/worklog.ts`；`tests/commands/note-check.test.ts`；`tests/cli.test.ts`；`spec/todopi-format-v1.md`。

**Interfaces:** `verificationPending(task: TaskFile): string | null` 从完整 Log 推导有效下一步；`runNote` 接受普通 text、`verifyPending` 或 `clearVerifyPending` 互斥输入。旧 `NoteReport` 字段保留，新增字段只在新模式输出。

- [ ] 写失败测试：pending 连续更新、clear 撤销、无记录 clear 的无操作、release/reclaim 保留、done/closed/reopen 清除，以及普通 note 和错误日志不被推断；CLI 错误参数零副作用、现有普通 note 原样运行。clear 不接文本且不表示检查已通过。
- [ ] `node --test tests/commands/note-check.test.ts tests/cli.test.ts`，确认新增用例先失败。
- [ ] 实现完整 Log 顺序推导；pending 只允许进行中任务写入，clear 只在有效 pending 时追加事件或报告明确无操作；非法文本/选项在写入之前拒绝；经 `writeAsWorker` 使用现有归属与锁。
- [ ] 规格登记 `verify_pending`（text 是必填下一步）与 `verify_cleared` 两个增量动词，说明旧读者忽略未知动词，无迁移、无版本变化。
- [ ] 重跑上述测试，直到通过。

### Task 2: prime 与 handoff 交接

**Files:** `src/commands/prime.ts`；`src/commands/handoff.ts`；`src/output/dto/prime.ts`；`src/output/dto/handoff.ts`；`src/output/render/prime.ts`；`src/output/render/handoff.ts`；`tests/commands/prime.test.ts`；`tests/commands/handoff.test.ts`；`docs/json.md`。

**Interfaces:** `PrimeTask.verificationPending` 增量字段承载投影出的提示和完整日志命令；`HandoffReport.verificationPending` 增量数组承载进行中且属于当前 actor 的任务及下一步；两个 renderer 只消费 DTO。

- [ ] 写失败测试：旧 pending 被新 handoff 日志和 note 埋住仍显示；预算 0、超长最近日志、多持有任务被裁掉时仍有有界下一步和指针；文本与 JSON 同源；无 prime 快照及 `--check` 仍报告，且后者逐字节零写入；Cursor JSON 仍为 `{}`。
- [ ] `node --test tests/commands/prime.test.ts tests/commands/handoff.test.ts`，确认新用例先失败。
- [ ] 投影完整日志推导结果，先 `visible` 再按固定长度截断；独立字段与文本行在预算裁剪时保留，指针入 DTO；handoff 摘要与报告都明确下一步，不误写验证结果。
- [ ] 更新 `docs/json.md` 新增字段表，运行上述测试及 `make check`。

### Task 3: 使用说明与实测

**Files:** `docs/getting-started.md`；`README.md`；`src/protocol.ts`；`tests/protocol.test.ts`；`.todopi/tasks/tp-fcnoss.md`（只通过 CLI）；`PROGRESS.md`。

- [ ] 写可复制的命令示例：`note <id> --verify-pending "<next step>"`、`note <id> --clear-verify-pending`；解释 pending/clear 不是通过证据，普通 `done` 才运行 verify；协议提示 agent 明确记录下一步。
- [ ] 运行 `make check` → `make test` → `make e2e`；每层通过才进入下一层。核对三条验收项并通过 `todopi check tp-fcnoss <n>` 勾选。
- [ ] 将代码、文档、计划与 claim 账本提交；独立代码评审并处理阻塞项，必要时重新验证、提交。
- [ ] 在干净已提交树上执行 `todopi done tp-fcnoss`；将 done 账本与更新后的 `PROGRESS.md` 提交；最后 `make clean-check`。

## Plan self-review

三条验收项分别由任务 1 的显式记录、任务 2 的跨会话输出及任务 3 的门禁/文档覆盖。接口统一使用 `verificationPending`，不更改现有 `unverified` 派生规则。新字段只增量添加；所有新增事件都在一个 Log 内，旧读者忽略未知动词。
