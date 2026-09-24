---
id: "tp-djqkva"
title: "todopi show 打印任务详情，--tree 显示父子链与子任务进度"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-oqgjt3"]
rank: "i7"
verify: "make check && make test && bash tools/e2e/f08-show.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F08"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-24T04:07:00Z"
---

## Description

todopi show 打印任务详情，--tree 显示父子链与子任务进度

迁移自 `feature_list.json` 的 **F08**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

默认显示 frontmatter、带序号的验收标准、最近 5 条 Log 并给出总条数；--full 显示全部；--tree 显示父链与子任务的 n/m 进度；--json 经 DTO 映射；正文中未被识别的小节（非四个 H2）在读取时被忽略、在写回时原样保留。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：Log 条数不对→src/format/body.ts 的 Log 解析没有处理多行续行（缩进两格，用 \n 连接）；未识别小节丢失→同文件的正文分段逻辑。

- **system**：--tree 进度不对→src/domain/derive.ts 的 children 计数；容器的判定是「有一个以上子任务」。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F08
- 2026-09-24T03:43:12Z seandong claimed
- 2026-09-24T04:07:00Z seandong done verify=pass commit=92baaf7 dirty=false
