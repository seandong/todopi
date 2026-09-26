---
id: "tp-medxth"
title: "todopi import <plan.md> 把 Markdown checkbox 计划转成带 id 的任务"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-wj9u76"]
rank: "ii"
verify: "make check && make test && bash tools/e2e/f19-import-md.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F19"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T13:22:11Z"
---

## Description

todopi import <plan.md> 把 Markdown checkbox 计划转成带 id 的任务

迁移自 `feature_list.json` 的 **F19**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi import <plan.md>` 把 Markdown checkbox 计划转成带 id 的任务（标题）
- [x] 标题层级映射为 parent
- [x] 文档顺序映射为 rank
- [x] 已勾选项建成 closed/done
- [x] 已勾选项建成的任务带 forced=true
- [x] 每个任务记 `created source=<path>`
- [x] 按 (source, title) 幂等：重复导入不产生重复任务
- [x] 已存在任务的 rank 保留，不重算
- [x] 纯解析
- [x] 不联网（ARCH-001）

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：幂等失败→src/import/markdown.ts 应在创建前按 (source, title) 查已有任务；rank 被重算→同文件，已存在的任务跳过 rank 分配。

- **system**：导入后 doctor 非 0→多半是 parent 指向了一个尚未创建的任务，应按文档顺序先建父后建子。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F19
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T12:40:05Z seandong claimed
- 2026-09-26T13:21:20Z seandong note: 验收依据：tests/commands/import.test.ts（解析：层级、嵌套、代码块与列表项里的标题不算、纯文本、分隔线；映射：空标题剪掉且不占序号、同名序号、前序、closed 规则、200 字符边界；导入：parent、rank=文档顺序、closed/done forced=true 与 Log、created source、doctor 通过；幂等：重复导入一个字节不变、move 过的 rank 保留、新条目挂对父级排最后；来源编码；spec-kit / OpenSpec 样例；变异全部杀死）+ tools/e2e/f19-import-md.sh（CLI、--json、幂等、两个进程同时导入只建一份——去掉锁时 28 变 49）。#9 纯解析：只读这一个文件、CommonMark 解析；#10 不联网：没有网络调用，ARCH-001 通过。Codex 评审：身份键与标题里的 #n 撞、..notes.md 被当成项目外 → 修 → Go。
- 2026-09-26T13:21:20Z seandong check ac=1: `todopi import <plan.md>` 把 Markdown checkbox 计划转成带 id 的任务（标题）
- 2026-09-26T13:21:20Z seandong check ac=2: 标题层级映射为 parent
- 2026-09-26T13:21:21Z seandong check ac=3: 文档顺序映射为 rank
- 2026-09-26T13:21:21Z seandong check ac=4: 已勾选项建成 closed/done
- 2026-09-26T13:21:21Z seandong check ac=5: 已勾选项建成的任务带 forced=true
- 2026-09-26T13:21:21Z seandong check ac=6: 每个任务记 `created source=<path>`
- 2026-09-26T13:21:21Z seandong check ac=7: 按 (source, title) 幂等：重复导入不产生重复任务
- 2026-09-26T13:21:21Z seandong check ac=8: 已存在任务的 rank 保留，不重算
- 2026-09-26T13:21:22Z seandong check ac=9: 纯解析
- 2026-09-26T13:21:22Z seandong check ac=10: 不联网（ARCH-001）
- 2026-09-26T13:22:11Z seandong done verify=pass commit=a2b79fb dirty=true
