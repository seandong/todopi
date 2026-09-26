---
id: "tp-0ca49n"
title: "todopi web 在 127.0.0.1 提供只读看板，文件变化时页面自动更新"
status: "closed"
resolution: "done"
assignee: "seandong"
blocked_by: ["tp-wj9u76"]
rank: "ih"
verify: "make check && make test && bash tools/e2e/f18-web.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F18"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-26T12:37:18Z"
---

## Description

todopi web 在 127.0.0.1 提供只读看板，文件变化时页面自动更新

迁移自 `feature_list.json` 的 **F18**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] `todopi web` 在 127.0.0.1 提供只读看板（标题）
- [x] 文件变化时页面自动更新（标题）
- [x] 视图：按显示状态分列
- [x] 视图：按容器的树
- [x] 视图：ready 队列
- [x] 任务抽屉显示验收标准
- [x] 任务抽屉显示 Log
- [x] 任务抽屉显示验证证据
- [x] v0.1 只读，没有任何写入入口（FR-B3）
- [x] 只绑定回环地址
- [x] 前台进程
- [x] 随终端退出（终端结束后不残留进程）
- [x] 文件变化经 SSE 推送
- [x] `fs.watch` 不可用时退化为轮询（WSL2 与容器挂载卷在目标环境内）
- [x] 端口被占用时报错退出
- [x] 端口被占用时的报错提示 `--port`
- [x] 端口被占用时不自动换端口
- [x] 页面资源全部内联，不从 CDN 拉取（ARCH-001）

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：绑定地址不对→src/board/server.ts 的 listen 必须显式传 127.0.0.1；若 ARCH-002 报违规，确认常驻循环只出现在 src/board/ 下。

- **system**：轮询退化没走通→src/board/watch.ts 应在 fs.watch 抛错或不可用时切换，而不是直接失败。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F18
- 2026-09-26T06:21:53Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，不增不减；任务标题本身是验收结果的，另列一条并标「标题」。原文见 git 历史。
- 2026-09-26T12:07:20Z seandong claimed
- 2026-09-26T12:36:07Z seandong note: 验收依据：tests/commands/board.test.ts（列、板数据与 show --full / ls 一致、只读、--port、页面静态检查、Host / 405 / 404 / CSP、SSE 首推 / 变化推送 / 去重 / 新客户端、轮询、failure 事件、端口占用、监听出错与目录重建改为轮询；变异全部杀死）+ tools/e2e/f18-web.sh（真进程：页面无外链、POST 405、伪造 Host 403、lsof 只监听 127.0.0.1、SSE 推送、端口占用退出 1 并提示 --port、非法端口、没有账本、--poll、SIGHUP 后进程与端口都没了）。浏览器里看过本仓库账本的看板与抽屉。#14 的 WSL 分支按内核版本串判断，本机没有 WSL，未实跑。Codex 评审三轮：watch 出错静默、ARCH-002 可被同行字面量与表达式骗过 → 修 → Go。顺带修好 ARCH-002 / ARCH-014 一直空转的注释过滤（D039）。
- 2026-09-26T12:36:07Z seandong check ac=1: `todopi web` 在 127.0.0.1 提供只读看板（标题）
- 2026-09-26T12:36:07Z seandong check ac=2: 文件变化时页面自动更新（标题）
- 2026-09-26T12:36:08Z seandong check ac=3: 视图：按显示状态分列
- 2026-09-26T12:36:08Z seandong check ac=4: 视图：按容器的树
- 2026-09-26T12:36:08Z seandong check ac=5: 视图：ready 队列
- 2026-09-26T12:36:09Z seandong check ac=6: 任务抽屉显示验收标准
- 2026-09-26T12:36:09Z seandong check ac=7: 任务抽屉显示 Log
- 2026-09-26T12:36:09Z seandong check ac=8: 任务抽屉显示验证证据
- 2026-09-26T12:36:10Z seandong check ac=9: v0.1 只读，没有任何写入入口（FR-B3）
- 2026-09-26T12:36:11Z seandong check ac=10: 只绑定回环地址
- 2026-09-26T12:36:11Z seandong check ac=11: 前台进程
- 2026-09-26T12:36:11Z seandong check ac=12: 随终端退出（终端结束后不残留进程）
- 2026-09-26T12:36:12Z seandong check ac=13: 文件变化经 SSE 推送
- 2026-09-26T12:36:12Z seandong check ac=14: `fs.watch` 不可用时退化为轮询（WSL2 与容器挂载卷在目标环境内）
- 2026-09-26T12:36:13Z seandong check ac=15: 端口被占用时报错退出
- 2026-09-26T12:36:14Z seandong check ac=16: 端口被占用时的报错提示 `--port`
- 2026-09-26T12:36:14Z seandong check ac=17: 端口被占用时不自动换端口
- 2026-09-26T12:36:15Z seandong check ac=18: 页面资源全部内联，不从 CDN 拉取（ARCH-001）
- 2026-09-26T12:37:18Z seandong done verify=pass commit=b0a7e6c dirty=true
