---
id: "tp-zdp7uh"
title: "性能基准：2,000 个任务下常用读命令的耗时，可复现的脚本"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "is"
verify: "make check && make test && bash tools/bench/ledger-2000.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T09:10:48Z"
---

## Description

PRD §10 的「2,000 个任务 < 200 ms」没有当前版本可复现的证据，审计时机器负载高、测不准。

## Acceptance Criteria

- [x] tools/bench/ledger-2000.sh 生成 2,000 个任务并测 ls / ready / prime / show 的耗时（多次取中位数）
- [x] 结果与机器信息记进 PRD §10
- [x] 不作为门禁（CI 机器差异大），但脚本本身在 CI 里能跑通

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T08:40:43Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T09:09:24Z claude-code@Seans-MacBook-Pro.local note: Evidence: tools/bench/ledger-2000.sh builds dist to a temp dir, generates 2,000 tasks deterministically with the project's emitter (594 closed, 198 in progress with 5 held by the prime actor, 296 blocked_by, 20 containers/990 children, 2-6 Log lines, verify pass/none consistent), checks doctor, prints the measured shape, times --version/ls x4/prime/prime --full/show/doctor with warm-up and N runs (median/min/max, process start included). Runs on Node 20 and 22, macOS and Linux; CI step (not a gate, pipefail). PRD §10 records the reference run (Linux VM on M4 Pro: ls 155, show 85, doctor 148, prime 215 ms) as a snapshot; prime over 200 ms -> tp-fpy1s4. Codex 3 rounds -> Go. D050.
- 2026-09-27T09:09:24Z claude-code@Seans-MacBook-Pro.local check ac=1: tools/bench/ledger-2000.sh 生成 2,000 个任务并测 ls / ready / prime / show 的耗时（多次取中位数）
- 2026-09-27T09:09:24Z claude-code@Seans-MacBook-Pro.local check ac=2: 结果与机器信息记进 PRD §10
- 2026-09-27T09:09:24Z claude-code@Seans-MacBook-Pro.local check ac=3: 不作为门禁（CI 机器差异大），但脚本本身在 CI 里能跑通
- 2026-09-27T09:10:48Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=6ac7f4b dirty=true
