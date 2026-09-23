---
id: "tp-oqgjt3"
title: "todopi ls 列出任务，--ready / --blocked / --mine 的结果符合规格 §7 的派生态定义"
status: "closed"
resolution: "done"
blocked_by: ["tp-8fumsa"]
rank: "i3"
verify: "make check && make test && bash tools/e2e/f04-ls.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F04"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi ls 列出任务，--ready / --blocked / --mine 的结果符合规格 §7 的派生态定义

迁移自 `feature_list.json` 的 **F04**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

ready 的三个条件（无子任务、无未关闭的 blocked_by、status 为 open 或 in_progress 且 stale）逐条有用例；排序符合 §7.4（有 rank 在前按字典序、其余按 created、并列按 id）；容器（有子任务者）永不进 ready 且显示 n/m 进度；--mine 用 FR-C6 的宽松匹配（本 actor 或以 @<本机 host> 结尾）；--json 输出经 DTO 映射而非直接序列化领域对象（ARCH-008）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：派生态用例失败→src/domain/derive.ts 的对应函数（children/blocked/stale/ready），它们是纯函数，用例直接构造任务集合即可复现；排序失败→src/domain/order.ts；--mine 失败→src/domain/actor.ts 的宽松匹配。

- **system**：--json 结构与文档不符→src/output/dto/task.ts；若报 ARCH-008 违规，说明 src/output/ 直接 import 了 src/domain/ 的类型。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F04
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=0182026: commit 0182026, verified 2026-09-22T07:18:13Z
