---
id: "tp-66vnyl"
title: "todopi import beads 迁移 Beads Classic 导出"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-medxth"]
rank: "ij"
verify: "make check && make test && bash tools/e2e/f20-import-beads.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F20"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T14:21:03Z"
---

## Description

todopi import beads 迁移 Beads Classic 导出

迁移自 `feature_list.json` 的 **F20**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [ ] `todopi import beads` 迁移 Beads Classic 导出（标题）
- [ ] 读 `issues.jsonl`（默认 `.beads/issues.jsonl`）
- [ ] priority 映射为 rank 顺序
- [ ] type 映射为 label
- [ ] blocks 映射为 blocked_by
- [ ] parent-child 映射为 parent
- [ ] closed 映射为 closed
- [ ] closed 映射时带上 resolution
- [ ] Beads 的理由指明时 resolution 用 wontfix
- [ ] 原 id 存入 `external.beads.id`
- [ ] 导入结果通过 doctor

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
