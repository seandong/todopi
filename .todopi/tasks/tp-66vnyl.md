---
id: "tp-66vnyl"
title: "todopi import beads 迁移 Beads Classic 导出"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-medxth"]
rank: "ij"
verify: "make check && make test && bash tools/e2e/f20-import-beads.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F20"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T15:00:38Z"
---

## Description

todopi import beads 迁移 Beads Classic 导出

迁移自 `feature_list.json` 的 **F20**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi import beads` 迁移 Beads Classic 导出（标题）
- [x] 读 `issues.jsonl`（默认 `.beads/issues.jsonl`）
- [x] priority 映射为 rank 顺序
- [x] type 映射为 label
- [x] blocks 映射为 blocked_by
- [x] parent-child 映射为 parent
- [x] closed 映射为 closed
- [x] closed 映射时带上 resolution
- [x] Beads 的理由指明时 resolution 用 wontfix
- [x] 原 id 存入 `external.beads.id`
- [x] 导入结果通过 doctor

范围之外：Dolt 时代的导出。

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：映射错误→src/import/beads.ts 的字段映射表，逐项对照 PRD FR-I2；external 丢失→写入路径必须保留 external 映射（spec §5.2 要求写入端保留不认识的条目）。

- **system**：环或孤儿引用→Beads 的 blocks 是反向关系，映射成 blocked_by 时方向不能反。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F20
- 2026-09-26T06:21:54Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T14:21:03Z seandong claimed
- 2026-09-26T14:59:44Z seandong note: 验收依据：tests/commands/import-beads.test.ts（21 个：resolution 开头判定与词边界、label 规范化、时间戳拒绝不存在的日期、跳过 tombstone / ephemeral / 已导入、parent / blocks / from 的建立顺序与去环、priority → rank、描述合并与缩进代码块、导入后每个字段、幂等与引用旧任务、预检、长依赖链；变异全部杀死）+ tools/e2e/f20-import-beads.sh（默认路径、给路径、doctor、幂等、并发导入只建一份、错误）。真实数据：Beads v0.47.1 自己的 .beads/issues.jsonl（2404 行）→ 1738 条、doctor 通过、68 条 from= 全保住、重复导入 0 新建（D041）。已关闭的不标 forced，出处在 imported 事件里（我按规格定，用户未表态，可推翻）。评审由 Claude 子代理做（Codex 额度见底，用户 2026-09-26 定）：四轮，from 被静默丢、半途失败、环的措辞、from 与 blocks 冲突时误丢 blocked_by、连带丢 from、长链爆栈 → 修 → Go。
- 2026-09-26T14:59:44Z seandong check ac=1: `todopi import beads` 迁移 Beads Classic 导出（标题）
- 2026-09-26T14:59:44Z seandong check ac=2: 读 `issues.jsonl`（默认 `.beads/issues.jsonl`）
- 2026-09-26T14:59:44Z seandong check ac=3: priority 映射为 rank 顺序
- 2026-09-26T14:59:44Z seandong check ac=4: type 映射为 label
- 2026-09-26T14:59:45Z seandong check ac=5: blocks 映射为 blocked_by
- 2026-09-26T14:59:45Z seandong check ac=6: parent-child 映射为 parent
- 2026-09-26T14:59:45Z seandong check ac=7: closed 映射为 closed
- 2026-09-26T14:59:45Z seandong check ac=8: closed 映射时带上 resolution
- 2026-09-26T14:59:45Z seandong check ac=9: Beads 的理由指明时 resolution 用 wontfix
- 2026-09-26T14:59:45Z seandong check ac=10: 原 id 存入 `external.beads.id`
- 2026-09-26T14:59:45Z seandong check ac=11: 导入结果通过 doctor
- 2026-09-26T15:00:38Z seandong done verify=pass commit=9cb14ac dirty=true
