---
id: "tp-i3zabw"
title: "版本号改为 0.1.0，准备首个发布"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j03"
verify: "make check && make test"
created: "2026-09-28T03:49:41Z"
updated: "2026-09-28T03:59:36Z"
---

## Acceptance Criteria

- [x] package.json、package-lock.json、src/version.ts 与六家包清单都是 0.1.0，--version 印 0.1.0
- [x] README 的状态行不再说未发布；有 CHANGELOG 记下 0.1.0
- [x] 打包出的 npm tarball 版本是 0.1.0，能装、能跑

## Log

- 2026-09-28T03:49:41Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T03:49:41Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-28T03:58:32Z claude-code@Seans-MacBook-Pro.local note: Codex 一轮 → Go（13246e3）。本地 npm pack 装进临时前缀，todopi / tp --version 为 0.1.0，init / add / doctor 正常。打 v0.1.0 标签是维护者的动作（NPM_TOKEN 已配）。
- 2026-09-28T03:58:32Z claude-code@Seans-MacBook-Pro.local check ac=1: package.json、package-lock.json、src/version.ts 与六家包清单都是 0.1.0，--version 印 0.1.0
- 2026-09-28T03:58:32Z claude-code@Seans-MacBook-Pro.local check ac=2: README 的状态行不再说未发布；有 CHANGELOG 记下 0.1.0
- 2026-09-28T03:58:33Z claude-code@Seans-MacBook-Pro.local check ac=3: 打包出的 npm tarball 版本是 0.1.0，能装、能跑
- 2026-09-28T03:59:36Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=13246e3 dirty=true
