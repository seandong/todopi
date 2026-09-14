# todopi — 产品需求文档（中文版）

版本：1.0 草案 · 2026-09-14
配套文档：`spec/todopi-format-v1.md`（磁盘格式规格，英文）、`docs/product/todopi-prd.md`（英文 PRD，与本文同步）、`docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md`（调研与决策记录）

---

## 1. 摘要

todopi 是面向 AI coding agent 的持久任务账本。它是一个 CLI（`todopi`，别名 `tp`），把带依赖关系的任务图以纯 Markdown 文件保存在仓库内，让任何 coding agent（Claude Code、Codex CLI、OpenCode、pi、Cursor、Gemini CLI）在跨会话、跨上下文压缩、跨机器、跨 agent 的情况下都知道工作进展到哪，并且没有证据不能把任务标为完成。

首发定位：*Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.*

## 2. 问题

1. **agent 会忘。** 每家 agent 的内建 todo 都是会话级的，2026 年各家还在默认关闭它们（Claude Code 对新模型、Codex 的 `update_plan`、OpenCode V2、Gemini CLI）。上下文压缩会丢掉计划，agent 于是重做已完成的工作、重试失败过的方案、忘掉已经发现的约束。
2. **「完成」是自述的。** 模型给自己打分很宽松。循环里没有任何环节在打勾之前跑一遍验收检查。
3. **现有 tracker 要么重要么薄。** Beads 验证了正确的抽象（ready 队列、认领、prime、依赖图），然后把它们埋在数据库、守护进程和 100 多个子命令之下。极简克隆去掉了机器，也去掉了格式稳定性和跨 agent 接入。规格驱动工具产出的是没有 ID、没有图、没有「我在哪」视图的 checkbox 列表。

## 3. 目标与非目标

### 目标（v0.1）

- G1. 一个会话里创建的任务，下一个会话能连同历史一起找到——任何 agent、任何机器、任何一次压缩之后。
- G2. 任务在验证命令失败、验收标准未勾全、子任务未关闭时不能被关闭为 done，除非显式、留痕地强制。
- G3. 接入六家 agent 中任意一家只需一条命令；agent 在会话开始和压缩后自动收到任务上下文。
- G4. 一切都是 git 里的纯文件，在 PR 中人类可读，格式独立于 CLI 被规范化。
- G5. token 开销有上限：上下文注入有硬上限，列表输出简短，已关闭的工作被折叠。

### 非目标

- 运行或编排 agent；管理 worktree。
- 人类项目管理（迭代、估时、截止日期、报表）。
- 任何服务器、守护进程、数据库、网络调用、LLM 调用、遥测、自动 git 操作。
- 多 agent「工厂」规模（几十个并发 agent）与团队权限。
- 云同步、托管看板、MCP server、Linear/GitHub 同步——推迟到 v0.2 及以后。

## 4. 用户

| 画像 | 处境 | 需要 todopi 提供什么 |
|---|---|---|
| **独立开发者 + 1–3 个 agent**（主要） | 跨天做同一个项目，在 Claude Code 和 Codex 之间切换，跑会压缩的长任务 | 不用重新解释就能续做；信任「完成」；一眼看到进度 |
| **自主循环用户**（次要） | 跑 Ralph 式循环或 2–3 个并行 worktree | 可原子认领的 ready 队列；验证作为回压 |
| **人类审阅者** | 审 agent 的 PR | diff 里的任务文件：谁认领、验证了什么、哪条标准没过 |

## 5. 原则

1. 文件即数据库。`.todopi/` 提交进 git；不提交任何索引。
2. 无守护进程、无服务器、无数据库、无 API key、无 LLM 调用、无遥测、无自动 git。
3. CLI 是唯一写入者。它校验字段、持锁、原子写入。人可以编辑文件，`doctor` 兜底。
4. 对 agent 宽容：接受它们会猜的动词，坏输入不丢数据，`--json` 无处不在，退出码稳定。
5. 对 token 吝啬：`prime` 硬上限，默认输出短，关闭任务折叠。
6. 完成需要证据。
7. 格式先于功能：磁盘格式有版本号且公开；CLI 只是一个实现。
8. 补充而非替代：agent 保留一轮内的微计划；todopi 保存必须活过上下文窗口的东西。
9. 永不收集使用数据。

## 6. 产品面

| 面 | 说明 |
|---|---|
| CLI | `todopi` / `tp`；TypeScript，Bun 编译单二进制走 brew/curl；npm 包在 Node ≥ 20 上运行 |
| 数据 | 仓库根目录的 `.todopi/`；格式见 `spec/todopi-format-v1.md` |
| 看板 | `todopi web`：本地、只绑定 127.0.0.1、单页、无账号 |
| 接入 | `todopi setup <agent>`，支持 claude、codex、opencode、pi、cursor、gemini；每家同时发布到其市场/注册表 |
| 导入器 | `todopi import <plan.md>` 与 `todopi import beads` |
| 站点 | todopi.com：安装、文档、格式规格；英文为主，中文页为辅 |

## 7. 功能需求

每条需求有编号、陈述和验收口径。「任务」指符合格式规格的一个文件。

### 7.1 任务

- **FR-T1** `add` 创建任务：标题，可选描述、父任务、阻塞项、标签、验收标准、验证命令，以及 `--from <id>` 来源。*验收：* 文件存在、通过 `doctor`、Log 有 `created`。
- **FR-T2** `ls` 列出任务；过滤器 `--open`（默认）、`--closed`、`--ready`、`--blocked`、`--mine`、`--label`；`--json` 输出数组；`--limit N`。已关闭任务默认隐藏。stale 与未验证任务有标记。
- **FR-T3** `show <id>` 打印 frontmatter、带序号的验收标准、最近 5 条 Log 及总数；`--full`、`--tree`（父链与子任务及进度）、`--json`。
- **FR-T4** `edit <id>` 通过参数或 `--edit`（$EDITOR）修改标题、描述、verify、标签、父任务和正文分节。记录 `edited fields=…`。
- **FR-T5** `move <id> --top | --before <id> | --after <id>` 是改 `rank` 的唯一途径；只重写一个文件。
- **FR-T6** ID：`<前缀>-<6 位 base36>`，随机生成，本地碰撞检查。
- **FR-T7** 没有优先级字段、没有类型字段、没有删除命令。软删除是 `close --as stale`。

### 7.2 图

- **FR-G1** `dep add <id> --on <id>` / `dep rm` 维护 `blocked_by`；有环则拒绝（退出码 1）并打印环。
- **FR-G2** `ls --ready`（别名 `ready`）实现规格中的 ready 定义与排序；输出即 agent 应从中挑选的内容。
- **FR-G3** 容器（有子任务的任务）永不出现在 ready 中，并显示 `n/m` 子任务进度。

### 7.3 认领与租约

- **FR-C1** `claim <id> [--as <actor>]` 设置 `status: in_progress` 与 `assignee`，原子创建租约，记录 `claimed`。存在有效租约时拒绝（退出码 3）；`--steal` 覆盖并留痕。
- **FR-C2** `release <id>` 清空 assignee、删除租约、记录 `released`。
- **FR-C3** 持有者的每次写入都刷新租约心跳和 `updated`。
- **FR-C4** actor 解析：`--as` > `TODOPI_ACTOR` > agent 环境推断（`claude-code@<host>`、`codex@<host>` 等）> `git config user.name`。
- **FR-C5** 租约放在 `.git/todopi/leases/`（worktree 间共享）；无 git 时回退到 `.todopi/.cache/leases/`。

### 7.4 完成定义

- **FR-D1** `check <id> <n>` / `check <id> <n> --undo` 切换第 n 条验收标准并留痕。
- **FR-D2** `done <id>`：若设置了 `verify`，在仓库根以配置的超时执行并捕获输出；非零退出则拒绝（退出码 2）。任何验收标准未勾选或任何子任务未关闭也拒绝。成功则设为 `closed`/`done`，记录 `done verify=… commit=<HEAD7> dirty=<bool>`，删除租约。
- **FR-D3** `--force --reason <text>` 绕过任何门禁，记录 `forced=true` 与理由；此类任务在列表与看板中标记为「未验证」。
- **FR-D4** 在某仓库首次执行 `verify` 前要求确认，信任按仓库路径记入 `~/.config/todopi/trust`；`--yes` 或 `CI=true` 跳过提示。验证输出在 Log 中截断为最后 2 KB。
- **FR-D5** `close <id> --as wontfix|duplicate|stale [--reason]` 与 `reopen <id>` 按状态机执行。

### 7.5 日志

- **FR-L1** `note <id> <text>` 追加一行 Log；支持多行文本。
- **FR-L2** 所有状态变更都按规格语法追加一行 Log；从不改写之前的行。

### 7.6 上下文注入

- **FR-P1** `prime [--budget <tokens>]`（默认 1500）按以下优先级打印直到预算用尽：(1) 调用者正在进行的任务：标题、带状态的验收标准、最近 3 条 Log；(2) ready 队列前 5 条：id 与标题；(3) 计数：open / in progress / blocked / closed；(4) 最近关闭的 3 条标题；(5) 6 行协议提醒。token 按字符数 ÷ 4 估算。输出为 Markdown。它按 actor 记录调用时间供 FR-H1 使用。
- **FR-P2** `prime --json` 以结构化数据输出相同内容。

### 7.7 交接

- **FR-H1** `handoff` 打印：本 actor 最近一小时没有 Log 的进行中任务；本 actor 自上次 `prime` 以来创建的任务；然后向每个进行中任务追加一条带摘要的 `handoff` Log 并刷新心跳。它不释放认领。`--check` 只输出报告并以 0 退出（供钩子使用）。

### 7.8 Agent 接入

- **FR-A1** `setup <agent>` 幂等地安装该 agent 的 skill/规则文件与钩子。默认写项目级配置（克隆即用）；`--user` 写用户级。它打印写入的每个文件。
- **FR-A2** 钩子映射：Claude Code `SessionStart`（startup、resume、compact）→ `prime`；`SessionEnd` → `handoff --check`。Codex `SessionStart`、`PostCompact` → `prime`；`SessionEnd` → `handoff --check`。OpenCode 插件：`session.compacted` → `prime`。pi 扩展：`session_start`、`session_before_compact` → `prime`。Cursor 与 Gemini：规则文件加命令。
- **FR-A3** 所有 agent 收到同一份 ≤ 800 token 的说明文本（「协议」，§9）；各家打包只是包装。
- **FR-A4** 每个接入包首发即发布到对应市场/注册表：Claude Code plugin、Codex plugin、OpenCode plugin、pi package（npm）、Cursor 规则、Gemini 扩展。

### 7.9 本地看板

- **FR-B1** `web [--port 4747] [--open]` 只在 127.0.0.1 提供单页看板。
- **FR-B2** 视图：按显示状态分列（open、blocked、in progress、done、closed）、按容器的树、ready 队列；任务抽屉显示验收标准、Log、验证证据。
- **FR-B3** 写操作仅限：跨列拖拽（claim/release/done/close）、切换验收标准、加 note、拖拽排序（move）。所有写入走与 CLI 相同的校验与加锁路径；门禁同样生效，UI 提供必须填理由的强制对话框。
- **FR-B4** 文件变化时页面刷新（目录监听 + SSE）。

### 7.10 导入器

- **FR-I1** `import <file.md>`：解析 Markdown checkbox 列表（Superpowers 计划、spec-kit `tasks.md`、OpenSpec `tasks.md`）。标题变容器，条目变子任务，文档顺序变 `rank`，已勾选条目以 `closed/done` 且 `forced=true` 创建（未跑验证）。每个任务记录 `created source=<path>`；按（source，标题）幂等重复导入。
- **FR-I2** `import beads [path]`：读取 Beads Classic 的 `issues.jsonl`（默认 `.beads/issues.jsonl`）。映射：priority → rank 顺序；type → label；`blocks` → `blocked_by`；parent-child → `parent`；closed → `closed` 且 `done`（Beads 原因表明放弃时为 `wontfix`）；原 ID 放 `external.beads.id`。Dolt 时代的导出不在范围内。

### 7.11 质量与运维

- **FR-Q1** `doctor [--fix]` 检查规格中的所有不变量、冲突标记、未知键、孤儿租约；`--fix` 规范化键顺序、时间戳、checkbox 语法并清除过期租约。仍有问题则退出码 1。
- **FR-Q2** 退出码：0 成功 · 1 用法/校验错误 · 2 门禁失败（verify/验收标准/子任务）· 3 冲突（租约被占、并发写）· 4 格式版本不支持。
- **FR-Q3** `--json` 的输出结构有文档并随 CLI 版本化；破坏性变更升 CLI 主版本。
- **FR-Q4** 动词宽容：`done|finish|complete`、`close|cancel`、`ls|list`、`add|new|create`、`note|log`、`dep|block` 作为别名接受；别名不计入子命令数。
- **FR-Q5** `init` 创建含 `config.yml`、`tasks/`、`.gitignore` 的 `.todopi/`，并把协议文本追加到 `AGENTS.md`（不存在则创建）。除非运行 `setup claude`，否则不碰 `CLAUDE.md`。

## 8. 命令参考（20 个子命令）

```
todopi init [--prefix tp]
todopi setup <claude|codex|opencode|pi|cursor|gemini> [--user]
todopi add <title> [-d text] [--parent id] [--blocked-by id,…] [--label l]… [--ac text]… [--verify cmd] [--from id] [--edit]
todopi ls [--open|--closed|--all] [--ready] [--blocked] [--mine] [--label l] [--limit n] [--json]
todopi show <id> [--full] [--tree] [--json]
todopi edit <id> [--title t] [-d text] [--verify cmd] [--label +l|-l] [--parent id|none] [--edit]
todopi done <id> [--evidence text] [--force --reason text] [--yes]
todopi close <id> --as <wontfix|duplicate|stale> [--reason text] [--force]
todopi reopen <id>
todopi move <id> --top|--before <id>|--after <id>
todopi dep add <id> --on <id> | dep rm <id> --on <id>
todopi claim <id> [--as actor] [--steal]
todopi release <id>
todopi note <id> <text>
todopi check <id> <n> [--undo]
todopi prime [--budget n] [--json]
todopi handoff [--check]
todopi web [--port n] [--open]
todopi doctor [--fix]
todopi import <file.md> | import beads [path]
```

全局参数：`--json`、`--quiet`、`--as <actor>`、`-C <dir>`。

## 9. Agent 协议（SKILL.md / AGENTS.md 片段的内容，≤ 800 token）

每个 agent 都会收到的文本，大纲如下：

1. **todopi 是什么**：仓库的持久任务账本；`.todopi/` 是数据，永远不要手改，用 CLI。
2. **粒度**：一个 todopi 任务约等于一次值得提交的改动，有可检查的结果。改一个文件或跑一次测试不是任务。
3. **时刻**（照做，不要斟酌）：会话开始 → 读给你的 `prime` 输出（或运行 `todopi prime`）；动手前 → `todopi claim <id>`；发现新工作 → `todopi add "<title>" --from <当前 id>`；踩了坑 → `todopi note <id> "<做了什么、为什么>"`；做完 → `todopi done <id>`（它会跑验证；修工作，不要强制）；结束会话 → `todopi handoff`。
4. **原生 todo**：本轮内的步骤继续用你自己的；永远不要把 todopi 任务复制进去。
5. **提交**：把 `.todopi/` 的改动和对应工作一起提交；在提交信息里写任务 id。
6. **查询**：`todopi ls --ready` 看下一步做什么；`todopi show <id>` 看细节；解析输出时加 `--json`。

这段文本是产品产物：措辞靠 dogfooding 调整，改它不是代码变更。

## 10. 非功能需求

| 领域 | 要求 |
|---|---|
| 性能 | 2,000 个任务的仓库上任何命令在笔记本上 < 200 ms（冷缓存 < 1 s）。`prime` 永不超预算。 |
| 平台 | 支持 macOS 与 Linux；Windows 尽力（CI 跑，失败不阻塞发布）。 |
| 运行时 | npm 包在 Node ≥ 20 上运行，不需要 Bun；brew/curl 提供无运行时依赖的 Bun 编译二进制。 |
| 安全 | 验证命令仅在按仓库信任后执行；看板只绑定回环地址；v0.1 无任何网络访问。 |
| 隐私 | 永不遥测。文档提醒 `.todopi/` 在公开仓库中是公开的。 |
| 兼容 | 格式版本 1；CLI 拒绝写入更新的版本（退出码 4）。 |
| 本地化 | CLI 与文档英文；中文站点页面为辅。 |
| 许可 | MIT。 |

## 11. 发布计划

| 版本 | 范围 |
|---|---|
| **v0.1（MVP）** | §7 全部；六家接入包上市场；两个导入器；看板；含格式规格的站点；Show HN 首发 |
| **v0.2** | 原生 todo 镜像（Claude Code `TaskCreated/TaskCompleted` 钩子、OpenCode 插件）、提交/PR 关联、任务文件的 git merge driver、Linear 单向推送（todopi 为事实来源）、`remember` 记忆条目进 `prime`、薄 MCP 适配（≤ 5 工具）、Linear 之后做 GitHub Issues |
| **v0.3+** | 跨仓视图、托管同步与共享看板（付费）、双向同步、任务级成本归因 |

## 12. MVP 验收

1. 本仓库用 todopi 管理自己的开发，跨 ≥ 3 个会话、同时使用 Claude Code 与 Codex，没有可归因于账本的进度丢失或重复工作。
2. 在本仓库真实账本上实测 `todopi prime` 输出 ≤ 1,500 token。
3. 新用户按 README 从零安装到一个可认领任务 ≤ 2 分钟。
4. 每个发布 tag 上 `doctor` 对本仓库账本通过。
5. 六个 `setup` 目标各自在全新克隆上干净安装，且 agent 在会话开始时收到 `prime` 输出（首发前逐家手工验证）。

## 13. 首发清单（直接 Show HN，不做软发布）

- [ ] 格式规格发布在 todopi.com/spec，含 12 字段表
- [ ] 30 秒录屏：压缩发生，agent 从 `prime` 继续
- [ ] README：六家安装方式、协议、「vs Beads」段落、读音与名字来源
- [ ] npm `todopi`、brew tap、curl 安装脚本上线；`@todopi` scope 已占
- [ ] 六个市场/注册表条目上线
- [ ] `import beads` 用至少两份真实 Beads Classic 导出测过
- [ ] 首发后一周的 awesome 列表 PR 准备好
- [ ] 域名：todopi.com 已续费，todopi.dev 已注册

## 14. 风险

| 风险 | 应对 |
|---|---|
| 品类拥挤（Beads 与十几个极简克隆） | 靠公开格式、一条命令跨 agent 接入、验证式完成、有上限的 prime 竞争；不拼功能数 |
| 某家厂商原生做出仓库内持久任务 | 坚持跨 agent 与可 diff；成为别人读的格式 |
| agent 忽视或误用账本 | 用钩子而非提示；宽容动词；handoff 审视 agent 新建的任务；靠 dogfooding 调协议文本 |
| 范围膨胀（Beads 的失败模式） | v0.1 硬上限 20 个子命令；每加一个必须删一个 |
| 一个维护者六套接入 | 接入只是围绕同一份协议文本加 `prime`/`handoff` 的薄包装；CI 里对六家跑契约测试 |
| 同一任务在两个分支被改产生冲突 | v0.1 接受（独立开发场景少见）；`doctor` 检测冲突标记；v0.2 出 merge driver |

## 15. 待办项

实现默认值（除非有异议即按此执行）：6 位 base36 随机 ID；UTC 秒级时间戳；`.todopi/` 只在仓库根；无 git 时租约回退到 `.cache/`；`prime` 的裁剪顺序如 FR-P1；字符数 ÷ 4 估算 token；「本会话」= 自本 actor 上次 `prime` 起；阻塞项关闭即解除阻塞而不论 resolution；无硬删除。

产品负责人的动作：续费 todopi.com（2026-11-20 到期）；注册 todopi.dev；在 npm 发布 `todopi` / `@todopi` 占位；创建 GitHub org；人工商标检索（USPTO、EUIPO）；为导入器测试准备两份真实 Beads Classic 导出。

## 16. 决策记录

2026-09-14 共做出 30 项产品决策，连同理由与调研记录在 `docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md` §10。
