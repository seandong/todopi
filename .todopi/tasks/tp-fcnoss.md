---
id: "tp-fcnoss"
title: "交接时明确呈现代码已改但验证待跑"
status: "open"
rank: "j0j"
verify: "make check && make test && make e2e"
created: "2026-10-09T07:17:02Z"
updated: "2026-10-09T07:17:02Z"
---

## Description

来自公开推文的实际使用反馈：新会话容易把代码已改误当任务完成。当前 prime/handoff 不自动识别该阶段；先核对阶段信息能从何处可靠取得，再让交接明确区分待验证与有证据的已验证完成。不得凭文件变化或勾选推断检查已通过；无需更改现有磁盘格式时优先复用任务日志。

## Acceptance Criteria

- [ ] 在任务仍进行、代码已改但未跑验证时，明确记录待验证信息并让新会话的常规接手入口看见具体下一步；没有信息时不猜测代码已完成
- [ ] 配置 verify 的任务只有实际通过后才能显示通过证据；失败、未运行、没有 verify、强制关闭四种情形不冒充验证通过
- [ ] 覆盖跨会话 prime/handoff 的运行时用例并更新用户文档，保持现有磁盘格式兼容

## Log

- 2026-10-09T07:17:02Z claude-code@Seans-MacBook-Pro.local created
