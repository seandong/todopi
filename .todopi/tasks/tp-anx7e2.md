---
id: "tp-anx7e2"
title: "建好之后能改验收标准与 Plan；add / edit 支持 --edit（打开 $EDITOR）（FR-T4）"
status: "in_progress"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "io"
verify: "make check && make test && bash tools/e2e/f24-edit-body.sh"
labels: ["m4"]
created: "2026-09-27T03:14:02Z"
updated: "2026-09-27T04:26:46Z"
---

## Description

审计发现：edit 只能改标题、描述、verify、labels、parent，任务建好后没有 CLI 办法再改验收标准或 Plan；§8 列出的 add --edit、edit --edit 都报 unknown option。

## Acceptance Criteria

- [ ] edit 能增、改、删未勾选的验收标准（已勾选的不能被悄悄改掉）
- [ ] edit 能设置 / 清空 Plan
- [ ] add --edit 与 edit --edit 打开 $EDITOR，保存后校验、写回；编辑器报错或内容不合法时什么都不写
- [ ] Log 记 edited fields=…

## Log

- 2026-09-27T03:14:02Z seandong created
- 2026-09-27T04:26:46Z claude-code@Seans-MacBook-Pro.local claimed
