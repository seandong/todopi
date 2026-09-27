---
id: "tp-yce3ah"
title: "prime / handoff 输出里的零宽与双向文字字符也转义（commands/view.ts 的 visible 只管 C0/C1）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "ix"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T07:19:45Z"
updated: "2026-09-27T13:14:21Z"
---

## Description

F26 评审发现：只转义 C0/C1 控制字符时，U+200B、U+202E 之类能在终端与 agent 上下文里藏住或伪装文字。domain/visible.ts 已按 Unicode 类别转义（verify 确认提示用）；commands/view.ts 的 visible / visibleLine（ARCH-027，prime / handoff 用）还是旧的只转 C0/C1。统一到一处，保留多行字段的换行。

## Acceptance Criteria

- [x] prime / handoff 的文本与 JSON 输出里，零宽、双向文字、默认不可见字符与非普通空白都以可见转义出现
- [x] 只有一个转义实现；ARCH-027 的检查覆盖新增的字符类

## Log

- 2026-09-27T07:19:45Z claude-code@Seans-MacBook-Pro.local created from=tp-eo6vyg
- 2026-09-27T07:20:09Z claude-code@Seans-MacBook-Pro.local edited fields=verify
- 2026-09-27T13:03:06Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T13:13:21Z claude-code@Seans-MacBook-Pro.local note: Evidence: prime and handoff now escape by Unicode category through domain/visible.ts (visible for single-line fields, visibleMultiline keeping newline/tab for Log entries); the C0/C1-only copies in commands/view.ts are gone, so there is one implementation. ARCH-027's checker (tools/check-injected-output.mjs) uses the same category test, injects U+200B / U+202E into title, criterion, note, verify and checks they come out escaped; reverting to C0/C1-only makes it report leaks. Codex 1 round -> Go. D055.
- 2026-09-27T13:13:22Z claude-code@Seans-MacBook-Pro.local check ac=1: prime / handoff 的文本与 JSON 输出里，零宽、双向文字、默认不可见字符与非普通空白都以可见转义出现
- 2026-09-27T13:13:22Z claude-code@Seans-MacBook-Pro.local check ac=2: 只有一个转义实现；ARCH-027 的检查覆盖新增的字符类
- 2026-09-27T13:14:21Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=71796b8 dirty=true
