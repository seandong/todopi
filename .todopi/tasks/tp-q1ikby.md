---
id: "tp-q1ikby"
title: "make test / make e2e 不在系统临时目录里留垃圾"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iz"
verify: "make check && make test && bash tools/e2e/f31-private-tmp.sh"
labels: ["m4"]
created: "2026-09-27T10:12:22Z"
updated: "2026-09-27T12:05:36Z"
---

## Description

2026-09-28 磁盘写满：系统临时目录里有 23.6 万个 todopi-* 目录（5.7 GB），每跑一遍 make test + make e2e 多出约 900 个（21 MB）——单测的 mkdtempSync 与 e2e 的 mktemp 大多不清理。

## Acceptance Criteria

- [x] make test 与 make e2e 在私有的临时目录里跑，结束（含失败与中断）后整个删掉；跑完系统临时目录不多出 todopi-* 条目
- [x] make ci 连跑两层时共用一个，不漏

## Log

- 2026-09-27T10:12:22Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-27T10:12:46Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T10:12:46Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T11:07:22Z claude-code@Seans-MacBook-Pro.local note: Evidence: tools/harness.sh runs test and e2e in a private TMPDIR (reused across ci, reuse keyed on an unexported shell variable) and removes it on exit; on INT/TERM it stops orphaned test-file processes found by a per-run environment marker (each pid re-verified before TERM), renames the dir away and deletes it, retrying in the background. A full test+e2e run leaves 0 new todopi-* entries (was ~900 per run; 236k/5.7 GB had accumulated). tools/e2e/f31-private-tmp.sh: normal run and a process-group Ctrl-C both leave TMPDIR empty (asserts exit 130, stopped early). Linux /proc branch only statically checked (Docker/OrbStack stopped) — CI e2e is its first run. Codex 3 rounds -> Go. D052.
- 2026-09-27T11:07:22Z claude-code@Seans-MacBook-Pro.local check ac=1: make test 与 make e2e 在私有的临时目录里跑，结束（含失败与中断）后整个删掉；跑完系统临时目录不多出 todopi-* 条目
- 2026-09-27T11:07:22Z claude-code@Seans-MacBook-Pro.local check ac=2: make ci 连跑两层时共用一个，不漏
- 2026-09-27T11:09:14Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=d54132e dirty=true
- 2026-09-27T12:05:36Z claude-code@Seans-MacBook-Pro.local note: 合并 F32 后 main 上 e2e 偶发失败（f31 打断用例：负载高时 5 秒内目录没删净）。修：孤儿进程十轮 TERM 不走就 KILL；e2e 等目录消失最长 30 秒（后台重试本来就是设计的一部分）。连跑三次通过。
