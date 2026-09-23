# todopi — 产品需求文档

版本：1.2 · 2026-09-16
配套文档：`spec/todopi-format-v1.md`（磁盘格式规格，英文，normative）、`docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md`（调研与决策记录）

本文是仓库内的设计文档，用中文（决策 #8：英文为主指 CLI 输出、SKILL、README、官网；仓库内设计文档可用中文）。面向用户的文案仍是 English-first。

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
2. 无常驻进程、无数据库、无 API key、无 LLM 调用、无遥测、无自动 git。`todopi web` 是绑定回环地址的前台进程，随启动它的终端一起结束；你不在看的时候没有任何东西在监听。
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
| 看板 | `todopi web`：本地、只绑定 127.0.0.1、单页、无账号；v0.1 只读 |
| 接入 | `todopi setup <agent>`，支持 claude、codex、opencode、pi、cursor、gemini。市场/注册表上架是首发后的分发动作，不阻塞发布（§13） |
| 导入器 | `todopi import <plan.md>` 与 `todopi import beads` |
| 站点 | todopi.com：安装、文档、格式规格；英文为主，中文页为辅 |

## 7. 功能需求

每条需求有编号、陈述和验收口径。「任务」指符合格式规格的一个文件。

### 7.1 任务

- **FR-T1** `add` 创建任务：标题，可选描述、父任务、阻塞项、标签、验收标准、验证命令，以及 `--from <id>` 来源。它同时分配一个排在末位的 `rank`，使 todopi 写出的每个任务都带 rank。*验收：* 文件存在、通过 `doctor`、Log 有 `created`。
- **FR-T2** `ls` 列出任务；过滤器 `--open`（默认）、`--closed`、`--ready`、`--blocked`、`--mine`、`--label`；`--json` 输出数组；`--limit N`。已关闭任务默认隐藏。stale 与未验证任务有标记。
- **FR-T3** `show <id>` 打印 frontmatter、带序号的验收标准、最近 5 条 Log 及总数；`--full`、`--tree`（父链与子任务及进度）、`--json`。
- **FR-T4** `edit <id>` 通过参数或 `--edit`（$EDITOR）修改标题、描述、verify、标签、父任务和正文分节。记录 `edited fields=…`。
- **FR-T5** `move <id> --top | --before <id> | --after <id>` 是改 `rank` 的唯一途径；**只重写一个文件**。这条成立的前提是每个任务自创建起就带 rank（FR-T1）：有 rank 与无 rank 混合存在时 `--after` 无解，因为任何任务一旦取得 rank 就会整段排到所有无 rank 任务之前。
- **FR-T6** ID：`<前缀>-<6 位 base36>`，随机生成，本地碰撞检查。
- **FR-T7** 没有优先级字段、没有类型字段、没有删除命令。软删除是 `close --resolution obsolete`。

### 7.2 图

- **FR-G1** `dep add <id> --on <id>` / `dep rm` 维护 `blocked_by`；有环则拒绝（退出码 1）并打印环。
- **FR-G2** `ls --ready`（别名 `ready`）实现规格中的 ready 定义与排序；输出即 agent 应从中挑选的内容。
- **FR-G3** 容器（有子任务的任务）永不出现在 ready 中，并显示 `n/m` 子任务进度。

### 7.3 认领与租约

- **FR-C1** `claim <id> [--as <actor>]` 设置 `status: in_progress` 与 `assignee`，原子创建租约，记录 `claimed`。ready 队列给出的任务一定能被认领：租约已过期的 in_progress 任务直接重新认领，不需要额外仪式——队列把任务摆出来、claim 又拒绝它，两者会自相矛盾。只有**未过期**的租约才拒绝（退出码 3），`--steal` 用于覆盖它。无论哪种情况，替换了他人的 `assignee` 都记录 `steal=true` 并写明被替换者。
- **FR-C2** `release <id>` 清空 assignee、删除租约、记录 `released`。
- **FR-C3** 持有者的每次写入都刷新租约心跳和 `updated`。
- **FR-C4** actor 解析：`--as` > `TODOPI_ACTOR` > agent 环境推断（`claude-code@<host>`、`codex@<host>` 等）> `git config user.name`。actor 标识的是**工作者而非会话**，因此同一机器上同一工具跨会话保持不变——否则续做自己昨天的任务都要先抢占。取自 `git config` 的值按格式规格 §5.4 规范化（这类值常含空格，而 actor 语法禁止空格）。`--as` 同时覆盖写入身份与查询身份，人不必做任何配置就能查看另一个 actor 的工作。
- **FR-C6** 身份有两种匹配方式，由命令是否写入决定。**写入严格匹配**：`note`、`check`、`edit`、`done`、`close`、心跳刷新，以及 `handoff` 追加的笔记，在任务 `assignee` 是另一个 actor 时拒绝（退出码 3），两个工作者因此不会在同一个任务上交错写入。**展示宽松匹配**：`ls --mine`、`prime` 和 `handoff` 打印的报告把 assignee 等于当前解析出的 actor **或**以 `@<本机 host>` 结尾的任务都算作「我的」。人在终端上因此能看到自己的 agent 在做什么——这正是这三个命令存在的意义；不需要任何配置，也不需要保存一份 actor 清单。
- **FR-C5** 租约放在 `.git/todopi/leases/`（worktree 间共享）；无 git 时回退到 `.todopi/.cache/leases/`。同一目录承载其余机器本地运行时状态，包括每个会话上次 `prime` 的时间（FR-P1）。会话身份留在这里，永不进入任务文件。

### 7.4 完成定义

- **FR-D1** `check <id> <n>` / `check <id> <n> --undo` 切换第 n 条验收标准并留痕。
- **FR-D2** `done <id>`：若设置了 `verify`，先原样打印将要执行的命令，再在仓库根以配置的超时执行并捕获输出；非零退出则拒绝（退出码 2）。超时**MUST 终止整个进程组**而不只是直接子进程：POSIX 上以独立进程组启动并向进程组发信号，Windows 上用等价的树终止。实测依据是运行时默认行为只向直接子进程发 SIGTERM，孙进程全部存活——而 `verify` 的典型值（`pnpm test`、`cargo test`）都会 fork worker，默认超时又是 600 秒，被遗弃的 worker 会继续占端口、写文件、烧 CPU，而 todopi 早已退出。任何验收标准未勾选、任何子任务不是 `closed`、或任务归属于另一个 actor（FR-C6），同样拒绝。成功则设为 `closed`/`done`，记录 `done verify=… commit=<HEAD7> dirty=<bool>`，删除租约。
- **FR-D2a** 拒绝时打印一份不需要再跑别的命令就能据以行动的报告——因为这是 agent 唯一能看到的东西，而协议要求它去修活而不是强制通过。报告写明**是哪道门禁拒绝的**及其具体内容：未勾选的验收标准逐条列出序号与文本；未关闭的子任务列出 id、标题与状态；`verify` 列出实际执行的命令、退出码与输出尾部；归属冲突列出持有者及其最近一次写入时间。报告以两条出路结尾——修完重跑 `done`，或 `--force --reason <text>`。不向 Log 追加任何内容：状态没有改变（格式规格 §5.3.3）。agent 想记录学到的东西，用 `note`。
- **FR-D3** `--force --reason <text>` 绕过任何门禁，记录 `forced=true` 与理由；此类任务在列表与看板中标记为「未验证」。
- **FR-D4** 在某仓库首次执行 `verify` 前要求确认，信任按仓库路径记入 `~/.config/todopi/trust`；`--yes` 或 `CI=true` 跳过提示。信任记录**永不**存在 `.todopi/` 内：随仓库一起传播的信任记录等于让仓库为自己背书。由于 `verify` 是任何写入者都能改的普通任务字段——agent、手工编辑、被合并的 PR——按路径信任并不约束授信之后**执行的是什么**。有两件事收窄这个面：每次执行前原样打印命令，使它永远不会和上次悄悄不同；`handoff` 列出自本 actor 上次 `prime` 以来 `verify` 发生过变更的任务（FR-H1）。按命令内容信任排在 v0.2——届时用户开始接受外部贡献，重复确认的摩擦才换得来对等的收益。
- **FR-D4a** 验证输出的去向由两件事决定：Log 要提交进 git，而 `prime` 有预算。**通过**时不记录输出：命令在 frontmatter 里、commit 在 Log 里，复现所需的一切都已具备。**强制关闭**时记录最后 512 字节，因为被跳过的验证正是人必须复查的那一种，证据必须留在 diff 里看得见。**完整输出**一律写入 `.todopi/.cache/verify/`，不提交，可随时删除。
- **FR-D5** `close <id> --resolution wontfix|duplicate|obsolete [--reason]`（短写 `-r`）与 `reopen <id>` 按状态机执行。**`close` 不查验收标准**——spec §6.1 表格里 `close` 那一行只要求子任务全部关闭，而 `close` 正是「不做了」的出口，标准没勾完本来就是它的常态。标志名是 `--resolution` 而不是 `--as`：全局 `--as` 已经表示 actor（FR-C4），两者撞名时 commander 让全局优先，实测 `todopi close tp-1 --as wontfix` 里那个 `--as` 会被 commander 当成全局的 actor 选项，于是 actor 被设成 `"wontfix"` 而 resolution 收不到值。当前实现会因此退出 1（缺 resolution），不会写出坏文件；但按文档原样写的命令根本用不了，而且身份被悄悄改掉了。试过用 `enablePositionalOptions()` 保住原形，但它会让 `todopi ls --json` 报 unknown option，而那是命令参考与协议文本给 agent 的写法。`reopen` 在移除 `resolution` 的同时清除 `assignee`，否则会产出违反格式自身不变量的文件。软删除的 resolution 用 `obsolete` 而不是 `stale`，因为 `stale` 已经用于一个派生状态——租约过期的 in_progress 任务——两者会在同一份列表里并排出现却表示毫不相干的事。

### 7.5 日志

- **FR-L1** `note <id> <text>` 追加一行 Log；支持多行文本。
- **FR-L2** 所有状态变更都按规格语法追加一行 Log；从不改写之前的行。

### 7.6 上下文注入

- **FR-P1** `prime [--budget <tokens>]`（默认 600）**推送「你正在做什么」，指向其余一切**。输出 Markdown：

  1. 调用者正在进行的任务：标题、带状态的验收标准、最近 2 条 Log。**这一段是推送的**。
  2. 一行指针，给出可领任务数、本机其他 actor 持有的任务数，以及取用它们的命令。

  没有进行中的任务时退化为单行：可领数量加一条 `todopi ls --ready`。

  **协议文本不在 `prime` 里**（这是 1.2 版的改动）。`setup` 已经把它装进各家的
  规则/技能文件，而那些文件在压缩后由 agent 自己从磁盘重读——Claude Code 官方
  文档明确写出「project-root CLAUDE.md survives compaction: after `/compact`,
  Claude re-reads it from disk and re-injects it」。每次注入重复 112 token 是纯浪费。
  （其余五家的规则文件是否同样在压缩后重读，未逐一核实，记入 §15。）

- **FR-P1c** 推送与指针的分界由「需要的概率」决定，不由体积决定。**当前任务的
  验收标准与最近 Log 是推送的**，因为持有任务时它接近 100% 需要——而按需读取只在
  概率低时划算：一次工具调用的成本是命令、输出、模型重读三者之和，加上一个回合
  的延迟，对 100% 需要的内容严格更差。更要紧的是，指针本质上是 prompt，而这个
  产品的立论（§14 风险表）正是「用 hooks 而不是靠 prompt 记得」；压缩之后恰恰是
  agent 注意力在别处、最可能漏掉指针的时刻，而漏掉的后果就是重做已完成的工作。
  ready 队列、计数、最近关闭、其他 actor 持有的任务都不满足这个条件，因此是指针。

  实测（tiktoken，中文内容）：典型一个任务两条验收两条 Log 为 145 token，
  极端情形（10 条验收 + 3 条长 Log）368 token，无持有任务 22 token。
  对照 1.1 版的全量推送 427 token。
- **FR-P1a** 预算规则。默认 600 由最坏情形推出：一个合法任务的推送上限实测 368
  token（10 条验收 + 3 条长 Log），600 给了约 1.6 倍余量。这是一个真实约束，
  而不是一个没人会碰到的天花板。

  超出预算时在**项内**截断而不是丢掉整项：验收标准保留未勾选的、丢已勾选的；
  Log 只保留最新一条。末尾那行指针**永不裁剪**——它是 22 token 的常量，而且裁掉
  它就等于让 agent 既拿不到内容也不知道去哪取。持有多个任务时按 `updated` 由新到旧，
  装不下的任务退化为一行「另有 N 个你持有的任务」。
- **FR-P1b** `prime` 把调用时间按**会话**记录在 FR-C5 的运行时目录，供 FR-H1 使用。会话标识的可得性于 2026-09-16 核实：Claude Code、Codex、Gemini CLI 在钩子 stdin 里给 `session_id`；Cursor 的钩子载荷同样带会话标识；OpenCode 在事件对象上给 `session_id` 或 `sessionID`（两种拼法都要处理）；pi 不把它传进事件，扩展需调 `ctx.sessionManager.getSessionId()` 自取。六家都拿得到，因此按 actor 记录只是**防御性**回退，不是常态。
- **FR-P2** `prime --json` 以结构化数据输出相同内容。
- **FR-P3** `prime --full` 输出 1.1 版那种全量上下文：当前任务、本机其他 actor
  持有的任务、ready 前 5 条、计数、最近关闭 3 条。它是**给 agent 主动调用的**——
  FR-P1 的指针指向的就是它。默认 `prime` 服务于钩子（每次注入都要付钱），
  `--full` 服务于「我现在确实需要全景」这个明确时刻。不是新子命令，是一个 flag。

### 7.7 交接

- **FR-H1** `handoff` 用 FR-C6 的宽松身份匹配打印，好让人看到自己的 agent 做了什么：最近一小时没有 Log 的进行中任务；自上次 `prime` 以来创建的任务；自那时起 `verify` 命令发生过变更的任务（FR-D4）。随后向**自己是 assignee 的**每个进行中任务追加一条带摘要的 `handoff` Log 并刷新其心跳——写入路径是严格的。它不释放认领。`--check` 只输出报告并以 0 退出（供钩子使用）。

### 7.8 Agent 接入

- **FR-A1** `setup <agent>` 幂等地安装该 agent 的 skill/规则文件与钩子。默认写项目级配置（克隆即用）；`--user` 写用户级。它打印写入的每个文件。
- **FR-A2** 钩子映射。各家事件名于 2026-09-16 核实（见 §17）。六家都能在**会话开始**注入，但**压缩之后**能否重新注入分成两类，这个差异决定了各家的接入形态：

  | Agent | 会话开始 | 压缩 | 会话结束 | 配置位置 |
  |---|---|---|---|---|
  | Claude Code | `SessionStart`（matcher：`startup` `resume` `clear` `compact` `fork`） | `PostCompact` | `SessionEnd` | `.claude/settings.json` |
  | Codex | `SessionStart` | `PostCompact` | `SessionEnd` | `.codex/hooks.json` |
  | OpenCode | `event` 钩子订阅 `session.created` | 同上订阅 `session.compacted` | `session.idle` 兜底 | `.opencode/plugins/` |
  | pi | `session_start` | **`session_compact`**（压缩后）；`session_before_compact` 是压缩前 | `session_shutdown` | `.pi/extensions/`，`pi install` |
  | Cursor | `sessionStart`（返回 `additional_context`） | **无 post 事件**，只有 `preCompact` | `sessionEnd` | `.cursor/hooks.json` |
  | Gemini CLI | `SessionStart`（返回 `hookSpecificOutput.additionalContext`） | **无 post 事件**，只有 `PreCompress` | `SessionEnd` | `settings.json` |

- **FR-A2a** 无 post-compaction 事件的两家（Cursor、Gemini CLI）改用**压缩前注入**：在 `preCompact` / `PreCompress` 时把 `prime --budget 400` 的输出交给待生成的摘要，使账本指针**成为摘要的一部分**，从而按定义活过压缩。这不是等价替代——它注入的是压缩发生**那一刻**的状态，此后到下一次会话开始之间的变化不会反映。协议文本因此要求 agent 在察觉上下文被压缩后主动跑一次 `todopi prime`，这一条对所有 agent 都写，对这两家是必需的。
- **FR-A2b** Cursor 的 CLI（`cursor-agent`）对钩子的支持一直在变动：2026-01 只有 `beforeShellExecution` / `afterShellExecution` 触发，2026-04 扩展到含 `sessionStart`，官方论坛记录显示仍未与 IDE 完全对齐。因此 Cursor 接入包 MUST 同时提供规则文件作为回退路径，且 MUST 在首发前于 CLI 与 IDE 两种形态下各手工验证一次（MVP 验收第 5 条）。
- **FR-A3** 所有 agent 收到同一份 ≤ 800 token 的说明文本（「协议」，§9）；各家打包只是包装。
- **FR-A4** 接入的**能力**在首发时必须完整：六家各自 `todopi setup <agent>` 一条命令装好，README 给出六家安装说明。市场/注册表上架（Claude Code plugin、Codex plugin、OpenCode plugin、pi package、Cursor、Gemini 扩展）是首发后一周内的跟进动作，**不阻塞发布**。
  改这一条的理由是一个反例：rtk 接入了 17 家 agent，一个市场都没上，全部靠 `rtk init --agent <name>` 就地写配置。市场不是这个品类的必要杠杆，而六家审核周期不可控、单人维护——把它放在关键路径上等于把发布日期交给六个第三方。接入能力不缩水，只是审核不再挡住发布。

### 7.9 本地看板

- **FR-B1** `web [--port 4747] [--open]` 只在 127.0.0.1 提供单页看板。进程在前台运行，随终端退出。
- **FR-B2** 视图：按显示状态分列（open、blocked、in progress、done、closed）、按容器的树、ready 队列；任务抽屉显示验收标准、Log、验证证据。
- **FR-B3** v0.1 的看板**只读**。它被声明的目标是「让人一眼看到 agent 在干什么」，而只读完全满足这个目标。四种写操作——跨列拖拽、勾选验收标准、加 note、拖拽排序——移到 v0.2。它们是贵的那一半：每一种都必须走与 CLI 相同的校验与加锁路径，这会迫使 CLI 的写入路径在实现的第一周就被抽成可复用接口；每一种还都需要一个必须填理由的强制对话框。推迟它们，等于在不触碰首发所依赖的任何东西的前提下，从 v0.1 移除一项架构承诺：看板不承担分发价值，而首发演示是一段终端录屏。
- **FR-B4** 文件变化时页面刷新（目录监听 + SSE）。

### 7.10 导入器

- **FR-I1** `import <file.md>`：解析 Markdown checkbox 列表（Superpowers 计划、spec-kit `tasks.md`、OpenSpec `tasks.md`）。标题变容器，条目变子任务，文档顺序变 `rank`，已勾选条目以 `closed/done` 且 `forced=true` 创建（未跑验证）。每个任务记录 `created source=<path>`；按（source，标题）幂等重复导入。
- **FR-I2** `import beads [path]`：读取 Beads Classic 的 `issues.jsonl`（默认 `.beads/issues.jsonl`）。映射：priority → rank 顺序；type → label；`blocks` → `blocked_by`；parent-child → `parent`；closed → `closed` 且 `done`（Beads 原因表明放弃时为 `wontfix`）；原 ID 放 `external.beads.id`。Dolt 时代的导出不在范围内。

### 7.11 质量与运维

- **FR-Q1** `doctor [--fix]` 检查规格中的所有不变量、冲突标记、未知键、孤儿租约；`--fix` 规范化键顺序、时间戳与 checkbox 语法，按 `created` 顺序回填缺失的 `rank`（FR-T5），并清除过期租约。它**永不修改 Log**，哪怕某一行无法解析也只报告不改写。一个可以被修复工具改写的追加式历史不是证据，而 Log 正是这个产品拿出来当证据的东西。仍有问题则退出码 1。
- **FR-Q2** 退出码：0 成功 · 1 用法/校验错误 · 2 门禁失败（verify/验收标准/子任务）· 3 冲突（租约被占、并发写）· 4 格式版本不支持。
- **FR-Q3** `--json` 的输出结构有文档并随 CLI 版本化；破坏性变更升 CLI 主版本。
- **FR-Q4** 动词宽容：`done|finish|complete`、`close|cancel`、`ls|list`、`add|new|create`、`note|log`、`dep|block` 作为别名接受；别名不计入子命令数。
- **FR-Q5** `init` 创建含 `config.yml`、`tasks/`、`.gitignore` 的 `.todopi/`，并把协议文本追加到 `AGENTS.md`（不存在则创建）。重复运行是幂等的：已存在的协议段落被原地替换而不是再追加一份。
- **FR-Q5a** 只跑 `init` 不足以让 Claude Code 读到协议：官方文档明确写出「Claude Code reads `CLAUDE.md`, not `AGENTS.md`」。因此 `setup claude` MUST 确保存在一个 `CLAUDE.md`，其中含有对 `AGENTS.md` 的导入（`@AGENTS.md`），已有 `CLAUDE.md` 则只在缺少该导入时追加一行，不改动其余内容。这一条同时是协议能活过压缩的前提——project-root 的 `CLAUDE.md` 在压缩后由 Claude Code 从磁盘重读，这正是 FR-P1 把协议移出 `prime` 的依据。

## 8. 命令参考（20 个子命令）

```
todopi init [--prefix tp]
todopi setup <claude|codex|opencode|pi|cursor|gemini> [--user]
todopi add <title> [-d text] [--parent id] [--blocked-by id,…] [--label l]… [--ac text]… [--verify cmd] [--from id] [--edit]
todopi ls [--open|--closed|--all] [--ready] [--blocked] [--mine] [--label l] [--limit n] [--json]
todopi show <id> [--full] [--tree] [--json]
todopi edit <id> [--title t] [-d text] [--verify cmd] [--label +l|-l] [--parent id|none] [--edit]
todopi done <id> [--force --reason text] [--yes]
todopi close <id> --resolution <wontfix|duplicate|obsolete> [--reason text] [--force]
todopi reopen <id>
todopi move <id> --top|--before <id>|--after <id>
todopi dep add <id> --on <id> | dep rm <id> --on <id>
todopi claim <id> [--as actor] [--steal]
todopi release <id>
todopi note <id> <text>
todopi check <id> <n> [--undo]
todopi prime [--budget n] [--full] [--json]
todopi handoff [--check]
todopi web [--port n] [--open]
todopi doctor [--fix]
todopi import <file.md> | import beads [path]
```

全局参数：`--json`、`--quiet`、`--as <actor>`、`-C <dir>`。

- `--json`：输出结构化数据而非人类可读文本（FR-Q3）。
- `--quiet`：抑制进度与提示性输出，只保留结果本身与错误；退出码不受影响。与 `--json` 同时给时 `--json` 决定格式、`--quiet` 去掉伴随文本，两者不冲突。
- `--as <actor>`：同时覆盖写入身份与查询身份（FR-C4）。
- `-C <dir>`：在该目录下查找 `.todopi/` 并执行，等价于先 cd 过去。

## 9. Agent 协议（SKILL.md / AGENTS.md 片段的内容，≤ 800 token）

**本节是对一份英文产物的中文描述，不是那份产物本身。** 协议文本会被 `setup` 写进
用户的仓库，属于用户可见文案，MUST 是英文（AGENTS.md 的 English-first 边界）。
正文是首发阻塞项，尚未撰写；撰写时以本节大纲为准，并逐条核对 ≤ 800 token 预算。

大纲如下：

1. **todopi 是什么**：仓库的持久任务账本；`.todopi/` 是数据，永远不要手改，用 CLI。
2. **粒度**：一个 todopi 任务约等于一次值得提交的改动，有可检查的结果。改一个文件或跑一次测试不是任务。
3. **时刻**（照做，不要斟酌）：会话开始 → 读给你的 `prime` 输出（或运行 `todopi prime`）；动手前 → `todopi claim <id>`；发现新工作 → `todopi add "<title>" --from <当前 id>`；踩了坑 → `todopi note <id> "<做了什么、为什么>"`；做完 → `todopi done <id>`（它会跑验证；修工作，不要强制）；结束会话 → `todopi handoff`。
4. **原生 todo**：本轮内的步骤继续用你自己的；永远不要把 todopi 任务复制进去。
5. **提交**：把 `.todopi/` 的改动和对应工作一起提交；在提交信息里写任务 id。
6. **查询**：`todopi ls --ready` 看下一步做什么；`todopi show <id>` 看细节；解析输出时加 `--json`。
7. **察觉到上下文被压缩时**：主动跑一次 `todopi prime`，不要等钩子。这条对所有 agent 都写，但对 Cursor 与 Gemini CLI 是**必需**——它们没有压缩后事件（FR-A2/A2a），钩子不会替你重新注入。

这段文本是产品产物：措辞靠 dogfooding 调整，改它不是代码变更。

## 10. 非功能需求

| 领域 | 要求 |
|---|---|
| 性能 | 2,000 个任务的仓库上任何命令在笔记本上 < 200 ms（冷缓存 < 1 s）。`prime` 永不超预算。2026-09-16 实测（M 系列 mac，2,000 任务全量扫描）：手写快路径解析 16 ms、通用 YAML 解析器 120 ms、进程启动 10 ms、文件 I/O 20 ms。目标环境含 WSL2、容器挂载卷与网络文件系统，那里 I/O 往返贵一个数量级，余量按最坏环境预留而非按开发机。 |
| 平台 | 支持 macOS 与 Linux；Windows 尽力（CI 跑，失败不阻塞发布）。 |
| 运行时 | npm 包在 Node ≥ 20 上运行，不需要 Bun；brew/curl 提供无运行时依赖的 Bun 编译二进制。源码只用 Node API，Bun 仅作编译器（DECISIONS D006）。实测体积：**npm 装完 1.5 MB**（三个零传递依赖），二进制 61 MB（macOS arm64）/ 90 MB（Linux x64）——体积全部来自内嵌运行时，`--minify` 与 `--bytecode` 均无效。对照：同类中最接近的 Backlog.md 同为 Bun + TypeScript，但因使用 Bun 专属 API 而必须发二进制，其 npm 安装量为 67.5 MB（macOS）/ 96.3 MB（Linux）。**45 倍差距来自「源码只用 Node API」这一条决策**，见 DECISIONS D008。curl 安装器先探测 Node ≥ 20：有则装 npm 包，无则下载二进制。 |
| 安全 | 验证命令仅在按仓库信任后执行，且每次执行前原样打印；看板只绑定回环地址；v0.1 无任何网络访问。文档明确写出：把 `todopi` 加进 agent 的命令白名单**不是**沙箱——`done` 会执行仓库自己的 `verify` 命令，而 agent 的权限检查看不到它。**OS 级沙箱是有效的**：2026-09-16 核实，Claude Code 与 Codex 的沙箱都约束整棵进程树（macOS Seatbelt、Linux bubblewrap+Landlock+seccomp），todopi 派生的 verify 进程继承同一套限制。文档应据此建议：依赖白名单做隔离的用户同时启用 OS 沙箱。 |
| 隐私 | 永不遥测。文档提醒 `.todopi/` 在公开仓库中是公开的。 |
| 兼容 | 格式版本 1；CLI 拒绝写入更新的版本（退出码 4）。 |
| 本地化 | 用户可见文案（CLI 输出、README、spec、协议文本、官网）English-first；中文站点页面为辅。仓库内设计文档用中文。 |
| 许可 | MIT。 |

## 11. 发布计划

| 版本 | 范围 |
|---|---|
| **v0.1（MVP）** | §7 全部；六家接入包可用（上市场是首发后跟进）；两个导入器；只读看板；含格式规格与语料库的站点；Show HN 首发 |
| **v0.2** | 看板写操作（FR-B3）、按命令内容信任（FR-D4）、可选的 `project_id` 配置键、原生 todo 镜像（Claude Code `TaskCreated/TaskCompleted` 钩子、OpenCode 插件）、提交/PR 关联、任务文件的 git merge driver、Linear 单向推送（todopi 为事实来源）、`remember` 记忆条目进 `prime`、薄 MCP 适配（≤ 5 工具）、Linear 之后做 GitHub Issues |
| **v0.3+** | 跨仓视图、托管同步与共享看板（付费）、双向同步、任务级成本归因 |

## 12. MVP 验收

1. 本仓库用 todopi 管理自己的开发，跨 ≥ 3 个会话、同时使用 Claude Code 与 Codex，没有可归因于账本的进度丢失或重复工作。
2. 在本仓库真实账本上，`prime` 打印的内容足以让一个全新会话正确接续——要么直接够用，要么让 agent 知道该去取什么并真的取了；跨 3 个会话人工确认。测「输出没超预算」证明不了任何事，因为它本来就是按预算截断的。需要被证明的是两件事：**裁剪顺序先丢掉的是最没用的内容**，以及**指针真的被 agent 用了**——后者是 FR-P1c 那个赌注的唯一验证方式，若 agent 反复忽略指针，就把对应内容改回推送。
3. 新用户按 README 从零安装到一个可认领任务 ≤ 2 分钟。
4. 每个发布 tag 上 `doctor` 对本仓库账本通过。
5. 六个 `setup` 目标各自在全新克隆上干净安装，且 agent 在会话开始时收到 `prime` 输出（首发前逐家手工验证）。

## 13. 首发清单（直接 Show HN，不做软发布）

- [ ] 格式规格发布在 todopi.com/spec，含 12 字段表
- [ ] 30 秒录屏：压缩发生，agent 从 `prime` 继续
- [ ] README：六家安装方式、协议、「vs Beads」段落、读音与名字来源
- [ ] npm `todopi`、brew tap、curl 安装脚本上线；`@todopi` scope 已占
- [ ] 六家 `todopi setup <agent>` 在全新克隆上各自验证通过（市场条目不在此清单，见 FR-A4）
- [ ] `import beads` 用至少两份真实 Beads Classic 导出测过
- [ ] 首发后一周的跟进动作准备好：awesome 列表 PR、六个市场/注册表条目
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

实现默认值（除非有异议即按此执行）：6 位 base36 随机 ID；UTC 秒级时间戳；`.todopi/` 只在仓库根；无 git 时租约回退到 `.cache/`；`prime` 的裁剪顺序如 FR-P1/P1a；token 估算方式**待定**（见下方待决项，原「字符数 ÷ 4」经实测对中文低估 2–3 倍，已撤下）；「本会话」= 自本**会话**上次 `prime` 起，agent 不暴露会话 id 时回退为本 actor；阻塞项关闭即解除阻塞而不论 resolution；无硬删除。

**带触发条件的推迟项**，避免「以后再说」变成「一直没做」：

- **跨仓视图**（`ls --all`）留在 v0.3。它需要一份用户级的仓库注册表和带仓库限定的输出，而且服务的是维护者而不是首发：MVP 的五条验收标准没有一条涉及一个以上的仓库。dogfooding 时若发现日常回路确实跨仓库，再重新考虑——最小形态是一个 flag 加一份自动积累的注册表，约半天工作量，且不占 20 个子命令的额度。在那之前 README 给出基于 `-C` 的 shell 循环写法。
- **token 估算方式未定。** §15 此前把「字符数 ÷ 4」列为默认值，实测（tiktoken）它对英文准确（0.8–1.1×）而对中文低估 2.0–2.8×。FR-P1 把推送内容从 427 降到约 145 token 之后，这条的危害从「每次注入悄悄多吃 2000 token」降为「截断判据偏松，但实际很少触发截断」——因此不再阻塞，但仍须在实现 `prime` 前定下来。候选：真 tokenizer（准确但只能对准一家的 BPE，且多一个 1.6 MB 的依赖）／按 UTF-8 字节数估算／按字符类别加权（ASCII ÷ 4、CJK × 0.6、其余 ÷ 2，实测中英均在 ±15% 内，零依赖且可测）。倾向第三种。
- **其余五家的规则文件是否在压缩后重读，未核实。** FR-P1 把协议移出 `prime` 的依据是 Claude Code 的官方陈述；Codex、OpenCode、pi、Cursor、Gemini CLI 是否有同样行为需要在做各家接入包时逐一确认。若某家不重读，该家的接入包需要单独把协议放回它的注入点——这是接入包的差异，不是 `prime` 的差异。
- **导入器与 `forced=true` 的相互作用**（FR-I1/I2，本轮未展开）。FR-I1 规定导入时已勾选的条目建成 `closed/done` 且 `forced=true`，而 `forced=true` 在列表与看板中标记为「未验证」（FR-D3）。导入 500 个 Beads 已关闭 issue 会产生 500 个「未验证」标记——语义上没错（确实没验证过），但会把一个本用于警示「有人跳过了验证」的标记变成噪音。另需定义：重复导入（按 source + title 幂等）时 `rank` 保留还是重算，因为 rank 现在于创建时分配（FR-T1）。拆到导入器 feature 时展开。
- **裸仓库明确不支持。** 实测裸仓库中 `git rev-parse --git-common-dir` 返回 `.`，租约目录会落在裸仓库内部。规格 §1 定义 `.todopi/` 位于「包含 `.git` 的目录」，而裸仓库没有工作区。应在规格中显式声明不支持，而不是留给实现去猜。（git worktree 场景实测正确：`--git-common-dir` 正确指向共享的 `.git`。）
- **Windows 的原子 rename 是已知风险点。** 原子写是临时文件 + rename，而 Windows 上 rename 覆盖一个被其他进程打开的文件会失败。Windows 是尽力而为（CI 跑但不阻塞发布），但这一条应当是 Windows CI **明确要测**的用例，而不是等用户报告。本条未经实测，仅为推理。
- **FR-C4 的「agent 环境推断」这一级未实现，缺事实依据。** §17 核实六家 agent 时没有记录环境变量标记，而实测表明按变量名猜不可靠：`CODEX_HOME` 在一个 Claude Code 会话里同样存在（它是 codex CLI 的配置目录，不是「正在运行的 agent 是 codex」的证据）。猜错身份的代价是任务归属错乱，比少一级回退严重得多。当前解析链是 `--as` > `TODOPI_ACTOR` > `git config user.name`（经 §5.4 规范化）> `unknown@<host>`。做各家接入包时逐一核实各自是否有**唯一且只在自己运行时出现**的标记，核实结果写回 §17 再补这一级。（见 DECISIONS D014）
- **`project_id`** —— 一个能在移动与克隆后保持稳定的标识，跨仓视图和将来任何同步都需要它。现在不加，是因为格式规格 §9 明确把「新增配置键」归类为不升版本的加性变更，所以它随时可以在有消费者时引入，并由 `doctor --fix` 回填。提前加等于发布一个没人读的字段。

产品负责人的动作：续费 todopi.com（2026-11-20 到期）；注册 todopi.dev；在 npm 发布 `todopi` / `@todopi` 占位；创建 GitHub org；人工商标检索（USPTO、EUIPO）；为导入器测试准备两份真实 Beads Classic 导出。

## 16. 决策记录

2026-09-14 共做出 30 项产品决策，连同理由与调研记录在 `docs/product/2026-09-14-todopi-agent-task-ledger-brainstorm.md` §10。

2026-09-16 的分发形态调研推翻了决策 #28（六家市场上架阻塞首发），依据见 DECISIONS D008——反例是 rtk 接入 17 家 agent 而一个市场都没上。brainstorm §10 的原条目保留不改，由 D008 推翻。

2026-09-15 的一次评审解决了那份草稿与格式规格中发现的 11 个问题，产出本文档的 1.1 版。实质变更：rank 在创建时分配（FR-T1/T5）；状态机补上重新认领，`reopen` 清除 `assignee`；验收标准的勾选把标准文本一并写进 Log；通过的验证输出不再进 Log；被拒绝的转换完全不记 Log，改为输出一份结构化报告（FR-D2a）；身份在写入时严格匹配、在展示时宽松匹配（FR-C6）；`prime` 置顶协议提醒并为每一项设子预算（FR-P1a）；v0.1 看板改为只读（FR-B3）；软删除 resolution 更名为 `obsolete`；MVP 验收不再包含一条同义反复。

## 17. 外部事实核实记录（2026-09-16）

本节记录对第三方 agent API 的核实结果。这些是**外部事实，会变**；每次首发前
与每次接入包改动前都应重核，核实日期与结论一并更新。核实方法：各家官方文档
与官方论坛记录。

### 与 1.1 版的三处出入

1. **Cursor 与 Gemini CLI 都已支持钩子。** 1.1 版写的「规则文件加命令」已过期。
   两家都能在 `SessionStart` / `sessionStart` 注入上下文，各自的字段是
   `hookSpecificOutput.additionalContext` 与 `additional_context`。
2. **pi 的压缩事件选错了。** 1.1 版写 `session_before_compact`，它在压缩**之前**
   触发。压缩后重新注入要用 `session_compact`。
3. **OpenCode 缺会话开始的覆盖。** 1.1 版只写了 `session.compacted`，遗漏了
   `session.created`；且这两者都不是顶层钩子名，而是通过 `event` 钩子订阅的事件。

### 结构性发现：三分之一的接入面没有 post-compaction 事件

Cursor 只有 `preCompact`、Gemini CLI 只有 `PreCompress`，都没有压缩后的对应事件。
而「压缩之后重新注入账本指针」正是这个产品的核心演示（启动清单里那段 30 秒录屏）。
FR-A2a 给出的替代路径是压缩**前**注入摘要，让指针成为摘要的一部分；这不是等价
替代，差异写在 FR-A2a 里。这个约束应当影响首发叙事：核心演示用有 post 事件的
agent 录，而不是假设六家表现一致。

### 顺带确认

- **沙箱约束整棵进程树**（Claude Code、Codex 均已确认），所以 README 建议用户
  以 OS 沙箱补白名单的不足，是有效建议而非安慰性措辞。
- Claude Code 的 `SessionStart` matcher 有五个（`startup` `resume` `clear`
  `compact` `fork`），1.1 版只列了三个。
- Claude Code 有 `TaskCreated` / `TaskCompleted` 事件，v0.2 的原生 todo 镜像
  计划成立。
