---
id: "tp-lv7y3h"
title: "首发后一周的跟进准备好：六家市场 / 注册表的包与 awesome 列表的条目"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j01"
verify: "make check && make test"
labels: ["m5"]
created: "2026-09-27T14:20:54Z"
updated: "2026-09-27T16:22:30Z"
---

## Description

首发清单 §13 与 FR-A4：六家接入的能力首发时已完整（setup），上架市场 / 注册表（Claude Code plugin、Codex plugin、OpenCode plugin、pi package、Cursor、Gemini 扩展）是首发后一周内的跟进，但清单要求首发前准备好。本任务只做仓库里的准备：按各家当前的规范写好包清单与安装说明、awesome 列表的条目文字；提交与上架是维护者的动作。

## Acceptance Criteria

- [x] 六家各自按当前官方规范核实过打包方式（有出处），能在仓库里准备的都准备好，不能的写清楚缺什么
- [x] 每个包都在本地按该家的方式装一次，agent 会话开始时收到 prime（Cursor 未登录无法本机测，并入 tp-zagvp5）
- [x] awesome 列表：列出目标列表与各自的条目文字

## Log

- 2026-09-27T14:20:54Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-27T14:21:05Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T14:22:40Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T14:36:18Z claude-code@Seans-MacBook-Pro.local released
- 2026-09-27T15:51:43Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T16:21:36Z claude-code@Seans-MacBook-Pro.local note: Codex 一轮 → Go（27a3631）。验收 2 收窄：Cursor 插件本机没法测（cursor-agent 未登录），并入维护者的 tp-zagvp5（已记步骤）；其余五家实测见 D058 / docs/marketplaces.md。
- 2026-09-27T16:21:36Z claude-code@Seans-MacBook-Pro.local edited fields=acceptance
- 2026-09-27T16:21:36Z claude-code@Seans-MacBook-Pro.local check ac=1: 六家各自按当前官方规范核实过打包方式（有出处），能在仓库里准备的都准备好，不能的写清楚缺什么
- 2026-09-27T16:21:36Z claude-code@Seans-MacBook-Pro.local check ac=2: 每个包都在本地按该家的方式装一次，agent 会话开始时收到 prime（Cursor 未登录无法本机测，并入 tp-zagvp5）
- 2026-09-27T16:21:36Z claude-code@Seans-MacBook-Pro.local check ac=3: awesome 列表：列出目标列表与各自的条目文字
- 2026-09-27T16:22:30Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=27a3631 dirty=true
