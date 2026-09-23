---
id: "tp-thtkze"
title: "todopi setup codex / opencode 装好，两家的会话开始与压缩后都能收到注入"
status: "open"
blocked_by: ["tp-wnrlpw"]
rank: "ie"
verify: "make check && make test && bash tools/e2e/f15-setup-codex-opencode.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F15"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi setup codex / opencode 装好，两家的会话开始与压缩后都能收到注入

迁移自 `feature_list.json` 的 **F15**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

Codex 写 .codex/hooks.json 的 SessionStart / PostCompact / SessionEnd；OpenCode 写 .opencode/plugins/ 下的插件，通过 event 钩子订阅 session.created 与 session.compacted；两家的会话 id 取法不同（OpenCode 在事件对象上给 session_id 或 sessionID 两种拼法），都要能取到；幂等。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：OpenCode 插件形状不对→src/setup/opencode.ts；它返回的是 { event: async ({event}) => {} }，session.compacted 是事件而不是顶层钩子名（PRD §17）。

- **system**：生成的配置不被各家接受→对照 PRD §17 的配置位置表逐项核对。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F15
