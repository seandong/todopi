---
id: "tp-eo6vyg"
title: "把 --json 的输出契约写成文档，写明兼容与版本承诺（FR-Q3）"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iqi"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:16Z"
updated: "2026-09-27T07:53:55Z"
---

## Description

审计发现：每个命令的 --json 有 DTO，但没有面向使用者的结构文档与兼容说明。

## Acceptance Criteria

- [x] docs/json.md 逐命令列出 --json 的字段与类型（从 src/output/dto 核对，不凭记忆写）
- [x] 写明版本承诺：破坏性变更升 CLI 主版本
- [x] 有一个检查保证文档里的字段与 DTO 类型一致，或文档由 DTO 生成

## Log

- 2026-09-27T03:14:16Z seandong created
- 2026-09-27T03:14:25Z seandong moved
- 2026-09-27T07:08:28Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T07:52:56Z claude-code@Seans-MacBook-Pro.local note: Evidence: docs/json.md lists every --json report field by field (checked against src/output/dto and src/domain), the command→report table, and the compatibility promise (breaking changes bump the CLI major version; before 1.0 the leftmost non-zero part). ARCH-028 (tools/check-json-doc.mjs) compiles each section against the real exported type with tsc (exact equality, tuples/readonly preserved), reads exports from tsc-emitted declarations and fails closed on unknown export forms, nested dirs and duplicate names; tests/harness/check-json-doc.test.ts (13) + tests/output/json-doc-mapping.test.ts runs every command. Codex 8 rounds -> Go. D048.
- 2026-09-27T07:52:56Z claude-code@Seans-MacBook-Pro.local check ac=1: docs/json.md 逐命令列出 --json 的字段与类型（从 src/output/dto 核对，不凭记忆写）
- 2026-09-27T07:52:56Z claude-code@Seans-MacBook-Pro.local check ac=2: 写明版本承诺：破坏性变更升 CLI 主版本
- 2026-09-27T07:52:56Z claude-code@Seans-MacBook-Pro.local check ac=3: 有一个检查保证文档里的字段与 DTO 类型一致，或文档由 DTO 生成
- 2026-09-27T07:53:55Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=61de50e dirty=true
