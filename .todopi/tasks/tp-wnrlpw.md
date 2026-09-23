---
id: "tp-wnrlpw"
title: "todopi setup claude 一条命令装好，全新克隆上 Claude Code 会话开始时收到 prime 输出"
status: "open"
blocked_by: ["tp-sch6q1"]
rank: "id"
verify: "make check && make test && bash tools/e2e/f14-setup-claude.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F14"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi setup claude 一条命令装好，全新克隆上 Claude Code 会话开始时收到 prime 输出

迁移自 `feature_list.json` 的 **F14**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

写入项目级 .claude/settings.json 的 SessionStart 与 PostCompact 钩子调用 prime、SessionEnd 调用 handoff --check；确保存在含 @AGENTS.md 导入的 CLAUDE.md（FR-Q5a——Claude Code 读 CLAUDE.md 而不读 AGENTS.md，只跑 init 的用户读不到协议）；幂等，重复运行不产生第二份钩子；打印写入的每个文件；--user 切到用户级。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：幂等失败→src/setup/claude.ts 合并 settings.json 时应按 matcher+command 去重，而不是无条件 push。

- **system**：钩子没触发→核对事件名与 matcher 拼写（PRD §17 记录了核实结果：matcher 有 startup/resume/clear/compact/fork 五个）。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F14
