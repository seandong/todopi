---
id: "tp-l5hm3q"
title: "Remove publication caveats from READMEs"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j0c"
verify: "make check"
created: "2026-10-08T11:19:11Z"
updated: "2026-10-08T11:34:58Z"
---

## Acceptance Criteria

- [x] English and Chinese READMEs show the current npm install and Node requirement without internal publication commentary
- [x] Both READMEs retain website and language links, and documentation checks pass

## Log

- 2026-10-08T11:19:11Z claude-code@Seans-MacBook-Pro.local created
- 2026-10-08T11:19:17Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-10-08T11:25:10Z claude-code@Seans-MacBook-Pro.local note: 远端 Harness 暴露 README 旧测试把长篇章节当契约，精简后 5 条断言失败并拖累 e2e；将详细接入说明迁至独立文档，保持行为检查并让测试指向新文档。
- 2026-10-08T11:32:29Z claude-code@Seans-MacBook-Pro.local check ac=1: English and Chinese READMEs show the current npm install and Node requirement wi
- 2026-10-08T11:32:38Z claude-code@Seans-MacBook-Pro.local check ac=2: Both READMEs retain website and language links, and documentation checks pass
- 2026-10-08T11:34:58Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=aab71b3 dirty=true
