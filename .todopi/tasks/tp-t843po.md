---
id: "tp-t843po"
title: "README 首发版：六家 agent 的安装说明、协议、vs Beads、读音；纠正与实现不符的声明"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "ir"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T08:30:13Z"
---

## Description

首发清单 §13 要求 README 含六家安装方式、协议、「vs Beads」段落、读音与名字来源；审计另发现两处声明不准（验证失败就不能关成 done——--force 可以；依赖与体积）。

## Acceptance Criteria

- [x] 六家各有一节：setup 命令、需要信任的地方（Codex 钩子、pi 项目）、todopi 必须在 PATH 上
- [x] 协议文本或其链接
- [x] vs Beads 段落
- [x] 读音与名字来源（已有，核对）
- [x] 每条声明都与实现一致

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T08:08:41Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T08:29:11Z claude-code@Seans-MacBook-Pro.local note: Evidence: README has a section per agent (setup command, files written, recovery after compaction, trust for Codex hooks and pi projects), the PATH requirement, --user scope, install.sh branches and supported binary platforms, the protocol (linked to src/protocol.ts), vs Beads (checked against Beads' README 2026-09-28: Dolt embedded or server; JSONL is an export), and the name. Corrected: done can be forced (recorded, unverified); size measured as file bytes. tests/readme.test.ts (5) checks subcommand count, setup files per agent incl. --user, trust notes, protocol markers, Beads id location, binary platforms against the code. Codex 3 rounds -> Go. D049.
- 2026-09-27T08:29:11Z claude-code@Seans-MacBook-Pro.local check ac=1: 六家各有一节：setup 命令、需要信任的地方（Codex 钩子、pi 项目）、todopi 必须在 PATH 上
- 2026-09-27T08:29:12Z claude-code@Seans-MacBook-Pro.local check ac=2: 协议文本或其链接
- 2026-09-27T08:29:12Z claude-code@Seans-MacBook-Pro.local check ac=3: vs Beads 段落
- 2026-09-27T08:29:12Z claude-code@Seans-MacBook-Pro.local check ac=4: 读音与名字来源（已有，核对）
- 2026-09-27T08:29:12Z claude-code@Seans-MacBook-Pro.local check ac=5: 每条声明都与实现一致
- 2026-09-27T08:30:13Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=f24b1fc dirty=true
