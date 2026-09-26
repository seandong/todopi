---
id: "tp-yuka3e"
title: "todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-85y7ej"]
rank: "ig"
verify: "make check && make test && bash tools/e2e/f17-setup-cursor-gemini.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F17"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T11:44:36Z"
---

## Description

todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩

迁移自 `feature_list.json` 的 **F17**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [ ] `todopi setup cursor` 装好（标题）
- [ ] `todopi setup gemini` 装好（标题）
- [ ] Gemini 在没有压缩后事件的情况下，账本指针活过压缩（标题）
- [ ] Cursor：写 `.cursor/hooks.json` 的 sessionStart（返回 `additional_context`）
- [ ] Gemini：写 `settings.json` 的 SessionStart（返回 `hookSpecificOutput.additionalContext`）
- [ ] Cursor 压缩后的指针：写 `alwaysApply: true` 的规则文件 `.cursor/rules/todopi.mdc`，含指针与「察觉到被压缩就跑 `todopi prime`」（preCompact 只能观察、不能改摘要，FR-A2a 已改写）
- [ ] Gemini 压缩后注入：PreCompress（matcher `manual`）打标记，下一轮 BeforeAgent 把 prime 追加进请求；`context.fileName` 含 AGENTS.md，自动压缩后靠系统指令里的协议行（PreCompress 的返回值不被使用，FR-A2a 已改写）
- [ ] Cursor 同时提供规则文件作为回退（它的 CLI 钩子支持一直在变，MUST）

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
