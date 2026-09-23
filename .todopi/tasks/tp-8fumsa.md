---
id: "tp-8fumsa"
title: "todopi add \"标题\" 生成一个任务文件，它通过 doctor，且并发运行不会互相覆盖"
status: "closed"
resolution: "done"
blocked_by: ["tp-g4fhpb"]
rank: "i2"
verify: "make check && make test && bash tools/e2e/f03-add.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F03"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi add "标题" 生成一个任务文件，它通过 doctor，且并发运行不会互相覆盖

迁移自 `feature_list.json` 的 **F03**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

生成的文件 frontmatter 按 spec §5.2 顺序、每个标量加双引号、rank 在创建时分配（FR-T1）；标题含冒号、# 号、纯数字、前导零时 round-trip 无损（spec/fixtures/valid 里那批对抗样例的写入方向）；20 个并发 add 产出 20 个不同 id、无文件损坏、无丢失——这是 D006 决策 5 明确列出的真实成本。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：round-trip 失败→src/format/emit.ts 的引号与转义（\\ 与 \" 两种）；并发用例失败→src/fs/lock.ts 的 O_EXCL 获取、pid+host 判活或退出清理；id 碰撞→src/format/id.ts 没有在写入前检查 tasks/ 下同名文件。

- **system**：add 后 doctor 不为 0→说明发射器写出的形状与 F01 的解析器不一致，先看 spec §5.1 的引号规则哪一条没实现。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F03
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=aa21eb1: commit aa21eb1, verified 2026-09-21T12:57:50Z
