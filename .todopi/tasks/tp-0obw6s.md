---
id: "tp-0obw6s"
title: "board.test.ts 在整套 make test 负载下偶发失败"
status: "open"
rank: "j07"
verify: "make test"
created: "2026-09-28T07:33:43Z"
updated: "2026-09-28T07:33:43Z"
---

## Description

2026-09-28 做 tp-rk6o8q 时 make test 里 board.test.ts 失败一次（not ok 5），单独跑 17/17 通过，整套重跑也通过；改动没碰看板。多半是文件监听/轮询的时序在高负载下超时。要找出是哪个断言、给它确定性的等待。

## Log

- 2026-09-28T07:33:43Z claude-code@Seans-MacBook-Pro.local created
