---
id: "tp-g4fhpb"
title: "todopi init 在没有 .todopi/ 的仓库里生成它，重复运行不产生第二份内容"
status: "closed"
resolution: "done"
blocked_by: ["tp-ddwjeg"]
rank: "i1"
verify: "make check && make test && bash tools/e2e/f02-init.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F02"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi init 在没有 .todopi/ 的仓库里生成它，重复运行不产生第二份内容

迁移自 `feature_list.json` 的 **F02**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

init 后目录含 config.yml（version: 1）、tasks/、.gitignore（含 .cache/），doctor 退出 0；协议文本被追加进 AGENTS.md（不存在则创建）；再跑一次 init，AGENTS.md 里协议段落仍只有一份（FR-Q5 幂等）；config.yml 的 version 大于本实现支持的版本时，任何命令退出 4（FR-Q2）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：幂等用例失败→src/commands/init.ts 里追加 AGENTS.md 的逻辑没有先检测已有段落；版本用例失败→src/format/config.ts 没有在读取后比对 version 并抛出 exit 4。

- **system**：在空临时目录跑 init 后 doctor 不为 0→检查 config.yml 的字段顺序与默认值是否符合 spec §3。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F02
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=2090d4f: commit 2090d4f, verified 2026-09-21T10:26:57Z
