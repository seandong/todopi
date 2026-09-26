---
id: "tp-sch6q1"
title: "todopi handoff 报告本会话的产出并刷新心跳，但不释放认领"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-7o45xj"]
rank: "ib"
verify: "make check && make test && bash tools/e2e/f12-handoff.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F12"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T04:06:41Z"
---

## Description

todopi handoff 报告本会话的产出并刷新心跳，但不释放认领

迁移自 `feature_list.json` 的 **F12**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

报告用 FR-C6 的宽松匹配（人能看到自己 agent 做了什么）：最近一小时无 Log 的进行中任务、自上次 prime 以来创建的任务、verify 字段变更过的任务；只向自己是 assignee 的任务追加 handoff Log 并刷新那些心跳（写入严格匹配）；MUST NOT 释放认领；--check 只输出报告并退出 0（供钩子调用）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：「本会话」范围不对→src/commands/handoff.ts 读的应是 F11 写入运行时目录的会话级时间戳，agent 未暴露会话 id 时才回退到 actor 级。

- **system**：--check 有副作用→它必须只读；写入分支只在不带 --check 时执行。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F12
- 2026-09-26T04:06:41Z seandong claimed
