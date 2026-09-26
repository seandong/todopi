---
id: "tp-yuka3e"
title: "todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-85y7ej"]
rank: "ig"
verify: "make check && make test && bash tools/e2e/f17-setup-cursor-gemini.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F17"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T11:57:04Z"
---

## Description

todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩

迁移自 `feature_list.json` 的 **F17**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi setup cursor` 装好（标题）
- [x] `todopi setup gemini` 装好（标题）
- [x] Gemini 在没有压缩后事件的情况下，账本指针活过压缩（标题）
- [x] Cursor：写 `.cursor/hooks.json` 的 sessionStart（返回 `additional_context`）
- [x] Gemini：写 `settings.json` 的 SessionStart（返回 `hookSpecificOutput.additionalContext`）
- [x] Cursor 压缩后的指针：写 `alwaysApply: true` 的规则文件 `.cursor/rules/todopi.mdc`，含指针与「察觉到被压缩就跑 `todopi prime`」（preCompact 只能观察、不能改摘要，FR-A2a 已改写）
- [x] Gemini 压缩后注入：PreCompress（matcher `manual`）打标记，下一轮 BeforeAgent 把 prime 追加进请求；`context.fileName` 含 AGENTS.md，自动压缩后靠系统指令里的协议行（PreCompress 的返回值不被使用，FR-A2a 已改写）
- [x] Cursor 同时提供规则文件作为回退（它的 CLI 钩子支持一直在变，MUST）

（「Cursor 账本指针活过压缩（标题）」「Cursor 在 CLI 形态下手工验证一次」「Cursor 在 IDE 形态下手工验证一次」三条于 2026-09-26 拆到 tp-zagvp5：Cursor 需要登录，没能实测。）

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：注入字段名写错→两家不同：Cursor 是 additional_context，Gemini 是 hookSpecificOutput.additionalContext（PRD §17）。

- **system**：压缩后指针丢失→两家都没有 post 事件，压缩前钩子也不能改摘要（D038）：Gemini 看 PreCompress 的 matcher 是否 `manual`、BeforeAgent 是否装上、`context.fileName` 是否含 AGENTS.md；Cursor 看规则文件是否 `alwaysApply: true`。Cursor 用户级钩子找不到账本→载荷的 `workspace_roots`。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F17
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T11:18:10Z seandong claimed
- 2026-09-26T11:44:36Z seandong note: 验收标准按 2026-09-26 核实的外部事实改写两条、拆出三条：#7/#8 原文「preCompact / PreCompress 时把 prime --budget 400 的输出交给待生成的摘要」前提不成立——Cursor 官方文档：preCompact 只能观察、不能改压缩；Gemini CLI 0.26.0 源码：压缩服务不用 PreCompress 的返回值。改为规则文件（Cursor）与标记 + BeforeAgent（Gemini），见 PRD §17、D038。「Cursor 账本指针活过压缩（标题）」与 CLI / IDE 手工验证三条拆到 tp-zagvp5（Cursor 需要登录，按 tp-1ssqrw 的先例）。
- 2026-09-26T11:56:05Z seandong note: 验收依据：#1/#2/#4/#5/#6/#8 由 tests/commands/setup-cursor-gemini.test.ts 与 tools/e2e/f17-setup-cursor-gemini.sh 覆盖（变异测试全部杀死）；#3/#7 由 Gemini CLI 0.26.0 真实运行时实测：假 API 服务器（tools/probes/gemini-fake-api.mjs）记录请求体，/compress 真压缩（50000→299）后下一轮请求在用户消息后追加 prime，再下一轮不追加，系统指令含 AGENTS.md 协议行（PRD §17）；0.61.0 源码核对一致。Codex 评审两轮：No-Go（context:null、多根工作区、运行时门禁）→ 修两处、第三处记 D038 → Go。
- 2026-09-26T11:56:06Z seandong check ac=1: `todopi setup cursor` 装好（标题）
- 2026-09-26T11:56:06Z seandong check ac=2: `todopi setup gemini` 装好（标题）
- 2026-09-26T11:56:06Z seandong check ac=3: Gemini 在没有压缩后事件的情况下，账本指针活过压缩（标题）
- 2026-09-26T11:56:06Z seandong check ac=4: Cursor：写 `.cursor/hooks.json` 的 sessionStart（返回 `additional_context`）
- 2026-09-26T11:56:06Z seandong check ac=5: Gemini：写 `settings.json` 的 SessionStart（返回 `hookSpecificOutput.additionalContext
- 2026-09-26T11:56:06Z seandong check ac=6: Cursor 压缩后的指针：写 `alwaysApply: true` 的规则文件 `.cursor/rules/todopi.mdc`，含指针与「察觉到被压缩
- 2026-09-26T11:56:07Z seandong check ac=7: Gemini 压缩后注入：PreCompress（matcher `manual`）打标记，下一轮 BeforeAgent 把 prime 追加进请求；`con
- 2026-09-26T11:56:07Z seandong check ac=8: Cursor 同时提供规则文件作为回退（它的 CLI 钩子支持一直在变，MUST）
- 2026-09-26T11:57:04Z seandong done verify=pass commit=c1b7f0d dirty=true
