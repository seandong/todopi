---
id: "tp-8evtlp"
title: "todopi claim / release 改变任务归属，过期租约的任务可被直接重新认领并留痕"
status: "closed"
resolution: "done"
blocked_by: ["tp-oqgjt3"]
rank: "i4"
verify: "make check && make test && bash tools/e2e/f05-claim.sh"
labels: ["bootstrap", "m1"]
external:
  harness:
    legacy_id: "F05"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi claim / release 改变任务归属，过期租约的任务可被直接重新认领并留痕

迁移自 `feature_list.json` 的 **F05**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

claim 写入 status: in_progress 与 assignee，并在 <git-common-dir>/todopi/leases/ 原子创建租约；release 清空 assignee 并删除租约；ready 队列给出的过期任务可直接 claim 无需 --steal（FR-C1），未过期的租约拒绝并退出 3，--steal 覆盖；两种情况替换他人 assignee 都记 steal=true 并写明被替换者；actor 解析链按 FR-C4，取自 git config 的值经 §5.4 规范化（含空格的值必须被处理）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：重新认领用例失败→src/commands/claim.ts 没有区分「租约过期」与「租约存在且未过期」两条路径；actor 含空格→src/domain/actor.ts 的 normalize 未实现；worktree 场景→src/fs/gitdir.ts 应使用 git rev-parse --git-common-dir 而非 --git-dir。

- **system**：租约没写到预期位置→确认 --git-common-dir 的取值；裸仓库场景按 PRD §15 明确不支持，应报错而不是写进裸仓库内部。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F05
- 2026-09-23T09:40:27Z harness@migration done verify=pass commit=73d17ef: commit 73d17ef, verified 2026-09-22T08:56:33Z
