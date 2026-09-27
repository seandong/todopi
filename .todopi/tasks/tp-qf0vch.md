---
id: "tp-qf0vch"
title: "规格措辞：doctor --fix 保留 updated 的原写法（§5.1 与 §6.3 的例外写清楚）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "it"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:03Z"
updated: "2026-09-27T09:51:34Z"
---

## Description

审计发现：规格 §5.1 要求写入者给所有值加引号，§6.3（用户 2026-09-26 定）要求修复不动 updated——doctor --fix 修完后 updated 仍是原写法。行为是定过的，规格措辞要把例外写清楚。

## Acceptance Criteria

- [x] 规格 §5.1 与 §6.3 写明：doctor --fix 保留 updated 的原文（连写法），这是写入者引号规则的唯一例外
- [x] 规格修订记录（§9.1）补一条

## Log

- 2026-09-27T03:14:03Z seandong created
- 2026-09-27T09:24:29Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T09:50:25Z claude-code@Seans-MacBook-Pro.local note: Evidence: spec §5.1 names the one exception to the quoting rule; §6.3 says a normalizing repair keeps the updated entry byte for byte (quoting, timestamp form, trailing comment), limits the normalized timestamp to created, and says a non-canonical updated survives (doctor still reports a bad value; the next real write replaces it) — checked by running the CLI; checklist and §9.1 revision 2026-09-28 updated. Also fixed doctor invariant-6 comparing non-canonical timestamps as strings (+00:00 vs Z). Codex 1 round -> Go. D051.
- 2026-09-27T09:50:25Z claude-code@Seans-MacBook-Pro.local check ac=1: 规格 §5.1 与 §6.3 写明：doctor --fix 保留 updated 的原文（连写法），这是写入者引号规则的唯一例外
- 2026-09-27T09:50:26Z claude-code@Seans-MacBook-Pro.local check ac=2: 规格修订记录（§9.1）补一条
- 2026-09-27T09:51:34Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=dac6f3b dirty=true
