---
id: "tp-85y7ej"
title: "todopi setup pi 装好，pi 的会话开始与压缩后都能收到注入"
status: "open"
blocked_by: ["tp-thtkze"]
rank: "if"
verify: "make check && make test && bash tools/e2e/f16-setup-pi.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F16"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi setup pi 装好，pi 的会话开始与压缩后都能收到注入

迁移自 `feature_list.json` 的 **F16**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

写 .pi/extensions/ 下的扩展，订阅 session_start 与 session_compact（压缩后；session_before_compact 是压缩前，PRD 1.1 版选错了方向）；会话 id 需调 ctx.sessionManager.getSessionId() 自取，不在事件参数里；上下文注入走 before_agent_start；幂等。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：注入没生效→src/setup/pi.ts 用错了事件：pi 的上下文注入机制是 before_agent_start 返回 message 字段，不是在 session_start 里直接写。

- **system**：扩展装不上→pi 的扩展可放 .pi/extensions/ 或经 pi install 分发，确认 setup 选的是项目级路径。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F16
