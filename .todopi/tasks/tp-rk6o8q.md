---
id: "tp-rk6o8q"
title: "终端输出统一为 Cargo 式，只在有人看时上色（init、setup 起，推到所有命令）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "j05"
verify: "make check && make test"
created: "2026-09-28T06:05:48Z"
updated: "2026-09-28T08:24:28Z"
---

## Description

用户反馈（dogfood，2026-09-28）：todopi init 输出纯文本「真丑」。只在人直接看终端时上色；--json、钩子、检测到 agent、NO_COLOR、TERM=dumb 一律纯文本（ARCH-027：进模型上下文的输出不能有转义）。先做 init 与 setup 给用户看效果，再推到其余命令。

## Acceptance Criteria

- [x] 上色的判定只有一处：--json / 钩子 / 检测到 agent / NO_COLOR / TERM=dumb 纯文本；FORCE_COLOR 只越过 isTTY；其余看 stdout.isTTY
- [x] 子进程测试：FORCE_COLOR 下 --json、prime --hook、CLAUDECODE=1 的 stdout 没有 ESC；只给 FORCE_COLOR 时有；去掉 agent 分支的变异会红
- [x] init 用相对路径，Next 先指向 todopi setup <agent> 再指向 add；setup 同样有样式；--quiet 边界不变

## Log

- 2026-09-28T06:05:48Z claude-code@Seans-MacBook-Pro.local created
- 2026-09-28T06:05:48Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-28T08:23:36Z claude-code@Seans-MacBook-Pro.local edited fields=title
- 2026-09-28T08:23:36Z claude-code@Seans-MacBook-Pro.local note: 用户在三种风格里选了 Cargo / uv 式、所有命令统一（2026-09-28）。范围因此从 init、setup 扩到所有命令（prime、handoff 的排版不动）。Codex 三轮 → Go（1dc5e28）。评审抓到：错误消息里数据自带的控制字符、FORCE_COLOR 在管道里的排版、管道里空 ls 的提示、全命令测试走错误路径的假绿、ARCH-029 太窄、测试写真实信任清单——都已改。D059。
- 2026-09-28T08:23:36Z claude-code@Seans-MacBook-Pro.local check ac=1: 上色的判定只有一处：--json / 钩子 / 检测到 agent / NO_COLOR / TERM=dumb 纯文本；FORCE_COLOR 只越过 isT
- 2026-09-28T08:23:37Z claude-code@Seans-MacBook-Pro.local check ac=2: 子进程测试：FORCE_COLOR 下 --json、prime --hook、CLAUDECODE=1 的 stdout 没有 ESC；只给 FORCE_CO
- 2026-09-28T08:23:37Z claude-code@Seans-MacBook-Pro.local check ac=3: init 用相对路径，Next 先指向 todopi setup <agent> 再指向 add；setup 同样有样式；--quiet 边界不变
- 2026-09-28T08:24:28Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=1dc5e28 dirty=true
