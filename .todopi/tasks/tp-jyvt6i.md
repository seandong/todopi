---
id: "tp-jyvt6i"
title: "init --setup <agent>：初始化时一并接入 agent"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j06"
verify: "make check && make test"
created: "2026-09-28T06:07:17Z"
updated: "2026-09-28T08:28:59Z"
---

## Description

用户反馈（dogfood，2026-09-28）：init 时能否顺带 setup。首次使用本来是两步（init、setup <agent>），合成一步。不叫 --agent：那是全局参数（谁在跑这条命令）。

## Acceptance Criteria

- [ ] todopi init --setup claude 等价于 init 后 setup claude；可重复、可逗号分隔；未知 agent 在写任何文件之前报错退出
- [ ] 输出合并成一份：账本、协议、每家写的文件与提示；--json 里带上 setup 的结果；--quiet 边界不变
- [ ] 给了 --setup 时，Next 不再提示 setup；README 与 --help 写明

## Log

- 2026-09-28T06:07:17Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T08:28:59Z claude-code@Seans-MacBook-Pro.local claimed
