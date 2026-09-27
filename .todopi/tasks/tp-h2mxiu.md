---
id: "tp-h2mxiu"
title: "agent 环境推断身份（FR-C4）：同一台机器上的 Claude Code、Codex 等各自有 actor"
status: "closed"
resolution: "done"
assignee: "seandong"
rank: "in"
verify: "make check && make test && bash tools/e2e/f22-actor-env.sh"
labels: ["m4"]
created: "2026-09-27T03:14:02Z"
updated: "2026-09-27T03:55:43Z"
---

## Description

审计发现：FR-C4 的第三级「agent 环境推断（claude-code@<host>、codex@<host> 等）」没实现，六份 setup 生成的钩子也没带 --as，同一台机器上所有 agent 与人都是同一个 git 用户名——写入时的归属检查分不开两个 agent，MVP 验收第 1 条有风险。

## Acceptance Criteria

- [x] 每家 agent 在自己的环境里跑 todopi 时，actor 解析为 <agent>@<host>（环境变量信号按各家一手资料核实）
- [x] 优先级：--as > TODOPI_ACTOR > agent 环境推断 > git config user.name
- [x] 钩子里调用的 prime / handoff 与 agent 自己跑的 claim / done 得到同一个 actor
- [x] 人在普通终端里仍是 git 用户名
- [x] 六家的推断各有用例

## Log

- 2026-09-27T03:14:02Z seandong created
- 2026-09-27T03:19:18Z seandong claimed
- 2026-09-27T03:54:42Z seandong note: 验收依据：tests/domain/actor.test.ts、tests/commands/actor.test.ts（六家信号、取值不对不算、多个信号不推断、解析优先级、--agent / TODOPI_AGENT 校验、从真实入口走）、setup 的迁移用例（四种格式、就地改写、被改过的旧组提示、新版已在时旧命令提示）、tools/e2e/f22-actor-env.sh（六家、嵌套、覆盖顺序、拼错名字、--agent 不泄漏进 verify、setup 写出的钩子命令与 agent 在环境里 claim 是同一 actor——用严格匹配的 release 证明，去掉 --agent 时变红）；变异全部杀死。信号的一手证据见 D043。#1 的限定：不止一个信号（嵌套）时不推断，由 --agent / TODOPI_AGENT 说清楚（Codex 评审后改）。Codex 评审三轮 → Go。
- 2026-09-27T03:54:42Z seandong check ac=1: 每家 agent 在自己的环境里跑 todopi 时，actor 解析为 <agent>@<host>（环境变量信号按各家一手资料核实）
- 2026-09-27T03:54:42Z seandong check ac=2: 优先级：--as > TODOPI_ACTOR > agent 环境推断 > git config user.name
- 2026-09-27T03:54:42Z seandong check ac=3: 钩子里调用的 prime / handoff 与 agent 自己跑的 claim / done 得到同一个 actor
- 2026-09-27T03:54:43Z seandong check ac=4: 人在普通终端里仍是 git 用户名
- 2026-09-27T03:54:43Z seandong check ac=5: 六家的推断各有用例
- 2026-09-27T03:55:43Z seandong done verify=pass commit=a2cdb54 dirty=true
