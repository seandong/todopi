# AGENTS.md

This repository is the development project for todopi — a CLI that keeps a
dependency-aware task ledger as plain Markdown under `.todopi/`.

todopi（土豆皮）的产品定义已完成，代码尚未开始。技术栈：TypeScript + Bun 编译
单二进制，npm 包运行于 Node ≥ 20。本文件是 agent 的操作手册，只负责路由和不变量；
细节在 [harness 权威地图](docs/harness/index.md)。

## 开始工作（clock-in）

1. 读本文件和 [docs/harness/index.md](docs/harness/index.md)。
2. `make doctor` —— 只读环境诊断。不安装依赖、不下载、不写任何被跟踪文件。
3. 读 [PROGRESS.md](PROGRESS.md) 的 Current State，再跑 `make check` 确认基线是绿的。
   基线不绿时先修基线，不要在红色基线上叠加新工作。
4. 从 [feature_list.json](feature_list.json) 选**恰好一个** `not_started` 的 feature，
   `make activate F=<id>` 置为 active。
5. 有分歧或需要留下理由的决策，写进 [DECISIONS.md](DECISIONS.md)。

## 不可越过的边界

每条都标注来源。没有 source 的规则不是规则，可以质疑。

- **格式规格是 normative。** 修改 `spec/todopi-format-v1.md` 的 MUST / MUST NOT
  条款，MUST 同步 `version` 与迁移说明；已发布的 v1 语义 MUST NOT 静默变更。
  source: `spec/todopi-format-v1.md` §1；why: 第三方要能不依赖本 CLI 实现该格式。
- **12 字段上限。** frontmatter MUST NOT 新增字段，扩展一律走 `external` 映射。
  source: `spec/todopi-format-v1.md` §5.2；why: 格式小本身就是产品承诺。
- **v0.1 零网络。** 源码 MUST NOT 发起网络请求，MUST NOT 上报遥测。
  source: `README.md`「No resident process, no database, no API key, no telemetry, no network access」。
- **不自动执行 git 写操作。** CLI MUST NOT 自动 commit / push / 切分支。
  source: 同上「no automatic git」；why: 用户的仓库不是 agent 的暂存区。
- **不常驻。** MUST NOT 引入 daemon 或后台进程；board 之外不监听端口，board MUST
  只绑定 loopback。source: `docs/product/todopi-prd.md` Security 行。
- **verify 命令需要信任。** 首次在某仓库执行 verify，MUST 先取得确认并按仓库路径
  记录信任。source: PRD FR-D4。
- **文档 English-first。** 用户可见文案 MUST 先写英文；`todopi-prd.md` 变更 MUST 在
  same commit 同步 `todopi-prd.zh-CN.md`，不留 stale 文档。source: PRD Site 行。
- **生成物不入库。** `.harness-results/`、构建产物、本地缓存遵循 `.gitignore`。

### Tools 与权限

harness 只依赖 POSIX shell、`git`、`make`、`jq`。MCP server 和其他 tool 不是 harness
的一部分。引入任何新的外部依赖或 capability 前，先在 DECISIONS.md 记录理由——
依赖是最难回退的决策之一。详见 [工程规则](docs/harness/engineering-rules.md)。

## Scope 规则

- **WIP=1**：任意时刻只允许一个 feature 处于 `active`。
- **粒度：one session per feature。** 完不成就拆，不要跨 session 挂着 active。
- **状态机**：`not_started → active → passing`，不允许跳级。
- **MUST NOT 手工把 state 改成 passing。** 只能 `make verify-feature F=<id>`，由
  harness 在所有 layer 真的通过后写入 `state` 和 `evidence`。
- 详见 [Scope 契约](docs/harness/scope.md)。前向状态将来迁移到 `.todopi/` 自举，
  契约见 [状态迁移](docs/harness/state-migration.md)。

## Definition of Done

完成 = **运行时证据通过**。不是代码写完，也不是 agent 觉得没问题。

三层验证，逐层阻断，**Layer N 失败时 do not proceed 到 Layer N+1**：

| Layer | 内容 | 命令 |
|---|---|---|
| Layer 1 | 静态：文档一致性、规格自洽、架构规则、类型检查 | `make check` |
| Layer 2 | 运行时行为：单元与集成测试，真实副作用 | `make test` |
| Layer 3 | 系统确认：CLI 端到端 | `make e2e` |

Layer 3 在改动 cross-component 或跨领域边界时是 required，不是可选。

运行时信号：命令真的能 startup 且退出 0；文件写入等 side effect 正确且可复查；
没有遗留 debug artifact（`console.log`、临时文件、被注释掉的断言）。

某层当前不适用时 MUST 如实报 `not_applicable`，MUST NOT 报 `pass`。四个状态词
（`pass` / `fail` / `blocked` / `not_applicable`）的定义见
[验证契约](docs/harness/verification.md)。

## 架构边界

`.harness/arch-rules.json` 是架构约束的登记处，每条含 what / why / fix，
由 `make check-arch` 执行。**代码评审里发现的每一类新错误都要提升为 arch-rules
的一条规则**，否则同类问题一定会再犯。

## 完成工作（clock-out）

1. `make verify-feature F=<id>` —— 通过后 harness 才会写入 `passing` 与 evidence。
2. `make clean-check` —— 五维清洁态：基线绿、无 debug artifact、状态文件已更新、
   startup 路径可用、diff 聚焦。
3. 更新 `PROGRESS.md`：Current State（commit + check 结果）、Next Steps、Blockers。
4. 提交。**一个 commit 一个完整逻辑改动**（atomic）；每次 commit 后仓库都 MUST
   处于一致状态，不提交半成品。commit message 解释 **why**, not just what。
   文档与代码在 same commit 内一起更新。

**context 快用完时，do not rush to finish。** 停下来、更新 PROGRESS.md、提交一个
干净的 checkpoint，把没做完的部分如实写进 Next Steps。赶在 context 耗尽前宣布完成，
是这个 harness 要防的头号故障。

## 周期性维护

除每个 session 结束的即时清理外，每完成一个 milestone 做一次 periodic 全量清扫：
重跑 `make check-arch`、核对 feature_list 与真实代码是否漂移、清掉过期文档。
