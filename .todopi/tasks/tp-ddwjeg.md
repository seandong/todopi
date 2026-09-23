---
id: "tp-ddwjeg"
title: "todopi doctor 指着一个 .todopi/ 目录，逐条报出它违反了格式规格的哪条不变量，全部通过退出 0、有问题退出 1"
status: "closed"
resolution: "done"
rank: "i0"
verify: "make check && make test && bash tools/e2e/f01-doctor.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F01"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi doctor 指着一个 .todopi/ 目录，逐条报出它违反了格式规格的哪条不变量，全部通过退出 0、有问题退出 1

迁移自 `feature_list.json` 的 **F01**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

对 spec/fixtures/valid/ 的每个样例，解析结果与配套 .json 的 frontmatter 一致且 doctor 退出 0；对 spec/fixtures/invalid/ 的每个样例，doctor 退出 1 且输出点名该 .json 里 violates 字段所指的规则。同时落地 TypeScript 工具链（package.json、tsconfig.json、lockfile、src/ARCHITECTURE.md）——src/ 一旦存在而工具链缺失，check_typecheck 会报 blocked，基线就红了。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：解析用例失败→src/format/parse.ts 的规范形态扫描器或 yaml 回退分支；不变量用例失败→src/format/validate.ts 里对应编号的检查函数（编号见 spec §6.2）。

- **system**：退出码不对→src/cli.ts 的 doctor 分支没有把校验结果映射到 FR-Q2 的退出码（0 成功 / 1 校验错误）；输出不含规则名→src/output/dto/doctor.ts 的映射丢了 violates 字段。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F01
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=94df81a: commit 94df81a, verified 2026-09-21T10:26:44Z
