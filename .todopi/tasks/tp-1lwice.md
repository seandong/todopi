---
id: "tp-1lwice"
title: "todopi done / close / reopen 在门禁不满足时拒绝，并打印一份不需要再跑别的命令就能据以行动的报告"
status: "closed"
resolution: "done"
blocked_by: ["tp-8evtlp"]
rank: "i5"
verify: "make check && make test && bash tools/e2e/f06-gates.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F06"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi done / close / reopen 在门禁不满足时拒绝，并打印一份不需要再跑别的命令就能据以行动的报告

迁移自 `feature_list.json` 的 **F06**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

四道门禁各有用例：验收标准未勾全、子任务未关闭、归属是另一个 actor、（verify 留给 F07）；拒绝时退出 2（门禁）或 3（归属冲突），报告点名是哪道门并列出具体内容——未勾的标准带序号与文本、未关闭的子任务带 id/title/status——结尾给出两条出路（FR-D2a）；被拒绝的转换 MUST NOT 向 Log 追加任何内容（spec §5.3.3）；--force --reason 越过任一门禁并记 forced=true；reopen 同时清除 resolution 与 assignee（不变量 3）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：「拒绝后 Log 变长了」这类用例失败→src/commands/done.ts 在门禁判定之前就调用了写入路径，应当先判定后写入；reopen 用例失败→src/commands/reopen.ts 只移除了 resolution，漏了 assignee。

- **system**：报告内容不足→src/output/dto/gate.ts 与 src/output/render/gate.ts；它必须能独立回答「哪道门、具体是什么、下一步做什么」三个问题。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F06
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=e330152: commit e330152, verified 2026-09-23T02:18:24Z
