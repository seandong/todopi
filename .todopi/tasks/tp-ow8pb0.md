---
id: "tp-ow8pb0"
title: "import beads 用第二份真实的 Beads Classic 导出测过（首发清单）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iu"
verify: "make check && make test && bash tools/e2e/f20-import-beads.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T11:45:33Z"
---

## Description

首发清单 §13 要求至少两份真实导出；目前只用了 Beads 仓库自己的 v0.47.1 导出。

## Acceptance Criteria

- [x] 找到另一个公开仓库提交的 .beads/issues.jsonl（Classic 时代），导入、doctor 通过、重复导入 0 新建
- [x] 结果记进 D041

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T11:29:03Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T11:44:30Z claude-code@Seans-MacBook-Pro.local note: Evidence: imported six more real Beads exports from other public repos, each pinned to a commit (mantoni/beads-ui, DavidWells/markdown-magic, Dicklesworthstone/rano, imbue-ai/offload, luna-system/ada, davetashner/stringer; 1,211 lines): every one passes doctor and re-imports with 0 new. Found: custom statuses (offload's cancelled/done) were silently opened; since the export carries no status category, they still import as open but with one warning per status listing todopi ids with their Beads ids and the commands to close them; non-string status lines are rejected by line number. Results table in D041. Codex 3 rounds -> Go.
- 2026-09-27T11:44:30Z claude-code@Seans-MacBook-Pro.local check ac=1: 找到另一个公开仓库提交的 .beads/issues.jsonl（Classic 时代），导入、doctor 通过、重复导入 0 新建
- 2026-09-27T11:44:30Z claude-code@Seans-MacBook-Pro.local check ac=2: 结果记进 D041
- 2026-09-27T11:45:33Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=22a81bc dirty=true
