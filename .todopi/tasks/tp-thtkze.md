---
id: "tp-thtkze"
title: "todopi setup codex / opencode 装好，两家的会话开始与压缩后都能收到注入"
status: "open"
blocked_by: ["tp-wnrlpw"]
rank: "ie"
verify: "make check && make test && bash tools/e2e/f15-setup-codex-opencode.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F15"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T06:21:53Z"
---

## Description

todopi setup codex / opencode 装好，两家的会话开始与压缩后都能收到注入

迁移自 `feature_list.json` 的 **F15**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [ ] `todopi setup codex` 装好（标题）
- [ ] `todopi setup opencode` 装好（标题）
- [ ] Codex 的会话开始时收到注入（标题）
- [ ] Codex 压缩后收到注入（标题）
- [ ] OpenCode 的会话开始时收到注入（标题）
- [ ] OpenCode 压缩后收到注入（标题）
- [ ] Codex：写 `.codex/hooks.json` 的 SessionStart
- [ ] Codex：写 `.codex/hooks.json` 的 PostCompact
- [ ] Codex：写 `.codex/hooks.json` 的 SessionEnd
- [ ] OpenCode：插件写在 `.opencode/plugins/` 下
- [ ] OpenCode：插件通过 event 钩子订阅 `session.created`
- [ ] OpenCode：同一插件订阅 `session.compacted`
- [ ] Codex 的会话 id 能取到
- [ ] OpenCode 的会话 id 能取到：事件对象上给 `session_id` 时
- [ ] OpenCode 的会话 id 能取到：事件对象上给 `sessionID` 时
- [ ] 幂等

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：OpenCode 插件形状不对→src/setup/opencode.ts；它返回的是 { event: async ({event}) => {} }，session.compacted 是事件而不是顶层钩子名（PRD §17）。

- **system**：生成的配置不被各家接受→对照 PRD §17 的配置位置表逐项核对。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F15
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
