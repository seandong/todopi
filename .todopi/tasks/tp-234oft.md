---
id: "tp-234oft"
title: "npm i -g todopi 与 curl 安装器在干净环境里都能装上并跑通第一条命令"
status: "open"
blocked_by: ["tp-0ca49n", "tp-66vnyl"]
rank: "ik"
verify: "make check && make test && bash tools/e2e/f21-install.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F21"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

npm i -g todopi 与 curl 安装器在干净环境里都能装上并跑通第一条命令

迁移自 `feature_list.json` 的 **F21**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

npm 包是纯 JS、跑在 Node ≥ 20、依赖只有三个且都零传递依赖、不 bundle（D006 决策 10）；curl 安装器先探测 Node ≥ 20：有则装 npm 包，无则下载二进制；安装器含 SHA-256 校验（不通过拒绝安装）、解压前拒绝绝对路径与 ..、装到 ~/.local/bin 并在不在 PATH 时提示、支持环境变量钉版本（D008 决策 3）；CI 在「有 Node」与「无 Node」两种容器里各跑一次。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：依赖超出白名单→package.json 的 dependencies 只能是 yaml / commander / fractional-indexing。

- **system**：无 Node 的容器里失败→安装器的平台探测或校验和步骤；失败必须是明确报错而不是装出一个坏的二进制。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F21
