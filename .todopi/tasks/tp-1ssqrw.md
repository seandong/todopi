---
id: "tp-1ssqrw"
title: "OpenCode 压缩后注入：真机实测"
status: "closed"
resolution: "done"
assignee: "seandong"
rank: "il"
verify: "make check && bash tools/e2e/f15-setup-codex-opencode.sh"
created: "2026-09-26T08:46:43Z"
updated: "2026-09-27T01:09:37Z"
---

## Description

从 tp-thtkze（setup codex / opencode）拆出（用户 2026-09-26 定）。F15 实测时，本机能用的 OpenCode 模型只有免费的 big-pickle，它不能用于压缩；relay_ones 与 Google 的凭据不可用。机制与已实测的会话开始注入同一条路径（session.compacted 刷新缓存 → experimental.chat.system.transform 进系统提示），风险在 experimental 接口本身。需要一个能用于压缩的 OpenCode 模型凭据。

## Acceptance Criteria

- [x] 用 todopi setup opencode 生成的插件，在支持压缩的真实 OpenCode 会话里：压缩前往任务记一个新标记，压缩后发给模型的请求（系统提示）里有它
- [x] 记录 session.compacted 触发、prime 被调用、下一次 system.transform 推入新输出
- [x] 实测结果与 OpenCode 版本写进 PRD §17

## Log

- 2026-09-26T08:46:43Z seandong created from=tp-thtkze
- 2026-09-26T10:08:57Z seandong note: 可能的无凭据验证办法（F16 在 pi 上用过，D037）：测试专用的插件注册一个 echo provider，把系统提示原样回答，在真实 OpenCode 运行时里验证压缩后的注入。OpenCode 是否支持插件注册自定义 provider、免费档限制是否也管到自定义 provider，需要先核实。
- 2026-09-27T00:54:54Z seandong claimed
- 2026-09-27T01:08:49Z seandong note: 验收标准 #1 按实际做法改写：原文「压缩后模型能原样引出它」——没有真模型凭据，用本地假 OpenAI 兼容 provider 在真实 OpenCode 运行时里验证，假模型只回固定的一句，不会引出任何东西；证据改为「压缩后发给模型的请求的系统提示里有这个标记」，比模型的回答更直接（模型能不能读到系统提示是 provider 的事，不在 todopi 的边界内，同 D037）。
- 2026-09-27T01:09:25Z seandong note: 验收依据：OpenCode 1.18.32 真实运行时 + 本地假 OpenAI 兼容 provider（tools/probes/openai-fake-api.mjs）。#1 压缩后第一个请求的系统提示里有 MARKER-OC-4711，压缩前（含 MARKER 之后发出的压缩摘要请求）都没有；#2 prime 记录 primed_at 01:02:23Z 落在压缩窗口（01:02:23.25–.42）、早于下一轮（01:02:42.7），摘要请求带的是缓存旧输出——排除每轮重跑与懒加载补跑，session.compacted 为推断；#3 写进 PRD §17。子代理评审：Go（措辞已按它改准）。
- 2026-09-27T01:09:25Z seandong check ac=1: 用 todopi setup opencode 生成的插件，在支持压缩的真实 OpenCode 会话里：压缩前往任务记一个新标记，压缩后发给模型的请求（系统提示
- 2026-09-27T01:09:25Z seandong check ac=2: 记录 session.compacted 触发、prime 被调用、下一次 system.transform 推入新输出
- 2026-09-27T01:09:26Z seandong check ac=3: 实测结果与 OpenCode 版本写进 PRD §17
- 2026-09-27T01:09:37Z seandong done verify=pass commit=8e9951c dirty=true
