---
id: "tp-jlohuf"
title: "同一会话装了两份钩子时 prime 只注入一次"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j02"
verify: "make check && make test && bash tools/e2e/f38-hook-dedupe.sh"
labels: ["m5"]
created: "2026-09-27T14:36:57Z"
updated: "2026-09-27T15:35:12Z"
---

## Description

tp-lv7y3h 的调研：各家的市场包与 todopi setup 写的钩子会同时加载，会话开始时 prime 注入两遍。用户选了在 prime 里去重（2026-09-28）。独立进程的钩子（Claude Code、Codex、Gemini、Cursor）：prime --hook 按会话原子地占一个标记，10 秒内同一会话的第二次调用什么都不印；没有会话 id 不去重（同一 actor 的并行 agent 不能丢 prime）。同进程加载的（OpenCode 插件、pi 扩展）：第一份设进程级标志，后来的一份不注册任何钩子——插件拿到空输出会一直重试，只靠时间窗挡不住。

## Acceptance Criteria

- [x] 两个钩子同时对同一会话跑 prime --hook：恰好一个输出 prime
- [x] 同一会话 resume / 压缩后（超过 10 秒）照常注入；没有会话 id 时不去重
- [x] OpenCode 插件与 pi 扩展装了两份时只有一份生效

## Log

- 2026-09-27T14:36:57Z claude-code@Seans-MacBook-Pro.local created from=tp-lv7y3h
- 2026-09-27T14:36:57Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T14:36:57Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T15:34:08Z claude-code@Seans-MacBook-Pro.local note: Codex 四轮评审到 Go（1b709b1）。verify 全绿：make check、make test、f38 e2e 10/10。去重键 agent|事件|会话，锁内占位、在 prime 之前判；插件/扩展用 performance.now() 5 秒窗口判「同一时刻的第二份」，重载照常注册。见 D057。
- 2026-09-27T15:34:12Z claude-code@Seans-MacBook-Pro.local check ac=1: 两个钩子同时对同一会话跑 prime --hook：恰好一个输出 prime
- 2026-09-27T15:34:12Z claude-code@Seans-MacBook-Pro.local check ac=2: 同一会话 resume / 压缩后（超过 10 秒）照常注入；没有会话 id 时不去重
- 2026-09-27T15:34:13Z claude-code@Seans-MacBook-Pro.local check ac=3: OpenCode 插件与 pi 扩展装了两份时只有一份生效
- 2026-09-27T15:35:12Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=1b709b1 dirty=true
