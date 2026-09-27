---
id: "tp-h2mxiu"
title: "agent 环境推断身份（FR-C4）：同一台机器上的 Claude Code、Codex 等各自有 actor"
status: "in_progress"
assignee: "seandong"
rank: "in"
verify: "make check && make test && bash tools/e2e/f22-actor-env.sh"
labels: ["m4"]
created: "2026-09-27T03:14:02Z"
updated: "2026-09-27T03:19:18Z"
---

## Description

审计发现：FR-C4 的第三级「agent 环境推断（claude-code@<host>、codex@<host> 等）」没实现，六份 setup 生成的钩子也没带 --as，同一台机器上所有 agent 与人都是同一个 git 用户名——写入时的归属检查分不开两个 agent，MVP 验收第 1 条有风险。

## Acceptance Criteria

- [ ] 每家 agent 在自己的环境里跑 todopi 时，actor 解析为 <agent>@<host>（环境变量信号按各家一手资料核实）
- [ ] 优先级：--as > TODOPI_ACTOR > agent 环境推断 > git config user.name
- [ ] 钩子里调用的 prime / handoff 与 agent 自己跑的 claim / done 得到同一个 actor
- [ ] 人在普通终端里仍是 git 用户名
- [ ] 六家的推断各有用例

## Log

- 2026-09-27T03:14:02Z seandong created
- 2026-09-27T03:19:18Z seandong claimed
