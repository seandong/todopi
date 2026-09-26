---
id: "tp-wnrlpw"
title: "todopi setup claude 一条命令装好，全新克隆上 Claude Code 会话开始时收到 prime 输出"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-sch6q1"]
rank: "id"
verify: "make check && make test && bash tools/e2e/f14-setup-claude.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F14"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T07:53:03Z"
---

## Description

todopi setup claude 一条命令装好，全新克隆上 Claude Code 会话开始时收到 prime 输出

迁移自 `feature_list.json` 的 **F14**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] 全新克隆上跑一次 `todopi setup claude` 即装好（标题）
- [x] 装好之后，全新克隆上 Claude Code 会话开始时收到 prime 输出（标题）
- [x] 写入项目级 `.claude/settings.json` 的 SessionStart 钩子，调用 `prime`
- [x] 压缩后重新注入：项目级 `.claude/settings.json` 的 SessionStart 钩子覆盖 `compact` 来源，调用 `prime`（PostCompact 的输出不在文档列出的「stdout 进上下文」事件里，2026-09-26 重核）
- [x] 写入项目级 `.claude/settings.json` 的 SessionEnd 钩子，调用 `handoff --check`
- [x] 确保存在含 `@AGENTS.md` 导入的 CLAUDE.md（FR-Q5a：Claude Code 读 CLAUDE.md 而不读 AGENTS.md，只跑 init 的用户读不到协议）
- [x] 幂等：重复运行不产生第二份钩子
- [x] 打印写入的每个文件
- [x] `--user` 切到用户级

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：幂等失败→src/setup/claude.ts 合并 settings.json 时应按 matcher+command 去重，而不是无条件 push。

- **system**：钩子没触发→核对事件名与 matcher 拼写（PRD §17 记录了核实结果：matcher 有 startup/resume/clear/compact/fork 五个）。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F14
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T06:57:11Z seandong claimed
- 2026-09-26T07:09:06Z seandong note: 验收标准第 4 条按 2026-09-26 重核的外部事实改写：Claude Code 的 PostCompact 存在，但官方文档列出的「stdout 进上下文」事件不含它；压缩后注入改由 SessionStart 的 compact 来源承担（文档明确）。原文「写入 PostCompact 钩子调用 prime」。见 PRD §17。
- 2026-09-26T07:51:57Z seandong check ac=1: 全新克隆上跑一次 `todopi setup claude` 即装好（标题）
- 2026-09-26T07:51:57Z seandong check ac=2: 装好之后，全新克隆上 Claude Code 会话开始时收到 prime 输出（标题）
- 2026-09-26T07:51:57Z seandong check ac=3: 写入项目级 `.claude/settings.json` 的 SessionStart 钩子，调用 `prime`
- 2026-09-26T07:51:57Z seandong check ac=4: 压缩后重新注入：项目级 `.claude/settings.json` 的 SessionStart 钩子覆盖 `compact` 来源，调用 `prime`（
- 2026-09-26T07:51:58Z seandong check ac=5: 写入项目级 `.claude/settings.json` 的 SessionEnd 钩子，调用 `handoff --check`
- 2026-09-26T07:51:58Z seandong check ac=6: 确保存在含 `@AGENTS.md` 导入的 CLAUDE.md（FR-Q5a：Claude Code 读 CLAUDE.md 而不读 AGENTS.md，只跑
- 2026-09-26T07:51:58Z seandong check ac=7: 幂等：重复运行不产生第二份钩子
- 2026-09-26T07:51:58Z seandong check ac=8: 打印写入的每个文件
- 2026-09-26T07:51:58Z seandong check ac=9: `--user` 切到用户级
- 2026-09-26T07:53:03Z seandong done verify=pass commit=48747b1 dirty=false
