---
id: "tp-1ssqrw"
title: "OpenCode 压缩后注入：真机实测"
status: "open"
rank: "il"
verify: "make check && bash tools/e2e/f15-setup-codex-opencode.sh"
created: "2026-09-26T08:46:43Z"
updated: "2026-09-26T10:08:57Z"
---

## Description

从 tp-thtkze（setup codex / opencode）拆出（用户 2026-09-26 定）。F15 实测时，本机能用的 OpenCode 模型只有免费的 big-pickle，它不能用于压缩；relay_ones 与 Google 的凭据不可用。机制与已实测的会话开始注入同一条路径（session.compacted 刷新缓存 → experimental.chat.system.transform 进系统提示），风险在 experimental 接口本身。需要一个能用于压缩的 OpenCode 模型凭据。

## Acceptance Criteria

- [ ] 用 todopi setup opencode 生成的插件，在支持压缩的真实 OpenCode 会话里：压缩前往任务记一个新标记，压缩后模型能原样引出它
- [ ] 记录 session.compacted 触发、prime 被调用、下一次 system.transform 推入新输出
- [ ] 实测结果与 OpenCode 版本写进 PRD §17

## Log

- 2026-09-26T08:46:43Z seandong created from=tp-thtkze
- 2026-09-26T10:08:57Z seandong note: 可能的无凭据验证办法（F16 在 pi 上用过，D037）：测试专用的插件注册一个 echo provider，把系统提示原样回答，在真实 OpenCode 运行时里验证压缩后的注入。OpenCode 是否支持插件注册自定义 provider、免费档限制是否也管到自定义 provider，需要先核实。
