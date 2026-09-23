---
id: "tp-lxj04s"
title: "todopi edit / move / dep 修改字段、顺序与依赖，形成环时被拒绝并打印环"
status: "open"
blocked_by: ["tp-9h2aj9"]
rank: "i9"
verify: "make check && make test && bash tools/e2e/f10-edit-move-dep.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F10"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi edit / move / dep 修改字段、顺序与依赖，形成环时被拒绝并打印环

迁移自 `feature_list.json` 的 **F10**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

edit 修改 title/description/verify/labels/parent 并记 edited fields=…；move 是改 rank 的唯一途径且只重写一个文件（FR-T5，成立前提是 F03 已做到创建即分配 rank）；dep add/rm 维护 blocked_by，parent 图与 blocked_by 图的环都被拒绝、退出 1 并打印出环的路径。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：环检测失败→src/domain/graph.ts；用例应覆盖长度为 1（自指）与长度大于 2 的环；move 改了不止一个文件→src/commands/move.ts 调用 fractional-indexing 时应只对被移动任务求新 rank。

- **system**：move 后顺序不对→确认 fractional-indexing 用的是 base36 字符集，与 spec §5.2 的 rank 正则一致。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F10
