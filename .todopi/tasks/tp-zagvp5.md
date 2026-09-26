---
id: "tp-zagvp5"
title: "Cursor 接入：CLI 与 IDE 实机验证"
status: "open"
rank: "im"
verify: "make check && bash tools/e2e/f17-setup-cursor-gemini.sh"
labels: ["m3"]
created: "2026-09-26T11:44:21Z"
updated: "2026-09-26T11:44:21Z"
---

## Description

从 tp-yuka3e（setup cursor / gemini）拆出（按 tp-1ssqrw 的先例）。F17 时 cursor-agent 的无头模式报 Authentication required、交互式要求浏览器登录，Cursor 没能实测；IDE 形态本来就要人手工验证（FR-A2b）。机制见 D038：sessionStart 的 additional_context 注入；压缩后没有钩子可用，靠 alwaysApply 规则文件 .cursor/rules/todopi.mdc。

## Acceptance Criteria

- [ ] Cursor 在没有压缩后事件的情况下，账本指针活过压缩（原 tp-yuka3e #3）：压缩/摘要之后，模型仍能说出指针（todopi prime）与「察觉到被压缩就跑 todopi prime」
- [ ] Cursor 在 CLI 形态下手工验证一次（原 tp-yuka3e #10）：sessionStart 注入进上下文、规则文件生效、sessionEnd 触发
- [ ] Cursor 在 IDE 形态下手工验证一次（原 tp-yuka3e #11）
- [ ] 用户级钩子（setup cursor --user）在项目里按 workspace_roots 找到账本
- [ ] 实测结果与 Cursor 版本写进 PRD §17

## Log

- 2026-09-26T11:44:21Z seandong created from=tp-yuka3e
