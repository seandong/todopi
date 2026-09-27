---
id: "tp-234oft"
title: "npm i -g todopi 与 curl 安装器在干净环境里都能装上并跑通第一条命令"
status: "in_progress"
assignee: "seandong"
blocked_by: ["tp-0ca49n", "tp-66vnyl"]
rank: "ik"
verify: "make check && make test && bash tools/e2e/f21-install.sh"
labels: ["bootstrap", "m3"]
external:
  harness:
    legacy_id: "F21"
created: "2026-09-23T09:40:27Z"
updated: "2026-09-27T00:33:44Z"
---

## Description

npm i -g todopi 与 curl 安装器在干净环境里都能装上并跑通第一条命令

迁移自 `feature_list.json` 的 **F21**。真实创建时间未知——
frontmatter 的 `created`/`updated` 是迁移时刻。

## Acceptance Criteria

- [x] 干净环境里 `npm i -g todopi` 能装上并跑通第一条命令（标题）
- [x] 干净环境里 curl 安装器能装上并跑通第一条命令（标题）
- [x] npm 包是纯 JS（D006 决策 10）
- [x] npm 包跑在 Node ≥ 20
- [x] npm 包不 bundle（D006 决策 10）
- [x] 运行时依赖限定在 ARCH-010 的白名单内（原文「只有三个且都零传递依赖」已被 D031 引入 commonmark 改变）
- [x] curl 安装器先探测 Node ≥ 20
- [x] 探测到 Node ≥ 20 时装 npm 包
- [x] 没有 Node ≥ 20 时下载二进制
- [x] 安装器做 SHA-256 校验
- [x] SHA-256 校验不通过时拒绝安装
- [x] 解压前拒绝绝对路径
- [x] 解压前拒绝含 `..` 的路径
- [x] 装到 `~/.local/bin`
- [x] `~/.local/bin` 不在 PATH 时提示
- [x] 支持环境变量钉版本（D008 决策 3）
- [ ] CI 在「有 Node」的容器里跑一次
- [ ] CI 在「无 Node」的容器里跑一次

（2026-09-26 由散文拆成勾选项，一条对应一项核对；原文见 git 历史。标「标题」的取自任务标题。）

## Repair

失败时对照这一段——旧 harness 会在失败层当场打印它，现在不会了
（迁移计划的损失表第十条）。

- **static**：看 make check 输出里哪一项是 fail。docs-links 失效链接→修 Markdown 里的相对路径；arch-rules→按该规则的 fix 字段处理；typecheck→tsc 的报错行已在输出里，改对应 .ts 文件。

- **runtime**：依赖超出白名单→package.json 的 dependencies 只能是 ARCH-010 白名单里的包（yaml / commander / fractional-indexing / commonmark，D031）。

- **system**：无 Node 的容器里失败→安装器的平台探测或校验和步骤；失败必须是明确报错而不是装出一个坏的二进制。

## Log

- 2026-09-23T09:40:27Z harness@migration created: migrated from feature_list.json F21
- 2026-09-26T06:21:54Z seandong note: 验收判据由散文拆成勾选项（用户 2026-09-26 定）：逐条对应原文，任务标题另列一条。唯一改动：原文「依赖只有三个且都零传递依赖」已被 D031（引入 commonmark，用户定）改变，改为「限定在 ARCH-010 的白名单内」——照抄会留下一条永远勾不上的标准。原文见 git 历史。
- 2026-09-26T15:04:53Z seandong claimed
- 2026-09-27T00:33:42Z seandong note: 验收依据（1–16）：tools/e2e/f21-install.sh 32 项（包的形状与依赖 engines、install.sh 的 npm 与二进制两条路、校验、归档条目、装到 ~/.local/bin、PATH 提示、钉版本、latest 解析、npm 失败退回、二进制跑不起来拒绝、noexec /tmp）；node:20.0.0-slim 干净容器 npm i -g 打出来的包并跑 init / add / ls / claim / done；整套 Layer-3 在 macOS arm64 单二进制与 Node 20.19 的 npm 安装上全过；docker 模拟 install.yml 两个任务（debian 无 Node 走二进制、node:20 走 npm）与 Alpine 拒绝。注意：#1 的「npm i -g todopi」装的是打出来的 tarball——包还没发布（发布与 npm 名字占位是维护者的动作）。评审由 Claude 子代理做（Codex 额度见底）：三轮，commander 的 engines、npm 路走不通的退回、二进制试跑、先发 npm 再建 Release、noexec /tmp、tp 改指、信号清理 → Go。17、18 等合并推送后远端 CI 真跑过再勾。
- 2026-09-27T00:33:42Z seandong check ac=1: 干净环境里 `npm i -g todopi` 能装上并跑通第一条命令（标题）
- 2026-09-27T00:33:42Z seandong check ac=2: 干净环境里 curl 安装器能装上并跑通第一条命令（标题）
- 2026-09-27T00:33:42Z seandong check ac=3: npm 包是纯 JS（D006 决策 10）
- 2026-09-27T00:33:42Z seandong check ac=4: npm 包跑在 Node ≥ 20
- 2026-09-27T00:33:42Z seandong check ac=5: npm 包不 bundle（D006 决策 10）
- 2026-09-27T00:33:43Z seandong check ac=6: 运行时依赖限定在 ARCH-010 的白名单内（原文「只有三个且都零传递依赖」已被 D031 引入 commonmark 改变）
- 2026-09-27T00:33:43Z seandong check ac=7: curl 安装器先探测 Node ≥ 20
- 2026-09-27T00:33:43Z seandong check ac=8: 探测到 Node ≥ 20 时装 npm 包
- 2026-09-27T00:33:43Z seandong check ac=9: 没有 Node ≥ 20 时下载二进制
- 2026-09-27T00:33:43Z seandong check ac=10: 安装器做 SHA-256 校验
- 2026-09-27T00:33:43Z seandong check ac=11: SHA-256 校验不通过时拒绝安装
- 2026-09-27T00:33:44Z seandong check ac=12: 解压前拒绝绝对路径
- 2026-09-27T00:33:44Z seandong check ac=13: 解压前拒绝含 `..` 的路径
- 2026-09-27T00:33:44Z seandong check ac=14: 装到 `~/.local/bin`
- 2026-09-27T00:33:44Z seandong check ac=15: `~/.local/bin` 不在 PATH 时提示
- 2026-09-27T00:33:44Z seandong check ac=16: 支持环境变量钉版本（D008 决策 3）
