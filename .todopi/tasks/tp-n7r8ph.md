---
id: "tp-n7r8ph"
title: "CLI 表面补齐：FR-Q4 别名、close --reason、--quiet 覆盖、done 被拒时提示 todopi check"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "ini"
verify: "make check && make test && bash tools/e2e/f23-cli-surface.sh"
labels: ["m4"]
created: "2026-09-27T03:14:16Z"
updated: "2026-09-27T04:04:04Z"
---

## Description

审计发现四处小缺口：list、new / create、log、block 四组别名缺失；close --reason 必须配 --force（§8 把两者列为独立参数）；--quiet 下 setup 的提示、import 的 Next、web 的 Ctrl+C 提示仍输出；done 因验收标准被拒时，报告叫人手改任务文件，与协议「Never edit those files by hand」矛盾。

## Acceptance Criteria

- [ ] ls|list、add|new|create、note|log、dep|block 都可用且有用例
- [ ] close 不带 --force 也能记 --reason（记进 closed 事件）
- [ ] 带 --quiet 时 setup、import、web 只输出结果本身
- [ ] done 因验收标准被拒时提示 todopi check <id> <n>，不再叫人改文件

## Log

- 2026-09-27T03:14:16Z seandong created
- 2026-09-27T03:14:25Z seandong moved
- 2026-09-27T04:04:04Z claude-code@Seans-MacBook-Pro.local claimed
