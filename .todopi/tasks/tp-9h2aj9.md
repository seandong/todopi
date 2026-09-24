---
id: "tp-9h2aj9"
title: "todopi note / check 追加 Log 并勾选验收标准，且每次写入都刷新 updated"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-1lwice"]
rank: "i8"
verify: "make check && make test && bash tools/e2e/f09-note-check.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F09"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-24T04:16:22Z"
---

## Description

todopi note / check 追加 Log 并勾选验收标准，且每次写入都刷新 updated

迁移自 `feature_list.json` 的 **F09**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

note 支持多行文本（续行缩进两格）；check <n> / --undo 切换第 n 条并按 spec §5.3.3 记录「当时的标准文本、截断到 80 字符」；两者都刷新 updated 与本机租约心跳（FR-C3、spec §6.3）；assignee 是另一个 actor 时拒绝并退出 3（FR-C6 写入严格匹配）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：标准文本没进 Log→src/commands/check.ts 没有在写入前读取该条标准的文本；updated 没刷新→src/format/write.ts 的统一写入路径应无条件 bump，而不是由各命令自行决定。

- **system**：多行 note 读回变成一行→src/format/body.ts 的续行处理。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F09
- 2026-09-24T04:08:47Z seandong claimed
- 2026-09-24T04:16:22Z seandong note: 实现中发现 touchLease 自 F05 起没有任何调用方，而它不看租约是谁的。
  note / check 是第一批调用方，只在租约属于当前 actor 时刷新。
