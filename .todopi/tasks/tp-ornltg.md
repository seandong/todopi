---
id: "tp-ornltg"
title: "发布工作流的 npm publish 把 out/x.tgz 当成 GitHub 简写"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j04"
verify: "make check && make test"
created: "2026-09-28T04:18:03Z"
updated: "2026-09-28T05:47:55Z"
---

## Acceptance Criteria

- [x] release.yml 用 ./out/ 路径；本地 npm publish --dry-run 复现旧写法失败、新写法通过
- [x] 测试挡住工作流里以「名字/」开头的 .tgz 相对路径
- [x] v0.1.0 发布成功：npm 上有 todopi@0.1.0，GitHub Release 附四个平台二进制与 SHA256SUMS

## Log

- 2026-09-28T04:18:03Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T04:18:04Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-28T05:46:57Z claude-code@Seans-MacBook-Pro.local note: v0.1.0 已发布：Release 重跑（令牌补上 bypass 2FA 后）成功，npm 有 todopi@0.1.0，GitHub Release 附四个平台二进制、SHA256SUMS、npm 包与 formula。实装：npm i -g todopi 印 0.1.0；install.sh 的 npm 路径（TODOPI_VERSION=0.1.0）装上后 init / add / claim / done 正常。二进制路径与 raw install.sh 未能实测：仓库是私有的，Release 资产与 raw 文件匿名下载都 404——等维护者决定公开仓库。
- 2026-09-28T05:46:57Z claude-code@Seans-MacBook-Pro.local check ac=1: release.yml 用 ./out/ 路径；本地 npm publish --dry-run 复现旧写法失败、新写法通过
- 2026-09-28T05:46:57Z claude-code@Seans-MacBook-Pro.local check ac=2: 测试挡住工作流里以「名字/」开头的 .tgz 相对路径
- 2026-09-28T05:46:57Z claude-code@Seans-MacBook-Pro.local check ac=3: v0.1.0 发布成功：npm 上有 todopi@0.1.0，GitHub Release 附四个平台二进制与 SHA256SUMS
- 2026-09-28T05:47:55Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=97981ac dirty=true
