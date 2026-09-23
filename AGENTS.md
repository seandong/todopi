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
4. `todopi ls --ready` 看队列，选**恰好一个**，`todopi claim <id>`。
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
- **用户可见文案 English-first。** CLI 输出、`README.md`、`spec/`、协议文本、官网
  MUST 先写英文。仓库内的设计文档（PRD、brainstorm、DECISIONS、本 harness 文档）
  用中文。source: brainstorm 决策 #8；why: 英文是分发语言，中文是思考语言，
  把两者混同会让其中一种长期失真。
- **格式语料库是契约。** `spec/fixtures/` 里既有 fixture 的**期望值**变更等同于
  修改格式语义，MUST 与 `spec/todopi-format-v1.md` 同步并走同一套版本流程；
  新增 fixture 不受此限。source: `spec/fixtures/README.md`；why: 第三方的 CI
  会跑这份语料，改期望值就是在改他们的通过标准。
- **生成物不入库。** `.harness-results/`、构建产物、本地缓存遵循 `.gitignore`。

### Tools 与权限

harness 只依赖 POSIX shell、`git`、`make`、`jq`。MCP server 和其他 tool 不是 harness
的一部分。引入任何新的外部依赖或 capability 前，先在 DECISIONS.md 记录理由——
依赖是最难回退的决策之一。详见 [工程规则](docs/harness/engineering-rules.md)。

## Scope 规则

- **WIP=1**：任意时刻只允许一个任务处于 `in_progress`。
- **粒度：one session per task。** 完不成就拆，不要跨 session 挂着 `in_progress`。
- **先 claim 再干活。** todopi 允许 `open → done`（不必先认领），但那样没有租约、
  没有 `claimed` 记录，别人看不出你在做它。
- **完成的判据不由 agent 说了算**：`todopi done` 跑任务的 `verify`，不通过就关不掉。
- 上面三条由 **ARCH-023** 持续检查（WIP=1、开工任务的前置必须 `closed`+`done`、
  每个任务都有 `verify`）。它是**事后发现**，不是当场拒绝——2026-09-23 自举时从
  `make activate` 降级而来，理由与全部损失见
  [迁移计划](docs/plans/2026-09-23-bootstrap.md)。
- 详见 [Scope 契约](docs/harness/scope.md)、
  [状态迁移](docs/harness/state-migration.md)。

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

## 提交的顺序，以及协议段的那个例外

本文件末尾由 `todopi init` 追加的协议段写着「把 `.todopi/` 的改动放进它所描述的那次
工作的同一个 commit」。**`done` 是这句话的例外**，而且必须是：

```
todopi claim <id>                    ← 它会改任务文件，那处改动跟着工作走
干活
人核对 Acceptance Criteria           ← 散文判据，机器不查
git commit                           ← 代码 **加上** claim 留下的账本改动
todopi done <id>                     ← verify 跑在刚提交的那棵树上，dirty=false
git commit                           ← done 的账本改动 + PROGRESS
make clean-check                     ← 必须在两次提交都完成之后
```

`done` 的 Log 记 `commit=<HEAD7> dirty=<bool>`。把它放在提交之前，验证跑的是未提交
的树、`dirty=true`，那条证据就指不实任何东西。所以 `done` 只能在后，它的账本改动也
就只能落进第二次提交。

**第一次提交必须带上 `claim` 的账本改动**，否则工作区在 `done` 时仍是脏的，
`dirty=true`——评审实测过这条。这恰好就是协议段那句话的正常形态：`claim` 跟着工作
走同一个 commit。

`add` / `note` / `claim` 不受这个例外影响——它们跟着工作走同一个 commit。

## 完成工作（clock-out）

1. **人对着任务正文的「Acceptance Criteria」段逐条核对。** 那一段是散文不是勾选项
   （勾选要 `check`，F09 尚未实现），所以 `todopi done` 通过**不等于**这些判据已被
   机器核对过。
2. `git commit` —— 代码**加上** `claim` 留下的账本改动。漏掉后者，下一步就会
   `dirty=true`。**一个 commit 一个完整逻辑改动**（atomic）；每次 commit 后仓库都
   MUST 处于一致状态，不提交半成品。commit message 解释 **why**, not just what。
   文档与代码在 same commit 内一起更新。
3. `todopi done <id>` —— 它跑任务的 `verify`，并把 `commit=<HEAD7> dirty=<bool>`
   记进 Log。放在提交之后，那条证据才指得实。
4. 更新 `PROGRESS.md`：Current State（commit + check 结果）、Next Steps、Blockers。
5. `git commit` —— `done` 的账本改动 + PROGRESS。
6. `make clean-check` —— 五维清洁态：基线绿、无 debug artifact、状态文件已更新、
   startup 路径可用、diff 聚焦。**必须在两次提交都完成之后**：它的
   state-updated 一维要求工作区有改动时 PROGRESS 已同步，工作区还脏就会红。

**context 快用完时，do not rush to finish。** 停下来、更新 PROGRESS.md、提交一个
干净的 checkpoint，把没做完的部分如实写进 Next Steps。赶在 context 耗尽前宣布完成，
是这个 harness 要防的头号故障。

## 周期性维护

除每个 session 结束的即时清理外，每完成一个 milestone 做一次 periodic 全量清扫：
重跑 `make check-arch`、核对 `.todopi/` 与真实代码是否漂移、清掉过期文档。

<!-- todopi:protocol:begin -->

## todopi

This repository keeps its durable task ledger in `.todopi/`. It outlives your context
window: tasks created in one session are found, with their history, by the next one —
after a compaction, on another machine, or under a different agent.

`.todopi/` is data. Never edit those files by hand; use the CLI.

**Granularity.** One todopi task is roughly one change worth a commit, with an outcome
somebody could check. Editing a file or running a test is a step, not a task. Keep using
your own todo list for the steps inside this turn, and never copy todopi tasks into it.

> **本仓库的现状（2026-09-23 自举）**：下面这张表里，`prime`、`note`、`handoff`
> 分别属于 F11、F09、F12，**都还没实现**；`add --from` 的 `--from` 也要等 F10。
> 现在真能跑的只有 `ls` / `claim` / `release` / `done` / `close` / `reopen` /
> `doctor` / `init` / `add`。照表里敲那几条会得到「命令不存在」。
>
> 当前可执行的路径在本文件上方的 clock-in / clock-out 两节，以及
> 「提交的顺序」那一节。表格随各自的 feature 落地逐条变真。

**Do these without deliberating:**

| When | Run |
|---|---|
| Starting work | Read the `prime` output you were given, or `todopi prime` |
| Before touching code | `todopi claim <id>` |
| You discover new work | `todopi add "<title>" --from <current id>` |
| You learned something the hard way | `todopi note <id> "<what and why>"` |
| The work is finished | `todopi done <id>` |
| Ending the session | `todopi handoff` |
| You notice your context was compacted | `todopi prime` — do not wait for a hook |

`todopi done` runs the task's verification command. If it fails, fix the work. Forcing past
it is for the case where the check itself is wrong, and it is recorded permanently.

**Queries.** `todopi ls --ready` for what to pick up next. `todopi show <id>` for one task's
detail. `todopi prime --full` when you need the whole picture. Add `--json` when parsing.

**Commits.** Include the `.todopi/` changes in the same commit as the work they describe,
and mention the task id in the message.

<!-- todopi:protocol:end -->
