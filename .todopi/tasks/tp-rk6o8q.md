---
id: "tp-rk6o8q"
title: "人在终端里看时输出带样式：先做 init 与 setup"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j05"
verify: "make check && make test"
created: "2026-09-28T06:05:48Z"
updated: "2026-09-28T06:05:48Z"
---

## Description

用户反馈（dogfood，2026-09-28）：todopi init 输出纯文本「真丑」。只在人直接看终端时上色；--json、钩子、检测到 agent、NO_COLOR、TERM=dumb 一律纯文本（ARCH-027：进模型上下文的输出不能有转义）。先做 init 与 setup 给用户看效果，再推到其余命令。

## Acceptance Criteria

- [ ] 上色的判定只有一处：--json / 钩子 / 检测到 agent / NO_COLOR / TERM=dumb 纯文本；FORCE_COLOR 只越过 isTTY；其余看 stdout.isTTY
- [ ] 子进程测试：FORCE_COLOR 下 --json、prime --hook、CLAUDECODE=1 的 stdout 没有 ESC；只给 FORCE_COLOR 时有；去掉 agent 分支的变异会红
- [ ] init 用相对路径，Next 先指向 todopi setup <agent> 再指向 add；setup 同样有样式；--quiet 边界不变

## Log

- 2026-09-28T06:05:48Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T06:05:48Z claude-code@Seans-MacBook-Pro.local claimed
