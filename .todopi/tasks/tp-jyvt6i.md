---
id: "tp-jyvt6i"
title: "init --setup <agent>：初始化时一并接入 agent"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j06"
verify: "make check && make test"
created: "2026-09-28T06:07:17Z"
updated: "2026-09-28T10:54:43Z"
---

## Description

用户反馈（dogfood，2026-09-28）：init 时能否顺带 setup。首次使用本来是两步（init、setup <agent>），合成一步。不叫 --agent：那是全局参数（谁在跑这条命令）。

## Acceptance Criteria

- [x] todopi init --setup claude 等价于 init 后 setup claude；可重复、可逗号分隔；未知 agent 在写任何文件之前报错退出
- [x] 输出合并成一份：账本、协议、每家写的文件与提示；--json 里带上 setup 的结果；--quiet 边界不变
- [x] 给了 --setup 时，Next 不再提示 setup；README 与 --help 写明

## Log

- 2026-09-28T06:07:17Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T08:28:59Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-28T10:53:41Z claude-code@Seans-MacBook-Pro.local note: Codex 五轮 → Go（2801d0a）。评审抓到：部分失败时已写文件从输出消失、空 --setup 静默成功、失败的那一家可能已写一部分、非 CliError 失败无上下文、恢复命令用 -C 时跑不通、控制字符/零宽空格路径下恢复命令不可照抄——都已改，测试把恢复命令交给 /bin/sh 真执行。另在真终端（herdr pane）里跑过 init --setup claude 与日常流程。
- 2026-09-28T10:53:41Z claude-code@Seans-MacBook-Pro.local check ac=1: todopi init --setup claude 等价于 init 后 setup claude；可重复、可逗号分隔；未知 agent 在写任何文件之前报错
- 2026-09-28T10:53:41Z claude-code@Seans-MacBook-Pro.local check ac=2: 输出合并成一份：账本、协议、每家写的文件与提示；--json 里带上 setup 的结果；--quiet 边界不变
- 2026-09-28T10:53:41Z claude-code@Seans-MacBook-Pro.local check ac=3: 给了 --setup 时，Next 不再提示 setup；README 与 --help 写明
- 2026-09-28T10:54:43Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=2801d0a dirty=true
