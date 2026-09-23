---
id: "tp-0ca49n"
title: "todopi web 在 127.0.0.1 提供只读看板，文件变化时页面自动更新"
status: "open"
blocked_by: ["tp-wj9u76"]
rank: "ih"
verify: "make check && make test && bash tools/e2e/f18-web.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F18"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-23T09:40:27Z"
---

## Description

todopi web 在 127.0.0.1 提供只读看板，文件变化时页面自动更新

迁移自 `feature_list.json` 的 **F18**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

**这一段是散文，不是勾选项。** 勾选要 `check`（F09，尚未实现），
写成 checkbox 就意味着每次关闭都得手改 markdown。代价是验收门禁对这条
任务不生效：`done` 通过**不等于**下面这些判据已被机器核对过，关闭前由人
对着它们逐条看。

三个视图（按显示状态分列、按容器的树、ready 队列）与任务抽屉（验收标准、Log、验证证据）；v0.1 只读，没有任何写入入口（FR-B3）；只绑定回环地址；前台进程，随终端退出；文件变化经 SSE 推送，fs.watch 不可用时退化为轮询（WSL2 与容器挂载卷在目标环境内）；端口被占用时报错退出并提示 --port，不自动换端口；页面资源全部内联，不从 CDN 拉取（ARCH-001）。

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：绑定地址不对→src/board/server.ts 的 listen 必须显式传 127.0.0.1；若 ARCH-002 报违规，确认常驻循环只出现在 src/board/ 下。

- **system**：轮询退化没走通→src/board/watch.ts 应在 fs.watch 抛错或不可用时切换，而不是直接失败。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F18
