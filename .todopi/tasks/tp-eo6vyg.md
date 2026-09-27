---
id: "tp-eo6vyg"
title: "把 --json 的输出契约写成文档，写明兼容与版本承诺（FR-Q3）"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "iqi"
verify: "make check && make test"
labels: ["m4"]
created: "2026-09-27T03:14:16Z"
updated: "2026-09-27T07:08:28Z"
---

## Description

审计发现：每个命令的 --json 有 DTO，但没有面向使用者的结构文档与兼容说明。

## Acceptance Criteria

- [ ] docs/json.md 逐命令列出 --json 的字段与类型（从 src/output/dto 核对，不凭记忆写）
- [ ] 写明版本承诺：破坏性变更升 CLI 主版本
- [ ] 有一个检查保证文档里的字段与 DTO 类型一致，或文档由 DTO 生成

## Log

- 2026-09-27T03:14:16Z seandong created
- 2026-09-27T03:14:25Z seandong moved
- 2026-09-27T07:08:28Z claude-code@Seans-MacBook-Pro.local claimed
