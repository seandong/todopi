---
id: "tp-qf0vch"
title: "规格措辞：doctor --fix 保留 updated 的原写法（§5.1 与 §6.3 的例外写清楚）"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "it"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T09:24:29Z"
---

## Description

审计发现：规格 §5.1 要求写入者给所有值加引号，§6.3（用户 2026-09-26 定）要求修复不动 updated——doctor --fix 修完后 updated 仍是原写法。行为是定过的，规格措辞要把例外写清楚。

## Acceptance Criteria

- [ ] 规格 §5.1 与 §6.3 写明：doctor --fix 保留 updated 的原文（连写法），这是写入者引号规则的唯一例外
- [ ] 规格修订记录（§9.1）补一条

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T09:24:29Z claude-code@Seans-MacBook-Pro.local claimed
