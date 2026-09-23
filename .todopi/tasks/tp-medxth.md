---
id: "tp-medxth"
title: "todopi import <plan.md> 把 Markdown checkbox 计划转成带 id 的任务"
status: "open"
blocked_by: ["tp-wj9u76"]
rank: "ii"
verify: "make check && make test && bash tools/e2e/f19-import-md.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F19"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi import <plan.md> 把 Markdown checkbox 计划转成带 id 的任务

迁移自 `feature_list.json` 的 **F19**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

标题层级映射为 parent、文档顺序映射为 rank、已勾选项建成 closed/done 且 forced=true；每个任务记 created source=<path>；按 (source, title) 幂等——重复导入不产生重复任务，且已存在任务的 rank 保留不重算；纯解析，不联网（ARCH-001）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：幂等失败→src/import/markdown.ts 应在创建前按 (source, title) 查已有任务；rank 被重算→同文件，已存在的任务跳过 rank 分配。

- **system**：导入后 doctor 非 0→多半是 parent 指向了一个尚未创建的任务，应按文档顺序先建父后建子。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F19
