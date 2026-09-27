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
- **FR-T5** `move <id> --top | --before <id> | --after <id>` 是改 `rank` 的唯一途径；**只重写一个文件**。这条成立的前提是每个任务自创建起就带 rank（FR-T1）：有 rank 与无 rank 混合存在时，相对无 rank 任务的位置大都无解，因为任何任务一旦取得 rank 就会整段排到所有无 rank 任务之前；唯一有解的是「紧贴第一个无 rank 任务之前」（排到有 rank 那段的末尾）。两个邻居之间放不下新的 rank 时，被挪的任务可以与其中一个共用 rank、按 id 分先后（spec §7.4），只要这样正好落在中间。
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
- **FR-C4** actor 解析：`--as` > `TODOPI_ACTOR` > agent 环境推断（`claude-code@<host>`、`codex@<host>` 等；`--agent <name>` / `TODOPI_AGENT` 可显式给出，setup 写出的钩子就这么做，见 D043）> `git config user.name`。actor 标识的是**工作者而非会话**，因此同一机器上同一工具跨会话保持不变——否则续做自己昨天的任务都要先抢占。取自 `git config` 的值按格式规格 §5.4 规范化（这类值常含空格，而 actor 语法禁止空格）。`--as` 同时覆盖写入身份与查询身份，人不必做任何配置就能查看另一个 actor 的工作。
- **FR-C6** 身份有两种匹配方式，由命令是否写入决定。**写入严格匹配**：`note`、`check`、`edit`、`dep`、`move`、`done`、`close`、心跳刷新，以及 `handoff` 追加的笔记，在任务 `assignee` 是另一个 actor 时拒绝（退出码 3），两个工作者因此不会在同一个任务上交错写入。`dep` 与 `move` 是 2026-09-24 补进名单的：它们改写的是被阻塞 / 被挪动的那个任务的文件与 Log，若它正被别人持有就是交错写入。F10 起初按字面名单把它们当规划操作放行，理由是「与 `add --blocked-by` 同类」——这个类比是错的，`add` 写的是一个新任务（见 DECISIONS D030）。**展示宽松匹配**：`ls --mine`、`prime` 和 `handoff` 打印的报告把 assignee 等于当前解析出的 actor **或**以 `@<本机 host>` 结尾的任务都算作「我的」。人在终端上因此能看到自己的 agent 在做什么——这正是这三个命令存在的意义；不需要任何配置，也不需要保存一份 actor 清单。
- **FR-C5** 租约放在 `.git/todopi/leases/`（worktree 间共享）；无 git 时回退到 `.todopi/.cache/leases/`。同一目录承载其余机器本地运行时状态，包括每个会话上次 `prime` 的时间（FR-P1）。会话身份留在这里，永不进入任务文件。

### 7.4 完成定义

- **FR-D1** `check <id> <n>` / `check <id> <n> --undo` 切换第 n 条验收标准并留痕。
- **FR-D2** `done <id>`：若设置了 `verify`，先原样打印将要执行的命令，再在仓库根以配置的超时执行并捕获输出；非零退出则拒绝（退出码 2）。超时**MUST 终止整个进程组**而不只是直接子进程：以独立进程组启动并向进程组发信号。**范围就是那个进程组**——主动调 `setsid(2)` 脱离出去的后代不在保证之内，够到它们要遍历 `ps` 追整棵树，那在跨平台上既不可靠也有竞态（进程可能在被读到之前就已经 fork）。**v0.1 只在 POSIX 上支持 `verify`**：Windows 上 `verify` 明确拒绝并说明原因，而不是尝试一次没测过的 `taskkill /T /F`——一个杀不干净的树终止比明确不支持更糟，它会悄悄留下 worker。这与本文档平台一节「Windows 尽力」一致；早先这里写的是「Windows 上用等价的树终止」，与那一节自相矛盾（见 DECISIONS D026）。实测依据是运行时默认行为只向直接子进程发 SIGTERM，孙进程全部存活——而 `verify` 的典型值（`pnpm test`、`cargo test`）都会 fork worker，默认超时又是 600 秒，被遗弃的 worker 会继续占端口、写文件、烧 CPU，而 todopi 早已退出。任何验收标准未勾选、任何子任务不是 `closed`、或任务归属于另一个 actor（FR-C6），同样拒绝。成功则设为 `closed`/`done`，记录 `done verify=… commit=<HEAD7> dirty=<bool>`，删除租约。
- **FR-D2a** 拒绝时打印一份不需要再跑别的命令就能据以行动的报告——因为这是 agent 唯一能看到的东西，而协议要求它去修活而不是强制通过。报告写明**是哪道门禁拒绝的**及其具体内容：未勾选的验收标准逐条列出序号与文本；未关闭的子任务列出 id、标题与状态；`verify` 列出实际执行的命令、退出码与输出尾部；归属冲突列出持有者及其最近一次写入时间。报告以两条出路结尾——修完重跑 `done`，或 `--force --reason <text>`。不向 Log 追加任何内容：状态没有改变（格式规格 §5.3.3）。agent 想记录学到的东西，用 `note`。
- **FR-D3** `--force --reason <text>` 绕过任何门禁，记录 `forced=true` 与理由；此类任务在列表与看板中标记为「未验证」。**绕过的是「门禁」那次拒绝，不是 `verify` 的执行**：带 `verify` 的任务在 `--force` 下仍然照跑那条命令，失败也关闭，但 Log 记下 `verify=fail` 与输出尾部（FR-D4a）。否则 FR-D4a 说的「证据必须留在 diff 里看得见」永远走不到——被跳过的验证如果压根没跑，就没有任何证据可留。代价是强制时仍要等一遍可能很慢的测试；这是有意的，强制关闭本来就该比正常关闭更贵而不是更便宜。
- **FR-D4** 在某仓库首次执行 `verify` 前要求确认，信任按仓库路径记入 `~/.config/todopi/trust`；`--yes` 或 `CI=true` 跳过提示。信任记录**永不**存在 `.todopi/` 内：随仓库一起传播的信任记录等于让仓库为自己背书。由于 `verify` 是任何写入者都能改的普通任务字段——agent、手工编辑、被合并的 PR——按路径信任并不约束授信之后**执行的是什么**。有两件事收窄这个面：每次执行前原样打印命令，使它永远不会和上次悄悄不同；`handoff` 列出自本 actor 上次 `prime` 以来 `verify` 发生过变更的任务（FR-H1）。按命令内容信任排在 v0.2——届时用户开始接受外部贡献，重复确认的摩擦才换得来对等的收益。
- **FR-D4a** 验证输出的去向由两件事决定：Log 要提交进 git，而 `prime` 有预算。**通过**时不记录输出：命令在 frontmatter 里、commit 在 Log 里，复现所需的一切都已具备。**强制关闭**时记录最后 512 字节（`verify` 照跑、结果被忽略，见 FR-D3），因为被越过的验证正是人必须复查的那一种，证据必须留在 diff 里看得见。**完整输出**一律写入 `.todopi/.cache/verify/`，不提交，可随时删除。
- **FR-D5** `close <id> --resolution wontfix|duplicate|obsolete [--reason]`（短写 `-r`）与 `reopen <id>` 按状态机执行。**`close` 不查验收标准**——spec §6.1 表格里 `close` 那一行只要求子任务全部关闭，而 `close` 正是「不做了」的出口，标准没勾完本来就是它的常态。标志名是 `--resolution` 而不是 `--as`：全局 `--as` 已经表示 actor（FR-C4），两者撞名时 commander 让全局优先，实测 `todopi close tp-1 --as wontfix` 里那个 `--as` 会被 commander 当成全局的 actor 选项，于是 actor 被设成 `"wontfix"` 而 resolution 收不到值。当前实现会因此退出 1（缺 resolution），不会写出坏文件；但按文档原样写的命令根本用不了，而且身份被悄悄改掉了。试过用 `enablePositionalOptions()` 保住原形，但它会让 `todopi ls --json` 报 unknown option，而那是命令参考与协议文本给 agent 的写法。`reopen` 在移除 `resolution` 的同时清除 `assignee`，否则会产出违反格式自身不变量的文件。软删除的 resolution 用 `obsolete` 而不是 `stale`，因为 `stale` 已经用于一个派生状态——租约过期的 in_progress 任务——两者会在同一份列表里并排出现却表示毫不相干的事。

### 7.5 日志

- **FR-L1** `note <id> <text>` 追加一行 Log；支持多行文本。
- **FR-L2** 所有状态变更都按规格语法追加一行 Log；从不改写之前的行。

### 7.6 上下文注入

- **FR-P1** `prime [--budget <tokens>]`（默认 600）**推送「你正在做什么」，指向其余一切**。输出 Markdown：

  1. 调用者正在进行的任务：标题、带状态的验收标准、最近 2 条 Log。**这一段是推送的**。
  2. 一行指针，给出可领任务数、别人持有的任务数（按 FR-C6 不算你的进行中任务——同一台机器上的其他 agent 按 FR-C6 算你的），以及取用它们的命令。

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
- **FR-P1b** `prime` 把调用时间按**会话**记录在 FR-C5 的运行时目录，供 FR-H1 使用。会话标识的可得性于 2026-09-16 核实：Claude Code、Codex、Gemini CLI 在钩子 stdin 里给 `session_id`；Cursor 的钩子载荷同样带会话标识；OpenCode 的事件里 id 在 `properties.info.id`（session.created）或 `properties.sessionID`（session.compacted），由 todopi 生成的插件规范化为 `{"sessionID": …}` 喂给 `--hook`（2026-09-26 按 SDK 类型更正）；pi 不把它传进事件，扩展需调 `ctx.sessionManager.getSessionId()` 自取。六家都拿得到，因此按 actor 记录只是**防御性**回退，不是常态。
- **FR-P2** `prime --json` 以结构化数据输出相同内容。
- **FR-P3** `prime --full` 输出 1.1 版那种全量上下文：当前任务、别人（按 FR-C6 不算你的）
  持有的任务、ready 前 5 条、计数、最近关闭 3 条。它是**给 agent 主动调用的**——
  FR-P1 的指针指向的就是它。默认 `prime` 服务于钩子（每次注入都要付钱），
  `--full` 服务于「我现在确实需要全景」这个明确时刻。不是新子命令，是一个 flag。

### 7.7 交接

- **FR-H1** `handoff` 用 FR-C6 的宽松身份匹配打印，好让人看到自己的 agent 做了什么：最近一小时没有 Log 的进行中任务；自上次 `prime` 以来创建的任务；自那时起 `verify` 命令发生过变更的任务（FR-D4）。随后向**自己是 assignee 的**每个进行中任务追加一条带摘要的 `handoff` Log 并刷新其心跳——写入路径是严格的。它不释放认领。`--check` 只输出报告并以 0 退出（供钩子使用）。

### 7.8 Agent 接入

- **FR-A1** `setup <agent>` 幂等地安装该 agent 的 skill/规则文件与钩子。默认写项目级配置（克隆即用）；`--user` 写用户级。它打印写入的每个文件。同一个 agent 同时装了 `setup` 的钩子与市场包时，`prime --hook` 按会话去重，会话开始只注入一次（D057）。
- **FR-A2** 钩子映射。各家事件名于 2026-09-16 核实（见 §17）。六家都能在**会话开始**注入，但**压缩之后**能否重新注入分成两类，这个差异决定了各家的接入形态：

  | Agent | 会话开始 | 压缩 | 会话结束 | 配置位置 |
  |---|---|---|---|---|
  | Claude Code | `SessionStart`（matcher：`startup` `resume` `clear` `compact` `fork`） | `SessionStart` 的 `compact` 来源（`PostCompact` 存在，但它不在文档列出的「纯文本 stdout 进上下文」事件里；`additionalContext` 是否生效文档不清。见 §17 2026-09-26 重核） | `SessionEnd` | `.claude/settings.json` |
  | Codex | `SessionStart`（`source`：`startup` `resume` `clear` `compact`） | `SessionStart` 的 `compact` 来源（`PostCompact` 也会触发，两个都装会注入两遍；见 §17 2026-09-26 实测） | `SessionEnd` | `.codex/hooks.json`（项目级钩子要在 Codex 里信任后才运行） |
  | OpenCode | `event` 钩子订阅 `session.created`（id 在 `properties.info.id`）；输出经 `experimental.chat.system.transform` 进系统提示 | 同上订阅 `session.compacted`（`properties.sessionID`），刷新缓存 | `session.idle` 兜底（未装） | `.opencode/plugins/` |
  | pi | `session_start`；输出经 `before_agent_start` 追加进系统提示 | **`session_compact`**（压缩后）刷新；`session_before_compact` 是压缩前 | `session_shutdown`（未装） | `.pi/extensions/`（项目要先被信任） |
  | Cursor | `sessionStart`（返回 `additional_context`，进初始系统上下文；会话 id 是 `conversation_id`） | **无 post 事件**；`preCompact` 只能观察。压缩后靠始终生效的规则文件 `.cursor/rules/todopi.mdc`（FR-A2a） | `sessionEnd` | `.cursor/hooks.json`（用户级 `~/.cursor/hooks.json` 在 `~/.cursor/` 里运行，项目目录取载荷的 `workspace_roots`） |
  | Gemini CLI | `SessionStart`（返回 `hookSpecificOutput.additionalContext`） | **无 post 事件**；`PreCompress`（matcher `manual`）打标记，下一轮的 `BeforeAgent` 取走标记、把 prime 追加进这一轮的请求（FR-A2a） | `SessionEnd` | `.gemini/settings.json`（同时确保 `context.fileName` 含 AGENTS.md） |

- **FR-A2a** 无 post-compaction 事件的两家（Cursor、Gemini CLI）：账本指针靠**不会被压缩掉的上下文**与（Gemini）**下一轮前重新注入**活过压缩。1.2 版写的「压缩前把 prime 输出交给待生成的摘要」前提不成立（2026-09-26 核实，§17）：Cursor 的 `preCompact` 文档明言只能观察、不能改压缩；Gemini CLI 的压缩服务丢弃 `PreCompress` 的返回值。改为：
  - **Cursor**：`setup cursor` 写一份 `alwaysApply: true` 的规则文件 `.cursor/rules/todopi.mdc`——指针（`todopi prime`）与「察觉到被压缩就跑 `todopi prime`」始终在上下文里。`beforeSubmitPrompt` 不能注入，所以没有「下一轮前」的钩子可用。
  - **Gemini CLI**：`setup gemini` 让 `context.fileName` 含 AGENTS.md（协议进系统指令，活过压缩）；`PreCompress` 只在 `manual`（`/compress`）时打「刚压缩过」标记，下一轮之前的 `BeforeAgent` 取走标记、把 prime 追加进这一轮的请求。**自动压缩不打标记**：`PreCompress` 在每一次压缩**尝试**时都触发，包括没到阈值、并不压缩的检查（历史非空就每轮一次），据它打标记会让每一轮都重新注入、在历史里越积越多。自动压缩之后靠系统指令里的协议行。手动 `/compress` 判定「不划算」而没压缩时，下一轮会多注入一次，代价是一份 prime。
  协议文本要求 agent 在察觉上下文被压缩后主动跑一次 `todopi prime`，这一条对所有 agent 都写，对这两家是必需的。
- **FR-A2b** Cursor 的 CLI（`cursor-agent`）对钩子的支持一直在变动：2026-01 只有 `beforeShellExecution` / `afterShellExecution` 触发，2026-04 扩展到含 `sessionStart`，官方论坛记录显示仍未与 IDE 完全对齐。因此 Cursor 接入包 MUST 同时提供规则文件作为回退路径，且 MUST 在首发前于 CLI 与 IDE 两种形态下各手工验证一次（MVP 验收第 5 条）。
- **FR-A3** 所有 agent 收到同一份 ≤ 800 token 的说明文本（「协议」，§9）；各家打包只是包装。
- **FR-A4** 接入的**能力**在首发时必须完整：六家各自 `todopi setup <agent>` 一条命令装好，README 给出六家安装说明。市场/注册表上架（Claude Code plugin、Codex plugin、OpenCode plugin、pi package、Cursor、Gemini 扩展）是首发后一周内的跟进动作，**不阻塞发布**。
  改这一条的理由是一个反例：rtk 接入了 17 家 agent，一个市场都没上，全部靠 `rtk init --agent <name>` 就地写配置。市场不是这个品类的必要杠杆，而六家审核周期不可控、单人维护——把它放在关键路径上等于把发布日期交给六个第三方。接入能力不缩水，只是审核不再挡住发布。

### 7.9 本地看板

- **FR-B1** `web [--port 4747] [--open]` 只在 127.0.0.1 提供单页看板。进程在前台运行，随终端退出。
- **FR-B2** 视图：按显示状态分列（open、blocked、in progress、done、closed）、按容器的树、ready 队列；任务抽屉显示验收标准、Log、验证证据。
- **FR-B3** v0.1 的看板**只读**。它被声明的目标是「让人一眼看到 agent 在干什么」，而只读完全满足这个目标。四种写操作——跨列拖拽、勾选验收标准、加 note、拖拽排序——移到 v0.2。它们是贵的那一半：每一种都必须走与 CLI 相同的校验与加锁路径，这会迫使 CLI 的写入路径在实现的第一周就被抽成可复用接口；每一种还都需要一个必须填理由的强制对话框。推迟它们，等于在不触碰首发所依赖的任何东西的前提下，从 v0.1 移除一项架构承诺：看板不承担分发价值，而首发演示是一段终端录屏。
- **FR-B4** 文件变化时页面刷新（目录监听 + SSE）。`fs.watch` 抛错或在 WSL 下（drvfs / 9p 上它不报错但不触发）自动改为轮询；容器挂载卷检测不出来，给 `--poll`（F18，D039）。watch 模式下另有每 5 秒一次的兜底轮询：macOS 的 FSEvents 在高负载下会丢事件。

### 7.10 导入器

- **FR-I1** `import <file.md>`：解析 Markdown checkbox 列表（Superpowers 计划、spec-kit `tasks.md`、OpenSpec `tasks.md`）。标题变容器，条目变子任务，文档顺序变 `rank`，已勾选条目以 `closed/done` 且 `forced=true` 创建（未跑验证）。每个任务记录 `created source=<path>`；按（source，标题）幂等重复导入。「标题」的身份包含父级标题链（同一父级下完全同名的再按出现顺序编号），否则计划里每个 Task 下都有的「Step 1: Write the failing test」只能导进第一个；重复导入不动已有任务（rank、状态都保留），新条目排到最后；分隔线（`---`）结束一级标题以下的小节；没有条目的标题不成任务；标题容器在子项全部勾选时同样建成 `closed/done`（F19，D040）。
- **FR-I2** `import beads [path]`：读取 Beads Classic 的 `issues.jsonl`（默认 `.beads/issues.jsonl`）。映射：priority → rank 顺序；type → label；`blocks` → `blocked_by`；parent-child → `parent`；closed → `closed` 且 `done`（Beads 原因表明放弃时为 `wontfix`）；原 ID 放 `external.beads.id`。Dolt 时代的导出不在范围内。字段以 Beads v0.47.1 为准；tombstone 与 ephemeral 不导入；只有 closed 映射成 closed，其余状态建成 open（迁移不替人认领，原状态进 Log）；`close_reason` 以重复类措辞开头为 `duplicate`、放弃类为 `wontfix`；已关闭的任务**不**标 `forced=true`——来源由 Log 的 `imported source= system=beads` 记下（F20，D041）。

### 7.11 质量与运维

- **FR-Q1** `doctor [--fix]` 检查规格中的所有不变量、冲突标记，对未知键给出警告（不让 doctor 失败，§5.2 是 SHOULD warn）；租约只按**过期**判定——租约目录由所有 worktree 共享，一个在本 checkout 里对不上任务的租约很可能是另一个 worktree 分支上的活认领，「孤儿」在单个 checkout 里判断不了（F13 评审后改，D034）；`--fix` 规范化键顺序、时间戳与 checkbox 语法，按 `created` 顺序回填缺失的 `rank`（FR-T5），并清除过期租约。它**永不修改 Log**，哪怕某一行无法解析也只报告不改写；也**不刷新 `updated`**——那是跨机器的心跳，修复工具刷新它会让所有过期认领看起来又活了（规格 §6.3 的例外，用户 2026-09-26 定）。一个可以被修复工具改写的追加式历史不是证据，而 Log 正是这个产品拿出来当证据的东西。仍有问题则退出码 1。
- **FR-Q2** 退出码：0 成功 · 1 用法/校验错误 · 2 门禁失败（verify/验收标准/子任务）· 3 冲突（租约被占、并发写）· 4 格式版本不支持。
- **FR-Q3** `--json` 的输出结构有文档并随 CLI 版本化；破坏性变更升 CLI 主版本。文档是 `docs/json.md`，与源码类型的一致性由 ARCH-028 检查（D048）。
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
todopi web [--port n] [--open] [--poll]
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
| 性能 | 2,000 个任务的仓库上任何命令在笔记本上 < 200 ms（冷缓存 < 1 s）。`prime` 只在两处超出预算：末尾的指针行永不裁剪，第一个持有任务收紧到底（只剩未勾标准与最新一条 Log）仍装不下时照样输出（FR-P1a，D032）；此时 `--json` 的 `overBudget` 为真。2026-09-16 实测（M 系列 mac，2,000 任务全量扫描）：手写快路径解析 16 ms、通用 YAML 解析器 120 ms、进程启动 10 ms、文件 I/O 20 ms。目标环境含 WSL2、容器挂载卷与网络文件系统，那里 I/O 往返贵一个数量级，余量按最坏环境预留而非按开发机。**可复现的基准**是 `tools/bench/ledger-2000.sh`（F29：按下标确定地生成 2,000 个任务——594 个已关闭、198 个进行中（5 个是 prime 的 actor 的）、296 个有 blocked_by、20 个容器带 990 个子任务，每个 3 条标准、2–6 条 Log——过 doctor，每条命令热身后多次取中位数，含进程启动；CI 里每次都跑、表格进 job summary，不设阈值）。2026-09-28 实测，编译后的 CLI、热缓存，Docker 里的 Linux arm64 虚拟机（宿主 Apple M4 Pro，node 22.23，虚拟机负载 ≈ 2，11 次）：`--version` 23、`ls` 155、`ls --ready` 153、`ls --all` 166、`ls --json` 155、`show` 85、`doctor` 148、`prime` 215（最小 193）、`prime --full` 199 ms；同一台 Mac 原生（node 22.22，宿主负载很高）各项高 10–20%，`prime` ≈ 230。**`prime` 在目标线上下、超出时约 15 ms**：剖析显示为每个任务正文建 CommonMark 结构（≈ 40 ms）与三次 git 子进程（≈ 30 ms）是大头。**F36 之后**（2026-09-28）：prime 的 verify 快照紧跟校验取、复用同一段正文的解析结构，git 公共目录一次运行只问一遍，prime 记录不再 fsync——同机交替对比（M4 Pro，负载高）`prime` 225 → 186 ms、`prime --full` 221 → 188 ms，`ls` 与 `doctor` 不变；基准脚本同机 `prime` 180、`prime --full` 193 ms。冷缓存未测。这些是某一时刻、某种负载下的快照（同一台机器复跑，单项中位数能差出几十 ms），不是承诺；要比较就在同一台机器上前后各跑一次。 |
| 平台 | 支持 macOS 与 Linux；Windows 尽力（CI 跑，失败不阻塞发布）。 |
| 运行时 | npm 包在 Node ≥ 20 上运行，不需要 Bun；brew/curl 提供无运行时依赖的 Bun 编译二进制。源码只用 Node API，Bun 仅作编译器（DECISIONS D006）。实测体积：**npm 装完 1.5 MB**（三个零传递依赖），二进制 61 MB（macOS arm64）/ 90 MB（Linux x64）——体积全部来自内嵌运行时，`--minify` 与 `--bytecode` 均无效。对照：同类中最接近的 Backlog.md 同为 Bun + TypeScript，但因使用 Bun 专属 API 而必须发二进制，其 npm 安装量为 67.5 MB（macOS）/ 96.3 MB（Linux）。**45 倍差距来自「源码只用 Node API」这一条决策**，见 DECISIONS D008。curl 安装器先探测 Node ≥ 20：有则装 npm 包，无则下载二进制。（F21 重测：D031 引入 commonmark 后 npm 装完 3.3 MB、四个直接依赖加 commonmark 带来的三个；二进制 64 MB（macOS arm64）。npm 包由 tsc 逐文件编译到 `dist/`，Node 20.0.0 的干净容器里实测通过，D042。） |
| 安全 | 验证命令仅在按仓库信任后执行，且每次执行前原样打印；看板只绑定回环地址；v0.1 无任何网络访问。文档明确写出：把 `todopi` 加进 agent 的命令白名单**不是**沙箱——`done` 会执行仓库自己的 `verify` 命令，而 agent 的权限检查看不到它。**OS 级沙箱是有效的**：2026-09-16 核实，Claude Code 与 Codex 的沙箱都约束整棵进程树（macOS Seatbelt、Linux bubblewrap+Landlock+seccomp），todopi 派生的 verify 进程继承同一套限制。文档应据此建议：依赖白名单做隔离的用户同时启用 OS 沙箱。 |
| 隐私 | 永不遥测。文档提醒 `.todopi/` 在公开仓库中是公开的。 |
| 兼容 | 格式版本 1；CLI 拒绝写入更新的版本（退出码 4），但仍按版本 1 的规则读它（ls / show / prime / doctor / web 照常，stderr 提示一句；spec §9，D046）。 |
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

- [ ] 格式规格发布在 todopi.com/spec，含 12 字段表 —— 内容与构建已就绪（F33，`make site`，`docs/site.md`）；部署与域名是维护者的动作
- [ ] 30 秒录屏：压缩发生，agent 从 `prime` 继续
- [x] README：六家安装方式、协议、「vs Beads」段落、读音与名字来源（F28，D049）
- [ ] npm `todopi`、brew tap、curl 安装脚本上线；`@todopi` scope 已占 —— 发布工作流、install.sh、brew formula 已就绪（F21、F34）；打标签、NPM_TOKEN、tap 仓库、占名是维护者的动作
- [ ] 六家 `todopi setup <agent>` 在全新克隆上各自验证通过（市场条目不在此清单，见 FR-A4）
- [x] `import beads` 用至少两份真实 Beads Classic 导出测过（Beads 仓库自己的 v0.47.1 导出，加 F32 的六份，D041）
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

实现默认值（除非有异议即按此执行）：6 位 base36 随机 ID；UTC 秒级时间戳；`.todopi/` 只在仓库根；无 git 时租约回退到 `.cache/`；`prime` 的裁剪顺序如 FR-P1/P1a；token 估算按字符类别加权（D032；原「字符数 ÷ 4」经实测对中文低估 2–3 倍，已撤下）；「本会话」= 自本**会话**上次 `prime` 起，agent 不暴露会话 id 时回退为本 actor；阻塞项关闭即解除阻塞而不论 resolution；无硬删除。

**带触发条件的推迟项**，避免「以后再说」变成「一直没做」：

- **跨仓视图**（`ls --all`）留在 v0.3。它需要一份用户级的仓库注册表和带仓库限定的输出，而且服务的是维护者而不是首发：MVP 的五条验收标准没有一条涉及一个以上的仓库。dogfooding 时若发现日常回路确实跨仓库，再重新考虑——最小形态是一个 flag 加一份自动积累的注册表，约半天工作量，且不占 20 个子命令的额度。在那之前 README 给出基于 `-C` 的 shell 循环写法。
- ~~**token 估算方式未定。**~~ 已定（2026-09-26，D032）：按字符类别加权。原文： §15 此前把「字符数 ÷ 4」列为默认值，实测（tiktoken）它对英文准确（0.8–1.1×）而对中文低估 2.0–2.8×。FR-P1 把推送内容从 427 降到约 145 token 之后，这条的危害从「每次注入悄悄多吃 2000 token」降为「截断判据偏松，但实际很少触发截断」——因此不再阻塞，但仍须在实现 `prime` 前定下来。候选：真 tokenizer（准确但只能对准一家的 BPE，且多一个 1.6 MB 的依赖）／按 UTF-8 字节数估算／按字符类别加权（ASCII ÷ 4、CJK × 0.6、其余 ÷ 2，实测中英均在 ±15% 内，零依赖且可测）。倾向第三种。
- **其余五家的规则文件是否在压缩后重读，未核实。** FR-P1 把协议移出 `prime` 的依据是 Claude Code 的官方陈述；Codex、OpenCode、pi、Cursor、Gemini CLI 是否有同样行为需要在做各家接入包时逐一确认。若某家不重读，该家的接入包需要单独把协议放回它的注入点——这是接入包的差异，不是 `prime` 的差异。
- **导入器与 `forced=true` 的相互作用**（FR-I1/I2，本轮未展开）。FR-I1 规定导入时已勾选的条目建成 `closed/done` 且 `forced=true`，而 `forced=true` 在列表与看板中标记为「未验证」（FR-D3）。导入 500 个 Beads 已关闭 issue 会产生 500 个「未验证」标记——语义上没错（确实没验证过），但会把一个本用于警示「有人跳过了验证」的标记变成噪音。另需定义：重复导入（按 source + title 幂等）时 `rank` 保留还是重算，因为 rank 现在于创建时分配（FR-T1）。拆到导入器 feature 时展开。（F19 定：`rank` 保留，已有任务一个字节都不动，见 FR-I1。F20 定：Beads 迁来的已关闭任务不标 `forced=true`，出处记在 `imported` 事件里，不显示为「未验证」——那个标记留给「有人在 todopi 里跳过了门禁」，D041。）
- **裸仓库明确不支持。** 实测裸仓库中 `git rev-parse --git-common-dir` 返回 `.`，租约目录会落在裸仓库内部。规格 §1 定义 `.todopi/` 位于「包含 `.git` 的目录」，而裸仓库没有工作区。应在规格中显式声明不支持，而不是留给实现去猜。（git worktree 场景实测正确：`--git-common-dir` 正确指向共享的 `.git`。）
- **Windows 的原子 rename 是已知风险点。** 原子写是临时文件 + rename，而 Windows 上 rename 覆盖一个被其他进程打开的文件会失败。Windows 是尽力而为（CI 跑但不阻塞发布），但这一条应当是 Windows CI **明确要测**的用例，而不是等用户报告。本条未经实测，仅为推理。
- ~~**FR-C4 的「agent 环境推断」这一级未实现，缺事实依据。**~~ **2026-09-28 已实现（F22，D043）。** 六家的标记都按一手资料核实：
  只认各家运行时给自己**工具子进程**设的变量——Claude Code `CLAUDECODE=1`、Codex `CODEX_THREAD_ID`、Gemini CLI `GEMINI_CLI=1`、
  OpenCode `OPENCODE=1`、pi `PI_SESSION_ID`、Cursor `CURSOR_AGENT=1`——不认 `CODEX_HOME` 这类用户配置。不止一个信号在（嵌套）时分不出哪层在跑，
  不推断。钩子子进程里不一定有这些变量，所以 setup 写出的钩子命令都显式带 `--agent <name>`。原文：「§17 核实六家 agent 时没有记录
  环境变量标记，而实测表明按变量名猜不可靠：`CODEX_HOME` 在一个 Claude Code 会话里同样存在……（见 DECISIONS D014）」
- **`verify` 的完整日志没有大小上限，磁盘是已知风险点。** FR-D4a 要求完整输出一律写入 `.cache/verify/`，实现改成流式落盘之后这一条才真正成立（早先超过 1 MiB 的部分在写盘前就丢了）。代价是：一条疯狂刷屏的 `verify` 在默认 600 秒超时内可以写出几十 GB。没有悄悄加文件上限，因为那等于改契约——「完整输出」就不再完整。缓解在于 `.cache/` 按规格 §2 可随时删除，且 `verify` 本来就有超时。若 dogfooding 期间真的撑爆过磁盘，再把「日志上限」作为一次明确的契约变更提出来，而不是现在偷偷加。本条未经实测，仅为推理。
- **`verify` 命令里含 NUL 字节时 runner 起不来。** 实测：Node 的 `spawn` 拒绝含 NUL 的参数，`runCommand` 于是报「runner 退出 1」而不是一条说得清的错。YAML 标量里几乎不会出现 NUL，所以没有现在修；要修的话应在 `exec/run.ts` 入口处明确拒绝并说明。
- **自举第一天问出来的五条。** 2026-09-23 本仓库从 `feature_list.json` 迁到
  `.todopi/`，用 todopi 管自己。旧 harness 有五件事新流程做不到，逐条列在
  [迁移计划](../plans/2026-09-23-bootstrap.md)的损失表里；其中五条是**产品问题**，
  记在这里：(i) 没有 `reverify` 的对应物——重跑一个已关闭任务的验证会被状态门禁
  拒绝，而 evidence 指错 commit 时确实需要它；(ii) `verify` 只有一个退出码，
  **表达不了某层 `not_applicable`**；(iii) `dirty=true` 该不该成为 `done` 的门禁
  ——现在只记不拦，而旧 harness 拒绝把脏工作区的结果归给 HEAD；(iv) 协议文本
  （FR-Q5 写进 AGENTS.md 的那段）说「`.todopi/` 改动与工作同一 commit」，而 `done`
  必然在代码提交之后，要不要写明这个例外；(v) 拒绝报告该不该带上任务正文里的
  Repair 段——旧 harness 会在失败层当场打印它。这五条都未经产品决策，仅为记录。
- **`show` 看不见未识别小节，而本仓库的任务都有一个。** 2026-09-24 实现 F08 时在真实账本上
  dogfood 发现：自举迁移给每个任务写了 `## Repair` 段（失败时怎么修），而格式规格 §5.3 规定
  未识别的小节「MUST be ignored by readers」，所以 `show` 不显示它。这里没有让 `show` 越过
  规格——读 Repair 继续用 `cat .todopi/tasks/<id>.md`。开放的问题是：Repair 这类「失败时看
  什么」的信息，该不该有一个被识别的位置（第五个 H2，或 `verify` 旁边的字段）。那是格式规格
  的变更，要走 §9 的版本流程，不在这里定。未经产品决策，仅为记录。
  同一次 dogfood 还发现了另一处并**已修**：自举任务的验收判据是散文（`check` 要等 F09），
  而 `show` 起初只显示勾选项，于是整段判据消失了——恰恰是 AGENTS.md 要求 `done` 之前人工核对
  的那段。Acceptance Criteria 是**已识别**的小节，里面的非勾选行 spec §5.3.2 只要求写入者
  原样保留，显示它们不碰文件，所以现在 `show` 把它们作为 `acceptance_notes` 原样显示，不编号、
  不参与门禁。
- **`edit --edit`（$EDITOR）与正文分节编辑未实现。** FR-T4 列了它们，F10 没做：前者是交互式的
  （F07 立过的规矩：绝不阻塞在 TTY 上，agent 在管道里跑命令是常态），后者不在 F10 的验收判据里。
  现在能改的是标题、Description、verify、标签、父任务。自举任务的 Acceptance Criteria 段里那句
  「`check`（F09，尚未实现）」因此还没法用 CLI 改——它是迁移时生成的，F09 之后已经过时。
  **2026-09-28（F24）已补上**：`edit` 的 `--plan`、`--ac-add` / `--ac-set <n>=<text>` / `--ac-rm <n>`，`add` / `edit` 的 `--edit`
  （只在终端里开编辑器，没有终端是用法错误，所以 agent 在管道里仍不会被卡住）；已勾选的标准不能改（D045）。
  上面那句 Acceptance Criteria 段里的散文仍改不了：它不是标准，spec §5.3.2 要求原样保留（D045）。
- **rank 的规格空间比生成器宽。** spec §5.2 允许任何 `[0-9a-z]{1,32}`，而 fractional-indexing 只认它
  自己形状的键。2026-09-24 起 `add` / `move` 都能处理规格合法的任意 rank（先用库，不行就在规格空间上取中点），
  只在真的无解时拒绝。但手写的非库形状 rank 会让之后的插入走效率较差的中点算法；F13 `doctor --fix` 回填或
  规范化 rank 时，应当生成库形状的键。另外 spec §7.4 说「新值总能通过追加字符插进两个已有值之间」，这句
  不完全成立（`"a"` 与 `"a0"` 之间没有任何字符串），下一次规格修订时应当改准。
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
（2026-09-26：这条替代路径的前提不成立——两家的压缩前钩子都不能改摘要。见下方 F17 实测与改写后的 FR-A2a。）

### 2026-09-26 重核（F14 `setup claude`）

- Claude Code 的 `PostCompact` **存在**（官方 hooks 文档的事件表里有，输入含 `compaction_trigger`）。但文档
  明确列出「纯文本 stdout 作为上下文加给 Claude」的事件只有 `UserPromptSubmit`、`UserPromptExpansion`、
  `SessionStart`、`PostModelSwitch`，**不含 `PostCompact`**；它的 `additionalContext` 是否进上下文，文档表述
  不清。压缩后重新注入因此走 `SessionStart`：它在压缩后以 `compact` 来源再触发一次，stdout 进上下文，
  这一点文档写得明确。`setup claude` 只装 `SessionStart`（不设 matcher，覆盖全部来源）与 `SessionEnd`。
- 钩子的 stdin JSON 在所有事件上都带 `session_id`；`$CLAUDE_PROJECT_DIR` 对钩子命令可用。
- Claude Code 在**没有** CLAUDE.md 时会读 AGENTS.md（较新版本）；两者都在时只读 CLAUDE.md。所以 FR-Q5a
  的 `@AGENTS.md` 导入仍然需要——多数仓库已有 CLAUDE.md。
- 过程记录：一个查文档的子 agent 报告「`PostCompact` 不存在」，直接查官方页面发现它错了；外部事实以一手
  文档为准。
- **实测**（Claude Code 2.1.281，临时仓库，`setup claude` 装的钩子）：无头 `claude -p` 会话开始时原样收到
  prime 的 `## tp-…` 行；交互式会话里执行 `/compact` 后触发 `SessionStart`（`source: compact`），会话里能
  原样引出注入的那一行；`/exit` 触发 `SessionEnd`（`reason: prompt_input_exit`）。三次调用的 stdin 都带同一个
  `session_id`。无头 `-p` 模式下的 `/compact` 没有触发 `compact` 来源——要验证压缩后注入，得用交互式会话。

### 2026-09-26 实测（F15 `setup codex / opencode`）

- **Codex 0.157.1**：钩子结构与 Claude Code 同构（`.codex/hooks.json`，`hooks → 事件 → matcher 组 → handlers`）。
  项目级钩子要在 Codex 里**信任**后才运行：启动时提示「Hooks need review」，可在 `/hooks` 审核；无头 `codex exec`
  不会替你批准。SessionStart 在**第一轮对话前**触发（不是打开界面时）。`/compact` 之后 `PostCompact` 立即触发，
  `SessionStart`（`source: compact`）在下一轮前触发——两个都装会注入两遍。标记法验证（压缩前往任务里记一个新
  标记，压缩后问模型）：只装 SessionStart 时，压缩后新标记照样被原样引出。钩子命令用的 PATH 不是启动 Codex
  那个 shell 里 export 的——`todopi` 必须在用户的常规 PATH 上（全局安装）。
- **OpenCode 1.18.15**：插件放 `.opencode/plugins/`，启动时自动加载。`event` 钩子只能观察，不能注入；插件 SDK
  （@opencode-ai/plugin 1.14.29 的类型）里能改模型输入的是 `experimental.chat.system.transform`（追加系统提示）
  与 `experimental.session.compacting`（压缩前往摘要里加上下文）。`session.created` 的会话 id 在
  `properties.info.id`，`session.compacted` 在 `properties.sessionID`。实测：插件在 created 时跑 prime、经系统提示
  注入，`opencode run`（免费模型 big-pickle）能引出 `## tp-…` 那一行，模型也说明它来自「追加到系统提示的
  todopi prime 输出」。**压缩后的注入没有实测**：免费模型不能用于压缩（「free tier can only be used from within
  OpenCode」），本机另外两个 provider 的凭据不可用。

### 2026-09-27 实测（tp-1ssqrw：OpenCode 压缩后注入）

- **OpenCode 1.18.32**，用 `opencode.json` 的自定义 provider（`@ai-sdk/openai-compatible`，`baseURL` 指向本地假服务器
  `tools/probes/openai-fake-api.mjs`，记录每个请求体）绕开凭据：事件、插件加载、压缩、系统提示的组装走的都是 OpenCode 的真实代码路径，
  只有模型是假的（与 F17 的假 Gemini API 同一个思路：看请求体，不靠模型回答——它只回一句固定的话，不像 D037 的 echo provider 那样回显）。
- 无头 `opencode run`：会话开始时插件跑 prime（按会话的 prime 记录，01:00:13Z），当时看到的请求体系统提示里有 `## tp-…`；那一轮的请求日志
  后来被交互式实验的清空覆盖了，没有留存。（`opencode run` 的 stdin 不是终端时要接 `/dev/null`，否则一直等输入、不发请求。）
- 交互式：说一句 → 往任务里记一条 MARKER（01:02:13Z）→ `/compact` → 再说一句。能区分「压缩触发了重跑」与别的解释的证据：
  压缩本身的摘要请求（01:02:23.25 发出，在 MARKER 之后、经过同一个 `system.transform`）系统提示里**没有** MARKER——插件读的是缓存，
  不是每轮都重跑；缓存是没有过期的 Map；按会话的 prime 记录 `primed_at` 是 01:02:23Z，落在压缩窗口里（01:02:23.25–.42）、早于压缩后
  那一轮（01:02:42.7），之后没再被覆盖——不是下一轮懒加载补跑的。压缩后的第一个请求里**有** MARKER。`session.compacted` 这个事件本身
  没有直接观察到，是从这几条推断的。

### 2026-09-26 实测（F16 `setup pi`）

- **pi 0.84.0**（包内 docs/extensions.md 与类型定义为一手来源）：项目本地扩展放 `.pi/extensions/*.ts`（jiti 加载，TS 不用编译），
  用户级 `~/.pi/agent/extensions/`；项目本地扩展要在项目被**信任**后才加载（`pi -a` 只对本次运行信任）。`before_agent_start`
  可以返回新的 `systemPrompt`（本轮有效、不写进会话）；会话 id 由 `ctx.sessionManager.getSessionId()` 取；`pi.exec` 没有
  stdin 选项，子进程 stdin 是 `ignore`。
- 本机 pi 没有登录任何模型 provider，环境里也没有 API key。改用**测试专用的扩展注册一个 echo provider**（模型把收到的
  系统提示里 `## tp-` 开头与含 MARKER 的行原样回答），在真实 pi 运行时里验证：会话开始时扩展调用
  `todopi prime --hook --session <id>`、输出进了系统提示；交互式 `/compact`（测试仓库把 `compaction.keepRecentTokens` 调成
  10）之后扩展用同一个会话 id 再调 prime，下一轮系统提示里出现了压缩前刚记下的新标记。模型是假的，但事件、扩展加载、
  系统提示注入走的都是 pi 的真实代码路径；真模型读系统提示是 provider 的事，不在 todopi 的边界内。

### 2026-09-26 实测（F17 `setup cursor / gemini`）

- **FR-A2a 的前提不成立**，已改写。Cursor 官方 hooks 文档：`preCompact`「is an observational hook that cannot block or
  modify the compaction behavior」，输出只有 `user_message`；`beforeSubmitPrompt` 只能放行或拦截，不能注入；没有压缩后事件。
  `sessionStart` 的 `additional_context` 进「the conversation's initial system context」。公共输入字段含 `conversation_id`、
  `workspace_roots`；项目级钩子在项目根运行，**用户级钩子在 `~/.cursor/` 里运行**——所以 `--hook` 在没用 `-C` 时按
  载荷的 `workspace_roots[0]` 找账本。
- **Gemini CLI 0.26.0**（本机安装，源码为一手来源）：钩子结构与 Claude Code 同构；注入字段 `hookSpecificOutput.additionalContext`。
  `SessionStart` 的注入成为历史里的一条用户消息（会被压缩掉）；`BeforeAgent` 的注入追加在这一轮用户消息之后；
  `PreCompress` 的返回值不被使用；它在 `ChatCompressionService.compress` 里、阈值检查**之前**触发，trigger 为 `manual`
  （`/compress`）或 `auto`；对 PreCompress，组的 matcher 与 trigger **精确比较**。`BeforeAgent` 在每轮开头触发，早于这一轮的
  自动压缩。上下文文件默认只有 GEMINI.md，`context.fileName` 可改；上下文文件进系统指令。0.61.0（当前最新，npm 包源码
  核对，未实跑）这几点相同。
- **实测**（Gemini CLI 0.26.0，交互式，`GOOGLE_GEMINI_BASE_URL` 指向本地假 API 服务器、记录每个请求体；模型是假的，
  钩子、压缩、请求组装走的都是 Gemini 的真实代码路径）：第一轮请求里 SessionStart 注入的 `## tp-…` 是一条独立的用户消息，
  系统指令里含 AGENTS.md 的协议段（含「You notice your context was compacted → `todopi prime`」）；`/compress` 真压缩后
  （50000 → 299 tokens）那条注入被摘要替掉，下一轮请求在用户消息之后出现 BeforeAgent 追加的 prime；再下一轮不再注入，
  标记已消费。另见：token 数太小时 `/compress` 报「Compression was not beneficial」但 PreCompress 照样触发。
  假服务器与复现步骤在 `tools/probes/gemini-fake-api.mjs`（不是门禁：`/compress` 要交互式终端）。
- **Cursor 未实测**：`cursor-agent status` 显示已登录，但无头 `-p` 报「Authentication required」，交互式要求浏览器登录。
  CLI 与 IDE 的手工验证（FR-A2b）拆到单独的任务。

### 顺带确认

- **沙箱约束整棵进程树**（Claude Code、Codex 均已确认），所以 README 建议用户
  以 OS 沙箱补白名单的不足，是有效建议而非安慰性措辞。
- Claude Code 的 `SessionStart` matcher 有五个（`startup` `resume` `clear`
  `compact` `fork`），1.1 版只列了三个。
- Claude Code 有 `TaskCreated` / `TaskCompleted` 事件，v0.2 的原生 todo 镜像
  计划成立。
