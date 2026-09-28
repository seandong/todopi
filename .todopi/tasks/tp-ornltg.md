---
id: "tp-ornltg"
title: "发布工作流的 npm publish 把 out/x.tgz 当成 GitHub 简写"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j04"
verify: "make check && make test"
created: "2026-09-28T04:18:03Z"
updated: "2026-09-28T04:18:04Z"
---

## Acceptance Criteria

- [ ] release.yml 用 ./out/ 路径；本地 npm publish --dry-run 复现旧写法失败、新写法通过
- [ ] 测试挡住工作流里以「名字/」开头的 .tgz 相对路径
- [ ] v0.1.0 发布成功：npm 上有 todopi@0.1.0，GitHub Release 附四个平台二进制与 SHA256SUMS

## Log

- 2026-09-28T04:18:03Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T04:18:04Z claude-code@Seans-MacBook-Pro.local claimed
