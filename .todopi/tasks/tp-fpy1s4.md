---
id: "tp-fpy1s4"
title: "prime 在 2,000 个任务下超过 200 ms 目标：别解析用不到的正文"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iy"
verify: "make check && make test && bash tools/bench/ledger-2000.sh"
labels: ["m4"]
created: "2026-09-27T08:46:29Z"
updated: "2026-09-27T13:20:28Z"
---

## Description

F29 基准（tools/bench/ledger-2000.sh，M4 Pro）：ls ≈ 170 ms、show ≈ 120 ms、doctor ≈ 155 ms，prime ≈ 215–235 ms、prime --full ≈ 215–290 ms，超过 PRD §10 的 200 ms。剖析（src 运行）：commonmark ≈ 41 ms（为每个任务正文建 CommonMark 结构，prime 只需要持有任务的标准与 Log）、3 次 git 子进程 ≈ 30 ms（user.name、两次 --git-common-dir，可合并为一次）、prime 记录的 fsync。

## Acceptance Criteria

- [ ] tools/bench/ledger-2000.sh 在同一台机器上 prime 与 prime --full 的中位数 < 200 ms
- [ ] 输出逐字节不变（现有 prime 的测试与 e2e 全绿）

## Log

- 2026-09-27T08:46:29Z claude-code@Seans-MacBook-Pro.local created from=tp-zdp7uh
- 2026-09-27T08:46:30Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T09:24:18Z claude-code@Seans-MacBook-Pro.local note: CI 参考（GitHub ubuntu runner，AMD EPYC 7763 2 核，node 22.23，run 36308800062）：--version 48、ls 440、ls --ready 444、ls --all 475、show 205、doctor 425、prime 543、prime --full 542 ms。比 M4 Pro 慢约 2.5×——在这种机器上连 ls 都远超 200 ms，优化不能只盯 prime：全量读 + 解析 2,000 个文件本身就是大头（doctor 425）。
- 2026-09-27T13:20:28Z claude-code@Seans-MacBook-Pro.local claimed
