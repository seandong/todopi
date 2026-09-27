---
id: "tp-t0mlsi"
title: "首次执行 verify：有终端时当场确认，无终端时照旧拒绝并提示 --yes（FR-D4）"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iq"
verify: "make check && make test && bash tools/e2e/f26-trust-prompt.sh"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T06:06:32Z"
---

## Description

审计发现：FR-D4 要求首次执行前「要求确认」，现在有终端时也直接拒绝、要求带 --yes 重跑；这个取舍只写在代码注释里。

## Acceptance Criteria

- [ ] stdin 与 stderr 都是终端时询问一次，回答 y 才执行并记住信任
- [ ] 非终端（agent 调用）行为不变
- [ ] CI=true 与 --yes 行为不变

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T06:06:32Z claude-code@Seans-MacBook-Pro.local claimed
