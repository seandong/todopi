---
id: "tp-zdp7uh"
title: "性能基准：2,000 个任务下常用读命令的耗时，可复现的脚本"
status: "open"
rank: "is"
verify: "make check && make test && bash tools/bench/ledger-2000.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T03:14:03Z"
---

## Description

PRD §10 的「2,000 个任务 < 200 ms」没有当前版本可复现的证据，审计时机器负载高、测不准。

## Acceptance Criteria

- [ ] tools/bench/ledger-2000.sh 生成 2,000 个任务并测 ls / ready / prime / show 的耗时（多次取中位数）
- [ ] 结果与机器信息记进 PRD §10
- [ ] 不作为门禁（CI 机器差异大），但脚本本身在 CI 里能跑通

## Log

- 2026-09-27T03:14:03Z seandong created
