# todopi — 面向 AI Coding Agent 的任务账本：需求头脑风暴

日期：2026-09-14
状态：v3，30 项决策已于 2026-09-14 确认（见 §10），需求讨论收口

---

## 0. 一句话

**todopi 是 coding agent 的持久任务账本（durable task ledger）**：一个存在仓库里、git 原生、纯文件、无守护进程的任务图，让 Claude Code / Codex / OpenCode / pi / Cursor 等任何 agent 在跨会话、跨压缩（compaction）、跨机器、跨 agent 的情况下都知道「做到哪了、下一步做什么、什么算做完」。

它不是又一个塞进上下文里的 checklist，也不是 orchestrator，更不是给人用的 Jira。

名字来源：中文「土豆皮」。与 pi coding agent 无关，文案里不蹭 pi；pi 接入和其他 agent 一样正常做。CLI 主命令 `todopi`，短别名 `tp`，ID 前缀 `tp-`。

---

## 1. 为什么现在做（调研结论）

### 1.1 各家 agent 正在把内建 todo 工具「关掉」

| Agent | 内建机制 | 2026 年现状 |
|---|---|---|
| Claude Code | `TodoWrite` → `TaskCreate/TaskUpdate/TaskList`（存 `~/.claude/tasks/`，不在仓库里） | v2.1.268 起对 Opus 4.8 / Sonnet 5 / Fable 5 等新模型**默认不暴露**，理由是「新模型不需要写下来的 todo 也能跟踪多步工作」 |
| Codex CLI | `update_plan` | 0.152.0（2026-09-02）起**默认关闭** |
| OpenCode | `todowrite/todoread` | V2 已**移除**，issue 标为 not planned，官方建议「用普通文件」 |
| Gemini CLI | `write_todos` | 对 Gemini 3 关闭，称其「净负面」 |
| pi | 无 | 作者明确「to-do 工具让模型更困惑」，建议用 `TODO.md` |
| Copilot CLI | plan.md | 会话结束即清空 |

结论：厂商正在收敛到「模型在脑子里规划，**持久状态属于文件**」。留下的空位恰恰是一个跨 agent 的、放在仓库里的持久任务层。

### 1.2 上下文压缩会丢计划

Anthropic 长任务 harness 文章、OpenAI harness engineering、Ralph loop、以及大量开发者的抱怨（「compact 之后忘了 CLAUDE.md、重做已完成的工作、无限重试」）指向同一个结论：只有磁盘上的产物能可靠地活过压缩。业界已经收敛出的模式是：

- `feature_list.json` / `prd.json`（结构化、只改一个字段）+ `progress.txt`（追加式笔记）
- 会话开始时的启动协议：读 git log → 读进度 → 挑最高优先级未完成项 → 做一件事 → 提交 + 更新进度
- 把「完成条件」写在开始之前；模型给自己打分过于宽松，需要外部验证

### 1.3 同类产品：方向已被验证，但没人做对「轻」

| 产品 | 形态 | 亮点 | 问题 |
|---|---|---|---|
| Beads (`bd`, 27k★) | 仓库内任务图，Dolt 存储 | `ready` / `claim` / `prime` / hash ID / 依赖图是正确抽象 | 迁到 Dolt 后大量用户反馈「不可用」；daemon、多仓 hub、100+ 子命令，「比我想要的多太多」；催生了一批「只要 Beads 20% 功能」的克隆（ticket、Beans、Trekker、tkr、beads_rust） |
| Backlog.md (6.7k★) | 每任务一个 Markdown + TUI/Web 看板 | 格式稳定可读，验收标准/DoD 字段，人机都能看 | 无 `ready` 式图查询，无 prime/压缩钩子，无记忆概念 |
| Task Master / Hamster (28k★) | `tasks.json` + 36 个 MCP 工具 | PRD 拆解 | 工具定义约 21k token；依赖付费模型调用；单 JSON 文件易冲突 |
| Vibe Kanban (28k★) | 本地看板 + worktree 跑 agent | 体验好 | 公司 2026-04 关停：「绝大多数是免费用户，找不到商业模式」 |
| spec-kit / OpenSpec / Superpowers / GSD | 规格驱动开发 | 规划阶段抓住误解 | 「任务」只是 checkbox，无 ID、无依赖、无「我在哪」的视图，token 消耗大 |
| Linear / GitHub Issues / Hiveship | 云端 tracker + agent 能力 | 团队可见性 | 不在 git 里，网络依赖，JSON 重，没有 agent 视角的 ready 队列 |

**没人做好的事（机会）：**
1. 一个跨 agent 的统一任务面（每家 agent 各有一套临时 todo，外部 tracker 又要为每家写插件）
2. 把「活过压缩 / 会话 / 交接」做成第一等特性并有 agent 无关的协议
3. 规格 → 任务 → 提交/PR → 验证结果 的链路
4. 用验证（命令 / 测试）而不是 agent 自述来判定「完成」
5. 「简单但有图」：稳定的文件格式 + 小的图引擎，生命周期不每周变
6. 按 token 预算投喂上下文（该步需要什么就返回什么，关闭项压缩）

### 1.4 集成面：CLI 优先，MCP 只做可选适配

多项评测显示同一任务 CLI 消耗 ~1.4k token、MCP ~44k；pi 干脆不支持 MCP；Claude Code 现在默认延迟加载 MCP schema。稳健性排序：

1. **CLI + 一份 ≤800 token 的 README/SKILL.md**：所有 agent 都有 bash，成本最低
2. **Skill（Agent Skills 规范）**：空闲时 ~100 token，26+ 家工具支持，作为触发/发现层
3. **Hooks**：杠杆最大但每家配置不同，需要 `todopi setup <agent>` 安装器
4. **MCP**：≤5 个工具，仅给没有 shell 的 GUI 客户端

---

## 2. 产品定位

### 2.1 目标用户（按优先级）

1. **主要：独立开发者 / 小团队，同时用 1–3 个 coding agent**，经常跨会话、跨天、跨工具（今天 Claude Code，明天 Codex）做同一个项目。痛点：agent 失忆、压缩丢计划、自称完成但没验证。
2. **次要：跑 Ralph 式自主循环或并行 worktree 的高级用户**。痛点：需要一个可原子认领的 ready 队列和可验证的完成条件。
3. **暂不服务：20–30 个并行 agent 的「工厂」场景**（Gas Town / Gas City 的领域），也不服务纯人类项目管理。

### 2.2 设计原则

1. **文件即数据库**：`.todopi/` 目录，纯文本，进 git，diff 可读，PR 里能看
2. **无守护进程、无服务器、无数据库、无 API key、无自动 git**：`todopi` 永远不调用 LLM，也永远不执行 git 写操作；任务文件随 agent 的代码提交一起进历史，SKILL.md 要求提交时带上 `.todopi/`
3. **CLI 是唯一写入者**：agent 不直接编辑文件；字段校验在 CLI；写入原子（临时文件 + rename + 文件锁）
4. **对 agent 宽容**：实现 agent 会「猜」的用法（`todopi done`、`todopi finish`、`todopi close` 都行），坏输入不丢数据，`--json` 无处不在，退出码稳定
5. **对 token 吝啬**：默认输出短；`prime` 有硬上限；关闭项默认折叠
6. **完成需要证据**：任务可以带验证命令；`done` 会跑它
7. **格式先于功能**：文件格式有版本号并公开规格，第三方可以不用我们的 CLI 也能读写
8. **补充而非替代原生工具**：粒度与时机规则见 §4.1 F；对原生 todo 只要求不要复制 todopi 里的任务
9. **永不遥测**：不收集任何使用数据，没有接收端；用量信号只看 npm 下载和 GitHub

### 2.3 不做的事

- 不运行 agent、不管理 worktree（Vibe Kanban / Conductor 的活）
- 不做人类团队的完整项目管理（Linear 的活）
- 不做 Dolt / SQL server / 多仓 hub 同步
- 不做云端服务（MVP 阶段）；本地 Web 看板在 MVP 内，见 §4.1 I

---

## 3. 产品形态

### 3.1 交付物

| 层 | 内容 |
|---|---|
| 核心 | 单个 CLI `todopi`（别名 `tp`），TypeScript + Bun 编译单文件；npm / brew / curl 安装 |
| 看板 | `todopi web`：本地 Web 看板，CLI 内置静态页面，读写同一份 `.todopi/` |
| 数据 | 仓库内 `.todopi/` 目录（见 §5） |
| Agent 接入包 | `todopi setup claude|codex|opencode|pi|cursor|gemini`：安装 SKILL.md、AGENTS.md/CLAUDE.md 片段、SessionStart / compact / Stop 钩子 |
| 生态包 | Claude Code plugin、pi package（npm）、OpenCode plugin、Codex skill；可选的 ≤5 工具 MCP server |
| 站点 | todopi.com：文档 + 格式规格 + 安装；英文为主，中文页补充 |

### 3.2 安装体验（目标）

```
npx todopi init          # 创建 .todopi/，写入 agent 说明
todopi setup claude      # 装 skill + hooks，一条命令
```

之后 agent 在任何会话开始时自动收到 `todopi prime` 的输出。

### 3.3 仓库结构（monorepo，`seandong/todopi`）

```
todopi/
├── packages/
│   ├── cli/              # todopi 核心：格式解析、图引擎、命令；Bun 编译产物发 npm `todopi`
│   ├── web/              # 本地看板前端，构建后内嵌进 CLI
│   └── integrations/
│       ├── claude-code/  # plugin：skill + hooks
│       ├── codex/        # skill + hooks
│       ├── opencode/     # plugin
│       ├── pi/           # package
│       ├── cursor/       # 规则文件 + 命令
│       └── gemini/       # 扩展
├── spec/                 # .todopi/ 文件格式规格（带版本号，独立于实现）
└── docs/                 # 设计/需求文档（中文）
```

官网留在 `todopi.com` 仓库；产品首页上线时替换其域名出售页，`/triprec/privacy` 等路径保持不变。

---

## 4. 功能需求

### 4.1 MVP（v0.1，目标：一个 agent、一个人、多会话跑通，人能在看板上看到进展）

**A. 任务 CRUD**
- `todopi add "标题" [-d 描述] [--parent ID] [--blocked-by ID,...] [--label x] [--ac "验收标准"] [--verify "命令"]`
- `todopi ls [--open|--closed] [--ready] [--blocked] [--mine] [--label x] [--json]`
- `todopi show ID`、`todopi edit ID ...`
- `todopi done ID [--evidence "..."]`（= 关闭且 resolution 为 done，触发 verify）
- `todopi close ID --as wontfix|duplicate|stale [--reason "..."]`、`todopi reopen ID`
- `todopi move ID --top|--before X|--after X`：唯一能改 `rank` 的途径
- 没有优先级字段：排序只由依赖、`rank`、创建时间决定（见 §5.3）

**B. 依赖图**
- `todopi dep add B --on A`（B 被 A 阻塞）、`todopi dep rm`
- 只有两种关系：`parent`（树）和 `blocked_by`（图）。反向关系（children、blocks）推导得出
- 「做 A 时发现 B」不作为关系，`add --from A` 会在 B 的日志里写一行来源，prime 可据此追溯
- `todopi ls --ready`（别名 `todopi ready`）：可认领 = 无子任务 ∧ 所有 blocked_by 已关闭 ∧（status 为 open，或 status 为 in_progress 但已 stale）。stale 判定：本机有租约则看租约心跳；本机无租约（另一台机器、新克隆）则看 `updated` 距今是否超过租约时长。stale 项在输出里标记。按 rank → created 排序。这是 agent 最常用的查询
- `todopi ls --blocked`、`todopi show ID --tree`
- 环检测

**C. 认领 / 租约**
- `todopi claim ID [--as actor]`：原子。两处写入：任务文件里 `status: in_progress` + `assignee`（进 git，跨机器可见）；租约（actor、时间、心跳）写在 `.git/todopi/leases/`，所有 worktree 共享且不提交
- `todopi release ID`：清租约，status 回到 open，assignee 清空（历史在 Log）
- 任何写操作（note / check / edit）同时刷新本机租约心跳和文件里的 `updated`，后者是跨机器的心跳
- 过期（默认 2h 无心跳）的 in_progress 任务在 `ready` 里视为可认领并标记 stale；`todopi claim --steal` 记录一行日志

**D. 完成条件（Definition of Done）**
- `--ac` 多条验收标准（checkbox），`todopi check ID 1`
- `--verify "npm test -- foo"`：`done` 时执行，失败则拒绝关闭（可 `--force` 并记录）
- `done` 时 AC 有未勾选项同样拒绝；父任务有未关闭子任务时拒绝关闭、不级联。三条门禁同一造型：拒绝 → `--force --reason` → Log 留痕 → `ls` 标记未验证
- 完成时记录证据：验证输出摘要、当前 commit SHA
- 安全：首次在某仓库执行 verify 前要求确认，信任按仓库路径记在 `~/.config/todopi/trust`；`--yes` 或 CI 环境变量跳过；命令在仓库根执行，默认 10 分钟超时

**E. 每任务日志（对抗压缩陷阱）**
- `todopi note ID "尝试了 X，因为 Y 失败"`：追加式、带时间和 actor
- `show` 默认显示最近 5 条并给出总条数，`--full` 看全部

**F. 上下文注入**
- `todopi prime [--budget 1500]`：输出 ≤ 预算 token 的摘要：当前认领的任务及其 AC、ready 队列前 N、最近决策、待办总数。供 SessionStart / post-compact 钩子使用
- `todopi handoff`：会话收尾仪式——提示未记笔记的任务、刷新心跳（**不释放**，释放靠显式 `release` 或过期）、**列出本会话由 agent 新建的任务供人过目**（定义：当前 actor 自上次 `prime` 以来创建的）、生成一段交接摘要写入当前任务 note
- **边界规则（写在 SKILL.md，代码不管）**：
  - 粒度：一个 todopi 任务约等于一次值得提交的改动，有可验证的结果；改一个文件、跑一次测试不是任务
  - 时机：会话开始读 `prime`，动手前 `claim`，发现新工作 `add --from 当前任务`，踩坑后 `note`，完成 `done`，收尾 `handoff`
  - 对 agent 原生 todo 只有一条：不要把 todopi 里的任务复制进去；一轮内的微计划随它
  - 规则靠 dogfooding 调整，不靠事前限制

**G. Agent 接入**
- `todopi setup <agent>`：
  - Claude Code：SKILL.md + `SessionStart(startup|resume|compact)` 钩子调用 `prime`，`SessionEnd` 钩子调用 `handoff --check`（Stop 每轮都触发，太吵，不用）
  - Codex：skill + `SessionStart` / `PostCompact` 钩子
  - OpenCode：plugin，`session.compacted` 事件注入 prime
  - pi：extension，`session_start` / `session_before_compact` 事件
  - Cursor：规则文件 + 命令；Gemini CLI：扩展
  - 首发时六家接入包全部发布到各自的市场/注册表（Claude Code plugin marketplace、Codex 插件、OpenCode 插件目录、pi 包注册表、Cursor、Gemini 扩展），市场即分发
- 所有 agent 共享一份 ≤800 token 的 `AGENTS.md` 片段：什么时候用、怎么用、不要直接编辑 `.todopi/`
- `setup` 默认写项目级配置并提示写了哪些文件，`--user` 切到用户级；生成的 hook 只调用 `todopi prime` / `todopi handoff --check`，不含其他逻辑
- actor 解析顺序：`--as` > `TODOPI_ACTOR` > 各 agent 会话环境变量推断（如 `claude-code@host`）> `git config user.name`；人和 agent 用同一个 `assignee` 字段

**I. 本地 Web 看板**
- `todopi web [--port 4747] [--open]`：CLI 内置 HTTP 服务，只绑定 127.0.0.1，单页静态前端，无外部依赖、无账号（6420 是 Backlog.md 的端口，避开）
- 视图：按状态分列的看板、按 epic 的树、ready 队列；点开任务显示 AC、日志、验证证据
- 写操作限于四种：拖拽改状态、勾选 AC、加 note、拖拽排序（对应 `move`，是 rank 的天然 UI）；建任务、改依赖、编辑正文仍走 CLI；全部走与 CLI 相同的写入路径（同一套校验和文件锁）
- 文件变化时页面自动刷新（监听 `.todopi/`）
- 目标：给人「看一眼 agent 在干什么」，不是项目管理工具

**J. 导入器（首发必备，服务分发）**
- `todopi import plan.md`：把 Superpowers / spec-kit / OpenSpec 的 checkbox 计划转成带 ID 的任务，标题层级映射为 parent，顺序映射为 rank，回填 `source` 指向计划文件；重复导入按 source + 标题幂等
- `todopi import beads [issues.jsonl]`：Beads Classic 导出映射为任务：priority 映射为 rank 顺序，type 映射为 labels，blocks 映射为 blocked_by，parent-child 映射为 parent，closed 状态映射为 closed + resolution；ID 保留在 `external.beads`
- 两者都是纯解析，不联网

**H. 工程质量**
- `--json` 输出 schema 稳定；退出码：0 成功 / 1 用户错误 / 2 验证失败 / 3 冲突
- `todopi doctor [--fix]`：检查格式版本、损坏文件、悬空依赖、合并冲突标记、非法状态；`--fix` 修复轻微格式错误
- 同一任务文件在两个分支被改的合并冲突：MVP 接受手工解决，doctor 检测冲突标记；v0.2 提供 git merge driver（frontmatter 按规则合并，Log 按时间并集）
- MVP 子命令清单（20 个）：init, setup, add, ls, show, edit, done, close, reopen, move, dep, claim, release, note, check, prime, handoff, web, doctor, import；ready/blocked/tree 是 ls/show 的选项或别名，别名不计数

**MVP 验收标准**
1. 本仓库用 todopi 管理自己的开发，跨至少 3 个会话、Claude Code 与 Codex 两种 agent 不丢进度
2. `todopi prime` 输出实测不超过 1500 token
3. 从零安装到第一个任务可认领不超过 2 分钟

### 4.2 v0.2（多 agent 与规划链路）

- **原生 todo 镜像**：Claude Code `TaskCreated/TaskCompleted` 钩子把原生任务同步进 todopi；OpenCode plugin 双向同步（参考 opencode-beads）
- **提交/PR 关联**：commit message 含 `tp-a1b2c3` 自动关联；`todopi link ID --pr 12`
- **Linear 单向推送**：todopi 是事实来源，`todopi sync linear` 把任务、状态、日志镜像成 Linear issue 与评论供人查看；Linear 侧的修改不回拉，priority 等字段透传保存在 `external.linear`。GitHub Issues 排在 Linear 之后
- **并行 worktree**：每个 worktree 的认领互斥；合并时 file-per-task 天然少冲突
- **`todopi remember`**：项目级记忆条目（决策、约束），进 `prime`
- **git merge driver**：`init` 写入 `.gitattributes`，合并 `.todopi/tasks/*.md` 时自动处理
- **MCP 薄适配**：≤5 个工具，仅给没有 shell 的 GUI 客户端

### 4.3 v0.3+（可选 / 商业化相关）

- 跨仓视图：`todopi ls --all`（我在所有项目里的下一步）
- 托管只读看板 / 同步（见 §7）
- Linear / GitHub Issues 双向同步
- 度量：任务完成率、返工率、每任务 token/成本归因（如果 agent 提供）

---

## 5. 数据模型与存储

### 5.1 目录

```
.todopi/
├── config.yml            # 格式版本、ID 前缀、默认租约时长
├── tasks/
│   ├── tp-a1b2c3.md        # 每任务一个文件
│   └── tp-c3d4ef.md
├── memory/               # v0.2：决策 / 约束
└── .cache/               # gitignore：索引，可随时重建
```

### 5.2 任务文件

```markdown
---
id: tp-a1b2c3
title: 让 /login 支持 passkey
status: in_progress        # open | in_progress | closed
assignee: claude-code@macbook
parent: tp-9f00k2
blocked_by: [tp-7c21xx]
rank: a0m                  # 可选，只由 move 命令写
verify: "pnpm test -- login"
labels: [bug]
created: 2026-09-14T09:00:00Z
updated: 2026-09-14T10:12:00Z
---

## Description
…

## Acceptance Criteria
- [x] 已有 passkey 的用户能登录
- [ ] 失败三次后回退到密码

## Log
- 2026-09-14T09:00Z sean: created (discovered while working on tp-9f00k2)
- 2026-09-14T10:12Z claude-code@macbook: claimed
- 2026-09-14T10:20Z claude-code@macbook: note: webauthn-lib 1.x 与 Node 22 不兼容，改用 2.x
```

**字段取舍的判据**：一个字段能进 frontmatter，当且仅当有命令或状态转换读它，且它不能从别的字段或 git 推出来。按此判据：

| 字段 | 必填 | 谁读它 | 备注 |
|---|---|---|---|
| `id` | 是 | 一切 | hash ID，避免并发创建冲突 |
| `title` | 是 | ls / prime / 看板 | |
| `status` | 是 | ready / 状态机 | 只有三个值 |
| `created` | 是 | 排序 | |
| `updated` | 是 | 看板「最近活动」、prime | 未提交前 git 给不出 |
| `resolution` | closed 时 | verify 门禁、统计 | done / wontfix / duplicate / stale |
| `assignee` | 否 | ready（排除）、mine | 人和 agent 同一字段 |
| `parent` | 否 | tree / ready（有子任务者不进队列） | children 反推 |
| `blocked_by` | 否 | ready / blocked / 环检测 | blocks 反推 |
| `rank` | 否 | 排序 | LexoRank 式字符串，仅 `move` 可写 |
| `verify` | 否 | done | 命令字符串 |
| `labels` | 否 | ls --label | 自由标签，替代 type |
| `external` | 否 | sync | 如 `external.linear: {id, url, priority}` 透传 |
| `x-*` | 否 | 无 | 第三方扩展，CLI 原样保留 |

**被判据砍掉的字段**：`priority`（agent 可写会通胀，排序已由依赖 + rank + 时间承担）、`type`（epic 由有子任务推出，bug 是标签，decision 属于 memory）、`discovered_from`（无命令读，改为日志一行）、`blocks`（反向推导）、`claimed_at`（属于租约，不进 git）。

设计理由：
- **每任务一个文件**：并行 agent / 多分支时冲突面最小（Beads 的单 JSONL 是它痛点之一）
- **YAML frontmatter 放状态字段、Markdown 放正文**：机器字段结构化（Anthropic 观察：模型更不容易乱改结构化字段），人类可读
- **Log 追加式**：状态变更事件写在任务自己的 Log 分节，不设集中式事件文件，避免多分支合并冲突；压缩后可还原因果链

### 5.3 状态机（已定）

存储三个状态，显示五个：

| 存储 | 显示 | 进入方式 |
|---|---|---|
| `open` | open | add / reopen / release |
| `open` 且有未关闭的 `blocked_by` | blocked（推导） | 依赖变化自动 |
| `in_progress` | in progress | claim |
| `closed` + `resolution: done` | done | `done`（verify 通过或 `--force` 留痕） |
| `closed` + 其他 resolution | closed | `close --as wontfix\|duplicate\|stale` |

规则：
- 只有 5 条转换：open→in_progress（claim）、in_progress→open（release）、open/in_progress→closed（done/close）、closed→open（reopen）、以及依赖变化引起的 blocked 推导
- 每次转换在任务 Log 追加一行：时间、actor、动作、理由
- 写入路径：文件锁 → 读当前文件 → 校验不变量（状态合法、依赖存在且无环、parent 非自身）→ 写临时文件 → rename
- 外部阻塞（等第三方）不是状态：用 `blocked_by` 指向一个代表外部事项的占位任务，或写日志；不允许手动标 blocked

### 5.4 顺序与索引（已定）

- 不提交任何共享索引文件：`ls` / `ready` 的默认顺序按 rank → created → ID 计算得出（有 rank 的在前）
- 人为排序只改被移动的那一个任务的 `rank` 字段（`todopi move ID --before X`），不重排其他文件
- `.todopi/.cache/index.json` 进 gitignore，按 mtime 与内容 hash 增量重建，丢失可随时重算
- 历史（谁在何时改了什么）由 git log 回答，不重复存储
- 人工直接编辑任务文件：允许，`doctor` 与 `fmt` 兜底校验修复

---

## 6. 使用场景

1. **隔天续做**：昨晚 Claude Code 做到一半。今天开新会话，SessionStart 钩子注入 `prime`：「你认领了 tp-a1b2c3，AC 2/3 完成，上次卡在 X」。agent 直接继续。
2. **压缩中途不丢**：长任务触发 auto-compact，post-compact 钩子重新注入 prime，agent 不重做已完成的子任务。
3. **换 agent 接力**：在 Claude Code 里规划并创建 10 个任务，切到 Codex 或 pi 执行；三家读的是同一个 `.todopi/`。
4. **Ralph 循环**：`while :; do todopi ready --json | head -1 | claude -p "$(cat PROMPT.md)"; done`；`done` 的 verify 是回压，防止假完成。
5. **并行 worktree**：三个 agent 各自 `claim`，`ready` 自动排除已认领和被阻塞的项；合并 PR 时任务文件几乎不冲突。
6. **规划工具下游**：用 Superpowers 写完 plan.md，`todopi import` 变成有 ID、有依赖、可认领的任务；不必再改规划工具。
7. **人类 review**：PR 里能看到 `.todopi/tasks/tp-a1b2c3.md` 的 diff：谁认领、验证输出、哪条 AC 没过。

---

## 7. 商业化

### 7.1 市场事实

- 用户在 agent 本身上已花 $20–200/月，独立开发者「其他工具」的可支配预算约 $0–30/月；团队为可见性/治理付 $20–60/席
- 两个直接可比案例失败：Vibe Kanban（数千日活，绝大多数免费，$30/席无人买，2026-04 关停）、Height（2025 关停）
- Beads 27k★ 没有任何付费产品；Superpowers 286k★ 只有 53 个赞助者
- 行业共识：**不按 agent 收费**（Linear、Amp、Hiveship 均明示），托管 MCP 是低毛利红海，BYOK/零加价是标配
- 本地优先工具的稳定模式：**本地免费，托管/协作付费**（Obsidian Sync $4–5/月，Conductor、Zed、Plane、Hamster）

### 7.2 建议路径（按阶段）

| 阶段 | 免费 | 付费 | 定价锚 |
|---|---|---|---|
| 0–6 月 | 全部 MIT：CLI、格式、接入包、MCP | GitHub Sponsors / Polar「支持者」：早期构建、Discord、路线图投票 | $5/月 或 $50/年 |
| 有留存信号后 | 同上 + 自托管同步服务器 | **todopi Cloud**：端到端加密同步 + Web 看板 + 分享链接（面向多机/云沙盒 agent 用户和 2–10 人团队） | 个人 $4–5/月；团队 $19/工作区/月（先按工作区，不按席） |
| 第二年可选 | — | 团队治理：审批门、审计、每任务花费归因、Linear/GitHub 同步、SSO | $20–30/席/月 |

### 7.3 诚实的预期

- 这首先是一个**开源分发型产品**，收入天花板对单人创业者而言是「赞助 $100–2k/月 → 托管 $1–10k/月」量级；除非它成为更大产品（agent-ops 平台）的入口
- 护城河不在功能而在**格式成为事实标准 + 跨 agent 覆盖面**；一旦某家 agent 原生把持久任务做进仓库，本产品要靠「跨家」存活

---

## 8. 品牌与域名

- 名字来源「土豆皮」，README 里说明读音与出处，避免被读作「todo for pi」；不使用树莓/π 视觉元素（Raspberry Pi 商标规则）
- 待办（由你手动完成）：
  - [ ] 续费 `todopi.com`（2026-11-20 到期）
  - [ ] 注册 `todopi.dev`
  - [ ] 发布 npm `todopi` 与 `@todopi` scope 的 0.0.1 占位包
  - [ ] 创建 GitHub org `todopi`（或确认用个人账号）
  - [ ] 人工查 USPTO / EUIPO 商标（Trademarkia 无记录）
- `todopi.app` 于 2026-07-29 被第三方注册，非本人；暂不处理，发布前再看是否为抢注
- X @todopi 已被占，社媒账号另想（如 @todopi_dev）

---

## 9. 主要风险

| 风险 | 应对 |
|---|---|
| 品类拥挤（Beads + 十几个克隆） | 差异化在：跨 agent 接入包一条命令、验证式完成、prime 预算、公开格式规格；不拼功能数 |
| 厂商原生化（Claude Code 已有 `~/.claude/tasks` 共享列表） | 坚持「在仓库里、跨家、可 diff」三点原生方案都不满足 |
| agent 不用它 / 用错 | 宽容的 CLI、把 agent 猜的用法都实现；用 hooks 而不是靠 prompt 记得 |
| 过度设计重蹈 Beads 覆辙 | 子命令上限（见 §4.1 H）；每加一个功能删一个 |
| 单人维护成本 | 格式稳定 + 小代码量；社区插件承担各家适配 |

---

## 10. 已确认的决策（2026-09-14）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 目标用户 | 独立开发者 + 1–3 个 agent；多 agent 工厂与团队协作明确不在第一阶段 |
| 2 | 技术栈 | TypeScript + Bun 编译单文件；npm 为主要分发渠道 |
| 3 | 存储格式 | 每任务一个 Markdown + YAML frontmatter；顺序不存独立索引，默认按 rank → created → ID 计算，人为排序用任务自身的 LexoRank 式 `rank` 字段；`.todopi/.cache/` 进 gitignore 可随时重建 |
| 4 | 命名 | 名字来自「土豆皮」，与 pi 无关，不蹭 pi；主命令 `todopi`，别名 `tp`，ID 前缀 `tp-` |
| 5 | 人类 UI | MVP 含本地 Web 看板 `todopi web`（见 §4.1 I） |
| 6 | 商业路径 | 开源优先（MIT），赞助起步，托管同步/看板后置；架构预留同步接口不实现 |
| 7 | 验证式完成 | 有 `verify` 时失败即拒绝关闭；`--force` 必须带理由并留痕，列表中标记为未验证完成 |
| 8 | 语言 | 英文为主（CLI 输出、SKILL、README、官网），中文文档补充；仓库内设计文档可用中文 |
| 9 | 仓库 | ~~monorepo 放 todopi.com 仓库~~ 2026-09-14 改为：产品代码与文档放独立私有仓库 `seandong/todopi`（本仓库）；`todopi.com` 仓库只保留官网与 TripREC 隐私页 |
| 10 | 域名 | 续费 todopi.com、注册 todopi.dev、占位 npm 与 GitHub org（待办见 §8）；todopi.app 非本人所有 |
| 11 | 字段 schema | 按「有命令读且不可推导」判据取舍，12 个字段、4 个必填（见 §5.2）；**无 priority、无 type** |
| 12 | 状态维护 | 存储 open / in_progress / closed + resolution，blocked 推导；事件写任务自身 Log；文件锁 + 不变量校验（见 §5.3） |
| 13 | 外部平台 | MVP 不接，预留 `external`；v0.2 做 Linear 单向推送，todopi 为事实来源；GitHub Issues 其后 |
| 14 | 边界规则 | 粒度（一任务≈一提交）+ 时机（固定时刻必须操作）；handoff 列出 agent 新建任务供人审视；规则只在 SKILL.md，dogfooding 后调 |
| 15 | 身份 | `--as` > `TODOPI_ACTOR` > agent 环境推断 > git user.name；人机同用 `assignee` |
| 16 | 租约 | 存 `.git/todopi/leases/`，worktree 共享、不提交；2 小时无心跳过期 |
| 17 | verify 安全 | 首次按仓库路径确认并记入用户级 trust 文件；`--yes`/CI 跳过；仓库根执行，10 分钟超时 |
| 18 | setup 范围 | 默认项目级并提示，`--user` 切换；hook 只调 prime/handoff |
| 19 | MVP 验收 | dogfooding 跨 3 会话 2 种 agent 不丢进度；prime ≤1500 token；安装到可认领 ≤2 分钟 |
| 20 | 看板写操作 | 改状态、勾 AC、加 note、拖拽排序；其余走 CLI |
| 21 | 许可证与分发 | MIT；npm 发 Node 可运行的 JS 包，Bun 单二进制走 brew/curl |
| 22 | 提交策略 | 永不自动 git；任务文件随代码提交；SKILL.md 要求提交带上 `.todopi/` |
| 23 | 合并冲突 | MVP 手工解决，doctor 检测；merge driver 放 v0.2 |
| 24 | 完成门禁 | verify 失败、AC 未勾全、子任务未关闭三种情况都拒绝，均可 `--force --reason` 留痕；不级联关闭 |
| 25 | MCP | 不进 MVP；v0.2 做 ≤5 工具薄适配 |
| 26 | 遥测 | 永不收集，写入设计原则 |
| 27 | 平台 | macOS 与 Linux 保证；Windows 尽力，CI 跑但失败不阻塞发布 |
| 28 | 首发接入 | 六家接入包全部发布到各自市场/注册表 |
| 29 | 导入器 | plan.md 与 Beads 两个导入器都进 MVP（子命令增至 20 个） |
| 30 | 发布节奏 | 直接 Show HN，不做软发布；首发前规格页、演示、官网、六家安装说明必须齐 |

## 11. 分发与首发

**为什么分发影响 MVP 范围**：这个品类没有付费墙，也没有网络效应，唯一的增长杠杆是「安装摩擦为零」和「接上用户已有的东西」。所以接入包和导入器不是附属功能，是分发本身。

| 渠道 | 做法 | 对 MVP 的要求 |
|---|---|---|
| Agent 市场/注册表 | 六家接入包首发全部上架；用户在 agent 内一条命令装好 | 六套接入包 + `setup` 一致性测试 |
| Superpowers 用户（28 万星） | `todopi import plan.md` 给「计划写完之后怎么办」一个答案 | plan.md 导入器 |
| Beads 流失用户 | `todopi import beads` 一条命令迁移；README 里正面对比「12 个字段 vs 100 个子命令」 | Beads 导入器 |
| Show HN | 直接 Show HN，不做软发布。标题围绕格式规格和「活过压缩」的演示 | 首发前必须齐：格式规格页、30 秒演示动图、官网、六家安装说明 |
| 格式规格本身 | 在 todopi.com 单独发布 `.todopi/` 规格，邀请其他工具读写 | spec/ 目录随首发公开 |
| awesome 列表 / 社区 | awesome-claude-code、awesome-pi、awesome-agent-skills 等提交 PR | 首发后一周内 |

首发定位一句话（英文草案）：*Your agent's tasks, in your repo, in 12 fields. Survives compaction, sessions, and switching agents.*

首发不做：付费、云端、MCP、Linear。

## 12. 下一步

1. ~~PRD 与格式规格~~ 已完成：`docs/product/todopi-prd.md`、`spec/todopi-format-v1.md`（待审）
2. 出 MVP 实施计划：包结构、20 个子命令的实现顺序、里程碑
3. 完成 §8 的域名与命名空间待办

## 附：主要参考

- Anthropic, Effective harnesses for long-running agents: https://anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenAI, Harness engineering（InfoQ 转述）: https://www.infoq.com/news/2026/02/openai-harness-engineering-codex/
- Claude Code todo/task 工具现状: https://code.claude.com/docs/en/agent-sdk/todo-tracking · https://github.com/anthropics/claude-code/issues/80015
- Codex `update_plan` 默认关闭: https://github.com/openai/codex/issues/42365 · https://github.com/openai/codex/issues/33890
- OpenCode 移除 todo 工具: https://github.com/anomalyco/opencode/issues/42421
- pi 设计哲学: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Beads: https://github.com/steveyegge/beads · HN: https://news.ycombinator.com/item?id=46075616 · Dolt 迁移问题: https://github.com/steveyegge/beads/issues/2573
- Backlog.md: https://github.com/MrLesk/Backlog.md
- Vibe Kanban 关停: https://www.vibekanban.com/blog/shutdown
- Beads 的极简克隆: https://github.com/wedow/ticket · https://github.com/hmans/beans · https://github.com/obsfx/trekker · https://github.com/Dicklesworthstone/beads_rust
- Ralph loop: https://ghuntley.com/ralph/ · https://addyosmani.com/blog/long-running-agents/
- 压缩陷阱: https://tianpan.co/blog/2026/04/19/compaction-traps-long-running-agents
- CLI vs MCP token 成本: https://www.scalekit.com/blog/mcp-vs-cli-use
- Agent Skills 规范: https://agentskills.io/specification · AGENTS.md: https://agents.md/
- 定价参考: https://obsidian.md/pricing · https://linear.app/pricing · https://hiveship.app/ · https://tryhamster.com/pricing
