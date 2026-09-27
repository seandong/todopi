---
id: "tp-n7r8ph"
title: "CLI 表面补齐：FR-Q4 别名、close --reason、--quiet 覆盖、done 被拒时提示 todopi check"
status: "closed"
resolution: "done"
assignee: "claude-code@Seans-MacBook-Pro.local"
rank: "ini"
verify: "make check && make test && bash tools/e2e/f23-cli-surface.sh"
labels: ["m4"]
created: "2026-09-27T03:14:16Z"
updated: "2026-09-27T04:16:49Z"
---

## Description

审计发现四处小缺口：list、new / create、log、block 四组别名缺失；close --reason 必须配 --force（§8 把两者列为独立参数）；--quiet 下 setup 的提示、import 的 Next、web 的 Ctrl+C 提示仍输出；done 因验收标准被拒时，报告叫人手改任务文件，与协议「Never edit those files by hand」矛盾。

## Acceptance Criteria

- [x] ls|list、add|new|create、note|log、dep|block 都可用且有用例
- [x] close 不带 --force 也能记 --reason（记进 closed 事件）
- [x] 带 --quiet 时 setup、import、web 只输出结果本身
- [x] done 因验收标准被拒时提示 todopi check <id> <n>，不再叫人改文件

## Log

- 2026-09-27T03:14:16Z seandong created
- 2026-09-27T03:14:25Z seandong moved
- 2026-09-27T04:04:04Z claude-code@Seans-MacBook-Pro.local claimed
- 2026-09-27T04:15:51Z claude-code@Seans-MacBook-Pro.local note: 验收依据：tools/e2e/f23-cli-surface.sh（别名 list / new / create / log / block 与帮助里的展示、close --reason 不配 --force 进 Log、done 被拒时每条一条 todopi check 且照着勾完能 done、setup / import / web 的 --quiet）、tests/commands/transition.test.ts（close 理由、done 仍只在强制时收、空理由拒绝）、tests/output/gate.test.ts（出路改为 check、不指向任务文件）；关键判断变异杀死，setup 的 quiet 由 e2e 咬住。Codex 两轮 → Go（补了 create 在帮助里的展示）。
- 2026-09-27T04:15:52Z claude-code@Seans-MacBook-Pro.local check ac=1: ls|list、add|new|create、note|log、dep|block 都可用且有用例
- 2026-09-27T04:15:52Z claude-code@Seans-MacBook-Pro.local check ac=2: close 不带 --force 也能记 --reason（记进 closed 事件）
- 2026-09-27T04:15:52Z claude-code@Seans-MacBook-Pro.local check ac=3: 带 --quiet 时 setup、import、web 只输出结果本身
- 2026-09-27T04:15:52Z claude-code@Seans-MacBook-Pro.local check ac=4: done 因验收标准被拒时提示 todopi check <id> <n>，不再叫人改文件
- 2026-09-27T04:16:49Z claude-code@Seans-MacBook-Pro.local done verify=pass commit=d4ddc8d dirty=true
