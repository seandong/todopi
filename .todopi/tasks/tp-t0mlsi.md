---
id: "tp-t0mlsi"
title: "首次执行 verify：有终端时当场确认，无终端时照旧拒绝并提示 --yes（FR-D4）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iq"
verify: "make check && make test && bash tools/e2e/f26-trust-prompt.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T06:57:50Z"
---

## Description

审计发现：FR-D4 要求首次执行前「要求确认」，现在有终端时也直接拒绝、要求带 --yes 重跑；这个取舍只写在代码注释里。

## Acceptance Criteria

- [x] stdin 与 stderr 都是终端时询问一次，回答 y 才执行并记住信任
- [x] 非终端（agent 调用）行为不变
- [x] CI=true 与 --yes 行为不变

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T06:06:32Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T06:56:41Z claude-code@Seans-MacBook-Pro.local note: Evidence: FR-D4 — with stdin and stderr both terminals, done asks once before taking the lock, showing the command with control/format/invisible characters escaped (domain/visible.ts); y/yes runs and records trust; anything else, empty line or EOF (even after a typed y) exits 2 with nothing done; LF or CR ends the answer. No terminal, --yes, CI=true unchanged. tests: verify.test.ts (+4), exec/prompt.test.ts, domain/visible.test.ts; mutation on each branch killed. e2e tools/e2e/f26-trust-prompt.sh types answers into a pty after the prompt appears (macOS + util-linux). Codex 3 rounds -> Go. D047.
- 2026-09-27T06:56:41Z claude-code@Seans-MacBook-Pro.local check ac=1: stdin 与 stderr 都是终端时询问一次，回答 y 才执行并记住信任
- 2026-09-27T06:56:41Z claude-code@Seans-MacBook-Pro.local check ac=2: 非终端（agent 调用）行为不变
- 2026-09-27T06:56:41Z claude-code@Seans-MacBook-Pro.local check ac=3: CI=true 与 --yes 行为不变
- 2026-09-27T06:57:50Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=f80fbee dirty=true
