---
id: "tp-yuka3e"
title: "todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩"
status: "open"
blocked_by: ["tp-85y7ej"]
rank: "ig"
verify: "make check && make test && bash tools/e2e/f17-setup-cursor-gemini.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F17"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T06:21:53Z"
---

## Description

todopi setup cursor / gemini 装好，两家在没有压缩后事件的情况下仍能让账本指针活过压缩

迁移自 `feature_list.json` 的 **F17**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [ ] `todopi setup cursor` 装好（标题）
- [ ] `todopi setup gemini` 装好（标题）
- [ ] Cursor 在没有压缩后事件的情况下，账本指针活过压缩（标题）
- [ ] Gemini 在没有压缩后事件的情况下，账本指针活过压缩（标题）
- [ ] Cursor：写 `.cursor/hooks.json` 的 sessionStart（返回 `additional_context`）
- [ ] Gemini：写 `settings.json` 的 SessionStart（返回 `hookSpecificOutput.additionalContext`）
- [ ] Cursor 压缩前注入：preCompact 时把 `prime --budget 400` 的输出交给待生成的摘要（FR-A2a）
- [ ] Gemini 压缩前注入：PreCompress 时把 `prime --budget 400` 的输出交给待生成的摘要（FR-A2a）
- [ ] Cursor 同时提供规则文件作为回退（它的 CLI 钩子支持一直在变，MUST）
- [ ] Cursor 在 CLI 形态下手工验证一次
- [ ] Cursor 在 IDE 形态下手工验证一次

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：注入字段名写错→两家不同：Cursor 是 additional_context，Gemini 是 hookSpecificOutput.additionalContext（PRD §17）。

- **system**：压缩后指针丢失→确认走的是压缩前注入而不是期待一个不存在的 post 事件；Cursor CLI 不触发 sessionStart 时回退到规则文件路径。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F17
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
