---
id: "tp-wj9u76"
title: "todopi doctor --fix 规范化可修复的偏差，且永不修改 Log"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-lxj04s"]
rank: "ic"
verify: "make check && make test && bash tools/e2e/f13-doctor-fix.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F13"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T05:34:41Z"
---

## Description

todopi doctor --fix 规范化可修复的偏差，且永不修改 Log

迁移自 `feature_list.json` 的 **F13**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

--fix 规范化 frontmatter 的 key 顺序与引号形态、checkbox 语法，按 created 顺序回填缺失的 rank，清除过期租约；对 spec/fixtures/valid/unquoted-hand-written.md 这类人手写文件，--fix 后应变为加引号形态且语义不变；Log 区在任何情况下都不被改写——包括无法解析的行，只报告不修复（FR-Q1）；仍有问题时退出 1。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：Log 被改动→src/commands/doctor.ts 的 fix 分支越界了，它的作用域只有 frontmatter 与验收标准区；回填 rank 后顺序变了→应按 created 升序分配，使原有相对顺序不变。

- **system**：--fix 后 doctor 仍非 0→输出会列出剩余问题；不可自动修复的项（如环、孤儿引用）本就不在 --fix 范围内。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F13
- 2026-09-26T05:34:41Z seandong claimed
