---
id: "tp-q1ikby"
title: "make test / make e2e 不在系统临时目录里留垃圾"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iz"
verify: "make check && make test && bash tools/e2e/f31-private-tmp.sh"
labels: ["m4"]
created: "2026-09-27T10:12:22Z"
updated: "2026-09-27T10:12:46Z"
---

## Description

2026-09-28 磁盘写满：系统临时目录里有 23.6 万个 todopi-* 目录（5.7 GB），每跑一遍 make test + make e2e 多出约 900 个（21 MB）——单测的 mkdtempSync 与 e2e 的 mktemp 大多不清理。

## Acceptance Criteria

- [ ] make test 与 make e2e 在私有的临时目录里跑，结束（含失败与中断）后整个删掉；跑完系统临时目录不多出 todopi-* 条目
- [ ] make ci 连跑两层时共用一个，不漏

## Log

- 2026-09-27T10:12:22Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-27T10:12:46Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T10:12:46Z claude-code@Seans-MacBook-Pro.local claimed
