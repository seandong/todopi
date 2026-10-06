---
id: "tp-zagvp5"
title: "Cursor 接入：CLI 与 IDE 实机验证"
status: "open"
rank: "im"
verify: "make check && bash tools/e2e/f17-setup-cursor-gemini.sh"
labels: ["m3"]
created: "2026-09-26T11:44:21Z"
updated: "2026-10-06T05:33:07Z"
---

## Description

从 tp-yuka3e（setup cursor / gemini）拆出（按 tp-1ssqrw 的先例）。F17 时 cursor-agent 的无头模式报 Authentication required、交互式要求浏览器登录，Cursor 没能实测；IDE 形态本来就要人手工验证（FR-A2b）。机制见 D038：sessionStart 的 additional_context 注入；压缩后没有钩子可用，靠 alwaysApply 规则文件 .cursor/rules/todopi.mdc。

## Acceptance Criteria

- [ ] Cursor 在没有压缩后事件的情况下，账本指针活过压缩（原 tp-yuka3e #3）：压缩/摘要之后，模型仍能说出指针（todopi prime）与「察觉到被压缩就跑 todopi prime」
- [ ] Cursor 在 CLI 形态下手工验证一次（原 tp-yuka3e #10）：sessionStart 注入进上下文、规则文件生效、sessionEnd 触发
- [ ] Cursor 在 IDE 形态下手工验证一次（原 tp-yuka3e #11）
- [ ] 用户级钩子（setup cursor --user）在项目里按 workspace_roots 找到账本
- [ ] 实测结果与 Cursor 版本写进 PRD §17

## Log

- 2026-09-26T11:44:21Z seandong created from=tp-yuka3e
- 2026-09-27T16:12:52Z claude-code@Seans-MacBook-Pro.local note: tp-lv7y3h：Cursor 插件（plugins/cursor/）本机没法测——cursor-agent 未登录。实机验证时一并跑：在有进行中任务的仓库里 cursor-agent --plugin-dir <todopi>/plugins/cursor，问它进行中的任务；再叠上 todopi setup cursor 看是否只注入一次。
- 2026-10-06T05:17:58Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-06T05:29:49Z claude-code@Seans-MacBook-Pro.local note: Cursor CLI dogfood in isolated /tmp/todopi-cursor-cli.Ocwp0Z: setup cursor created project hooks.json and alwaysApply rule; doctor passed. Herdr right pane interactive cursor-agent initially 2026.09.26-dd393fe, then auto-updated to 2026.10.01-e373342. Without invoking tools, agent named in-progress tp-6iy2qk and quoted compaction rule; repeat under TODOPI_ACTOR=cursor@Seans-MacBook-Pro.local also named the held task and rule. A headless -p --mode ask attempt failed on Cursor network reconnect (RetriableError: WritableIterable is closed). sessionEnd hook is read-only handoff --check; no persistent log, so exit alone does not prove execution. IDE, actual compaction and --user workspace_roots remain untested.
- 2026-10-06T05:32:47Z claude-code@Seans-MacBook-Pro.local note: Second CLI pass with TODOPI_ACTOR=cursor@Seans-MacBook-Pro.local on Cursor Agent 2026.10.01-e373342: interactive sessionStart context named held tp-6iy2qk and alwaysApply compaction rule without tools; normal Ctrl-D returned to shell. Cannot claim actual compaction survived: no verified manual compaction occurred. Existing sessionEnd command is handoff --check and has no persistent side effect; exit shows no hook output, so it remains unproven. A temporary hook-events.log instrumentation in the isolated project was blocked by Claude Code automatic approval as an unauthorized persistent hook command; no workaround attempted. Cursor IDE and user-level hooks remain untested.
- 2026-10-06T05:33:07Z claude-code@Seans-MacBook-Pro.local released
