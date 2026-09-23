---
id: "tp-7o45xj"
title: "todopi prime 推送当前任务、用一行指针指向其余，并在预算内截断"
status: "open"
blocked_by: ["tp-djqkva"]
rank: "ia"
verify: "make check && make test && bash tools/e2e/f11-prime.sh"
labels: ["bootstrap", "m2"]
external:
  harness:
    legacy_id: "F11"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi prime 推送当前任务、用一行指针指向其余，并在预算内截断

迁移自 `feature_list.json` 的 **F11**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

有进行中任务时输出标题、带状态的验收标准、最近 2 条 Log，末尾一行指针给出可领数与命令；无进行中任务时退化为单行；协议文本 MUST NOT 出现在输出里（D010）；超预算时在项内截断（保留未勾选的标准、保留最新一条 Log），指针行永不裁剪；--full 输出全量视图；--json 输出同样内容的结构化形式；按会话记录调用时间到运行时目录（FR-P1b）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：截断顺序不对→src/commands/prime.ts 的子预算逻辑；用例应构造一个 10 条验收 + 3 条长 Log 的任务，断言被丢掉的是已勾选的标准而不是指针行；token 估算器→src/domain/tokens.ts，它的用例必须覆盖中文（实测 chars/4 对中文低估 2-3 倍，估算方式见 PRD §15 待决项）。

- **system**：输出里出现了协议文本→删掉；它由 setup 装进各家规则文件，压缩后由 agent 自行重读。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F11
