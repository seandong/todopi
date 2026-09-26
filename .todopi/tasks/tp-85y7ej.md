---
id: "tp-85y7ej"
title: "todopi setup pi 装好，pi 的会话开始与压缩后都能收到注入"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-thtkze"]
rank: "if"
verify: "make check && make test && bash tools/e2e/f16-setup-pi.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F16"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T10:49:45Z"
---

## Description

todopi setup pi 装好，pi 的会话开始与压缩后都能收到注入

迁移自 `feature_list.json` 的 **F16**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi setup pi` 装好（标题）
- [x] pi 的会话开始时收到注入（标题）
- [x] pi 压缩后收到注入（标题）
- [x] 扩展写在 `.pi/extensions/` 下
- [x] 扩展订阅 `session_start`
- [x] 扩展订阅 `session_compact`（压缩后；`session_before_compact` 是压缩前，PRD 1.1 版选错了方向）
- [x] 会话 id 调 `ctx.sessionManager.getSessionId()` 自取（不在事件参数里）
- [x] 上下文注入走 `before_agent_start`
- [x] 幂等

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：注入没生效→src/setup/pi.ts 用错了事件：pi 的上下文注入机制是 before_agent_start 返回 message 字段，不是在 session_start 里直接写。

- **system**：扩展装不上→pi 的扩展可放 .pi/extensions/ 或经 pi install 分发，确认 setup 选的是项目级路径。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F16
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T10:02:05Z seandong claimed
- 2026-09-26T10:49:43Z seandong check ac=1: `todopi setup pi` 装好（标题）
- 2026-09-26T10:49:43Z seandong check ac=2: pi 的会话开始时收到注入（标题）
- 2026-09-26T10:49:43Z seandong check ac=3: pi 压缩后收到注入（标题）
- 2026-09-26T10:49:44Z seandong check ac=4: 扩展写在 `.pi/extensions/` 下
- 2026-09-26T10:49:44Z seandong check ac=5: 扩展订阅 `session_start`
- 2026-09-26T10:49:44Z seandong check ac=6: 扩展订阅 `session_compact`（压缩后；`session_before_compact` 是压缩前，PRD 1.1 版选错了方向）
- 2026-09-26T10:49:44Z seandong check ac=7: 会话 id 调 `ctx.sessionManager.getSessionId()` 自取（不在事件参数里）
- 2026-09-26T10:49:44Z seandong check ac=8: 上下文注入走 `before_agent_start`
- 2026-09-26T10:49:44Z seandong check ac=9: 幂等
- 2026-09-26T10:49:45Z seandong note: 勾选依据：会话开始与压缩后的注入在真实 pi 0.84.0 运行时里验证（测试专用的 echo provider 回显系统提示；/compact 后以同一会话 id 重新 prime，新标记出现在下一轮系统提示里；评审也用 RPC compact 复现），真模型未测——本机 pi 无凭据（D037）。其余由单元用例与 e2e 覆盖。
