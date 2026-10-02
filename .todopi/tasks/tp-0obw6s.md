---
id: "tp-0obw6s"
title: "board.test.ts 在整套 make test 负载下偶发失败"
status: "in_progress"
assignee: "claude-code@Mac"
rank: "j07"
verify: "make test"
created: "2026-09-28T07:33:43Z"
updated: "2026-10-02T03:02:49Z"
---

## Description

2026-09-28 做 tp-rk6o8q 时 make test 里 board.test.ts 失败一次（not ok 5），单独跑 17/17 通过，整套重跑也通过；改动没碰看板。多半是文件监听/轮询的时序在高负载下超时。要找出是哪个断言、给它确定性的等待。

## Log

- 2026-09-28T07:33:43Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-02T02:46:53Z claude-code@Mac claimed
- 2026-10-02T02:51:00Z claude-code@Mac note: Current isolated board.test.ts passes 17/17. Several assertions use fixed 200–400 ms sleeps after 30–100 ms polling; wait for the recorded failing assertion before narrowing the fix. The full-suite failure was on 2026-09-28 after the 2026-09-26 FSEvents fallback commit.
- 2026-10-02T03:02:49Z claude-code@Mac note: Original 2026-09-28 run retained only the file-level TAP failure via grep; no assertion stack survives. Three full make test runs before edits were green. Replaced three fixed positive polling sleeps with observable callback waits; board 17/17 and two full make test runs after edits pass. This reduces a demonstrated timing hazard but cannot prove the historical failure was one of those assertions.
