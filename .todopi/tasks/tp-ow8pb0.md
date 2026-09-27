---
id: "tp-ow8pb0"
title: "import beads 用第二份真实的 Beads Classic 导出测过（首发清单）"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iu"
verify: "make check && make test && bash tools/e2e/f20-import-beads.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T11:29:03Z"
---

## Description

首发清单 §13 要求至少两份真实导出；目前只用了 Beads 仓库自己的 v0.47.1 导出。

## Acceptance Criteria

- [ ] 找到另一个公开仓库提交的 .beads/issues.jsonl（Classic 时代），导入、doctor 通过、重复导入 0 新建
- [ ] 结果记进 D041

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T11:29:03Z claude-code@Seans-MacBook-Pro.local claimed
