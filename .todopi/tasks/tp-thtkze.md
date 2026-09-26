---
id: "tp-thtkze"
title: "todopi setup codex / opencode 装好：Codex 会话开始与压缩后、OpenCode 会话开始都能收到注入（OpenCode 压缩后见 tp-1ssqrw）"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-wnrlpw"]
rank: "ie"
verify: "make check && make test && bash tools/e2e/f15-setup-codex-opencode.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F15"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T08:52:21Z"
---

## Description

todopi setup codex / opencode 装好：Codex 会话开始与压缩后、OpenCode 会话开始都能收到注入。OpenCode 压缩后的注入拆到 tp-1ssqrw（2026-09-26，凭据所限未能实测，用户定）。

迁移自 `feature_list.json` 的 **F15**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi setup codex` 装好（标题）
- [x] `todopi setup opencode` 装好（标题）
- [x] Codex 的会话开始时收到注入（标题）
- [x] Codex 压缩后收到注入（标题）
- [x] OpenCode 的会话开始时收到注入（标题）
- [x] Codex：写 `.codex/hooks.json` 的 SessionStart
- [x] Codex 压缩后注入：`.codex/hooks.json` 的 SessionStart 不设 matcher，覆盖 `compact` 来源（不装 PostCompact：实测两者压缩后都触发，都装会注入两遍，2026-09-26）
- [x] Codex：写 `.codex/hooks.json` 的 SessionEnd
- [x] OpenCode：插件写在 `.opencode/plugins/` 下
- [x] OpenCode：插件通过 event 钩子订阅 `session.created`
- [x] OpenCode：同一插件订阅 `session.compacted`
- [x] Codex 的会话 id 能取到
- [x] OpenCode 的会话 id 能取到：`session.created` 事件的 `properties.info.id`
- [x] OpenCode 的会话 id 能取到：`session.compacted` 事件的 `properties.sessionID`
- [x] 幂等

（「OpenCode 压缩后收到注入」一条于 2026-09-26 拆到 tp-1ssqrw（凭据所限未能实测，用户定）。）

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
- 2026-09-26T08:07:02Z seandong claimed
- 2026-09-26T08:34:25Z seandong note: 验收标准按 2026-09-26 核实的外部事实改写三条：#8 原文「写 .codex/hooks.json 的 PostCompact」——Codex 0.157.1 实测压缩后 PostCompact 与 SessionStart(compact) 都触发、都注入，只装 SessionStart 即可（标记法验证：去掉 PostCompact 后压缩前新增的标记照样被注入）；#14/#15 原文「事件对象上给 session_id / sessionID」——OpenCode SDK 类型里 session.created 是 properties.info.id、session.compacted 是 properties.sessionID，没有 session_id。见 PRD §17。
- 2026-09-26T08:46:43Z seandong note: 验收标准「OpenCode 压缩后收到注入（标题）」拆到 tp-1ssqrw（用户 2026-09-26 定）：免费模型不能用于压缩、其余 provider 凭据不可用，这一条没有运行时证据，不在本任务里勾。
- 2026-09-26T08:49:05Z seandong edited fields=description,title
- 2026-09-26T08:52:18Z seandong check ac=1: `todopi setup codex` 装好（标题）
- 2026-09-26T08:52:18Z seandong check ac=2: `todopi setup opencode` 装好（标题）
- 2026-09-26T08:52:18Z seandong check ac=3: Codex 的会话开始时收到注入（标题）
- 2026-09-26T08:52:19Z seandong check ac=4: Codex 压缩后收到注入（标题）
- 2026-09-26T08:52:19Z seandong check ac=5: OpenCode 的会话开始时收到注入（标题）
- 2026-09-26T08:52:19Z seandong check ac=6: Codex：写 `.codex/hooks.json` 的 SessionStart
- 2026-09-26T08:52:19Z seandong check ac=7: Codex 压缩后注入：`.codex/hooks.json` 的 SessionStart 不设 matcher，覆盖 `compact` 来源（不装 Pos
- 2026-09-26T08:52:19Z seandong check ac=8: Codex：写 `.codex/hooks.json` 的 SessionEnd
- 2026-09-26T08:52:19Z seandong check ac=9: OpenCode：插件写在 `.opencode/plugins/` 下
- 2026-09-26T08:52:20Z seandong check ac=10: OpenCode：插件通过 event 钩子订阅 `session.created`
- 2026-09-26T08:52:20Z seandong check ac=11: OpenCode：同一插件订阅 `session.compacted`
- 2026-09-26T08:52:20Z seandong check ac=12: Codex 的会话 id 能取到
- 2026-09-26T08:52:20Z seandong check ac=13: OpenCode 的会话 id 能取到：`session.created` 事件的 `properties.info.id`
- 2026-09-26T08:52:20Z seandong check ac=14: OpenCode 的会话 id 能取到：`session.compacted` 事件的 `properties.sessionID`
- 2026-09-26T08:52:20Z seandong check ac=15: 幂等
- 2026-09-26T08:52:21Z seandong note: 勾选依据：Codex 会话开始与压缩后（标记法）、OpenCode 会话开始为真机实测（PRD §17）；「session.compacted 的 properties.sessionID」依据 SDK 类型与单元用例，真机压缩见 tp-1ssqrw；其余由单元用例与 e2e 覆盖。
