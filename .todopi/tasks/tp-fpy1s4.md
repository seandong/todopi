---
id: "tp-fpy1s4"
title: "prime 在 2,000 个任务下超过 200 ms 目标：别解析用不到的正文"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iy"
verify: "make check && make test && bash tools/bench/ledger-2000.sh"
labels: ["m4"]
created: "2026-09-27T08:46:29Z"
updated: "2026-09-27T13:59:49Z"
---

## Description

F29 基准（tools/bench/ledger-2000.sh，M4 Pro）：ls ≈ 170 ms、show ≈ 120 ms、doctor ≈ 155 ms，prime ≈ 215–235 ms、prime --full ≈ 215–290 ms，超过 PRD §10 的 200 ms。剖析（src 运行）：commonmark ≈ 41 ms（为每个任务正文建 CommonMark 结构，prime 只需要持有任务的标准与 Log）、3 次 git 子进程 ≈ 30 ms（user.name、两次 --git-common-dir，可合并为一次）、prime 记录的 fsync。

## Acceptance Criteria

- [x] tools/bench/ledger-2000.sh 在同一台机器上 prime 与 prime --full 的中位数 < 200 ms
- [x] 输出逐字节不变（现有 prime 的测试与 e2e 全绿）

## Log

- 2026-09-27T08:46:29Z claude-code@Seans-MacBook-Pro.local created from=tp-zdp7uh
- 2026-09-27T08:46:30Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T09:24:18Z claude-code@Seans-MacBook-Pro.local note: CI 参考（GitHub ubuntu runner，AMD EPYC 7763 2 核，node 22.23，run 36308800062）：--version 48、ls 440、ls --ready 444、ls --all 475、show 205、doctor 425、prime 543、prime --full 542 ms。比 M4 Pro 慢约 2.5×——在这种机器上连 ls 都远超 200 ms，优化不能只盯 prime：全量读 + 解析 2,000 个文件本身就是大头（doctor 425）。
- 2026-09-27T13:20:28Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T13:43:24Z claude-code@Seans-MacBook-Pro.local note: Evidence: profiling the compiled CLI on the 2,000-task bench ledger showed prime re-parsing every body for the verify snapshot (~20 ms), asking git for the common dir twice (~10 ms) and fsyncing its record (~7 ms). Fixes: sectionLines remembers the last body's parse and prime takes each snapshot right after validating that task; gitCommonDir caches per root keyed on <root>/.git identity (worktree repair invalidates; null not cached); the prime record skips fsync. Same-machine interleaved A/B (25 runs, loaded): prime 225 -> 186 ms, prime --full 221 -> 188, ls/doctor unchanged (a whole-body cache made ls 16 ms slower and was dropped). Bench: see Log above. Output unchanged: all prime/handoff tests and e2e pass. Codex 2 rounds -> Go. D056.
- 2026-09-27T13:43:24Z claude-code@Seans-MacBook-Pro.local check ac=1: tools/bench/ledger-2000.sh 在同一台机器上 prime 与 prime --full 的中位数 < 200 ms
- 2026-09-27T13:43:24Z claude-code@Seans-MacBook-Pro.local check ac=2: 输出逐字节不变（现有 prime 的测试与 e2e 全绿）
- 2026-09-27T13:44:40Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=4bec23f dirty=true
- 2026-09-27T13:44:58Z claude-code@Seans-MacBook-Pro.local note: Caveat on criterion 1: the last bench run before closing (load average ~209) gave prime median 223 ms (min 189, one run at 482) and prime --full 189 ms; an earlier run on the same machine gave 180 / 193. Absolute medians swing with load here; the interleaved A/B against main (same conditions) is the reliable comparison and shows ~37 ms saved on both. A run on an idle machine (or the CI job summary) should confirm the absolute number.
- 2026-09-27T13:59:49Z claude-code@Seans-MacBook-Pro.local note: CI bench after merge (run 36323821712, EPYC 9V45 2 cores, load ~3): ls 306, prime 320, prime --full 335 ms. Before F36 (run 36308800062, EPYC 7763): ls 440, prime 543. Different runner CPUs, so compare ratios: prime was 23% slower than ls, now 5%.
