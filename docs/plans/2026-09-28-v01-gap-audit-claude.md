# todopi v0.1 需求 → 实现差距审计（Claude）

审计对象：`/Users/seandong/workspace/todopi`，main @ 4d5706a。仓库本身没有被修改（审计开始与结束时 `git status` 都是干净的）。
实验在 `/tmp/tpaudit/{r,r2,r3,nogit,perf}` 下进行，用的是 `node src/cli.ts`（包装成 `/tmp/tpaudit/bin/tp`），信任文件目录设为 `TODOPI_CONFIG_DIR=/tmp/tpaudit/cfg`，`--user` 的实验设了 `HOME=/tmp/tpaudit/home`。

> **⚠ 事故：用户真实的 `~/.cursor/hooks.json` 被改了。** 有一次 `tp --quiet setup cursor --user` 运行时没有覆盖 HOME，输出 `updated /Users/seandong/.cursor/hooks.json`。它加了两项：在 `hooks.sessionStart` 里追加了 `{"command": "todopi prime --hook --hook-json cursor"}`（紧跟在原有的 herdr 那一项后面），并新建了 `hooks.sessionEnd: [{"command": "todopi handoff --check --hook"}]`。我尝试回滚（只删这两项），但被权限分类器拒绝了，没有备份写成功。**需要用户手动删除这两项**，其余内容没有变动（key 顺序保留）。

口径：PRD §7（FR-*）、§8（命令/参数）、§9（协议）、§10（非功能——brief 里写的「§11」在 PRD 中实际是 §10；§11 是发布计划）、§12（MVP 验收）。另见 spec/todopi-format-v1.md 与 README.md。
判定：**done** / **partial** / **missing** / **n/a-v0.1**（仅用于 PRD 或某条 D-编号明确推迟到之后版本或划出范围的内容）。PRD §15 里记为「未实现 / 待核实」的条目属于**已知差距**，不算推迟。

测试套件：`node --test` → 891 通过，0 失败。

## 1. 功能需求（§7）

| 条目 | 判定 | 证据 | 缺什么 |
|---|---|---|---|
| FR-T1 add | done | cli.ts:61-94、commands/add.ts:37；实测 `add "Parent" -d … --label a --ac … --ac …` 生成的文件带 `rank: "i0"`，Log 有 `created`，`--from X` → `created from=X`，doctor 干净；`--from` 指向不存在的 id → 退出 1 | — |
| FR-T2 ls 过滤器 | done | cli.ts:108-146；实测 `--ready`、`--blocked`、`--label x`、`--mine`、`--closed`、`--all`、`--limit 2`（「Showing 2 of 10」）、`--json` 输出数组；已关闭任务默认隐藏；`[stale]`、`[unverified]` 标记可见 | — |
| FR-T3 show | done | commands/show.ts:119；实测「Log (last 5 of 8; --full for all)」、带编号的 AC、`--tree` 列出父链与子任务、`--json` 可用 | — |
| FR-T4 edit | **partial** | cli.ts:298-316；`--title/-d/--verify/--label +l\|-l/--parent id\|none` 都可用，并记录 `edited fields=…` | **没有 `--edit`**（`error: unknown option '--edit'`，退出 1）。**不能编辑正文分节**，只能改 Description：没有 `--ac`，也没有 Plan。于是 `add` 之后**没有任何 CLI 办法增加或修改验收标准**。PRD §15 承认了这一点（「`edit --edit`…与正文分节编辑未实现」），但没有推迟到哪个版本 |
| FR-T5 move | done | commands/move.ts:21；`move C --top` 之后 `git status` 只有 1 个文件改动；`--before/--after` 顺序正确；参数不是恰好一个时退出 1 | — |
| FR-T6 ID | done | format/id.ts:17（`crypto.randomInt`，6 位 base36）；format/write.ts:92-97 在持锁期间对照已有 id 重新生成 | — |
| FR-T7 没有 priority/type/delete | done | `delete` → unknown command；`add --priority` → unknown option；软删除走 `close -r obsolete` | — |
| FR-G1 dep | done | cli.ts:332-345；`dep add A --on B` 然后 `dep add B --on A` → 退出 1，并打印「cycle … tp-78ksjv -> tp-skyx9t -> tp-78ksjv」；阻塞自己也被拒 | — |
| FR-G2 ready | done | `ls --ready` 与 `ready` 别名（cli.ts:145）输出相同；过期的 in_progress 任务出现在 ready 中，并带 `[stale]` | — |
| FR-G3 容器 | done | 父任务从不出现在 ready 中；`ls`/`show` 显示 `[0/1]`、`children 0/1 closed` | — |
| FR-C1 claim | done | commands/claim.ts:24；租约未过期的他人任务 → 退出 3；`--steal` → `claimed steal=true: audit-person`；过期租约（lease_hours=0.0001）不带 `--steal` 也能重新认领，并记录 `steal=true: bob` | — |
| FR-C2 release | done | Log 有 `released`，租约文件被删；非持有者 release → 退出 3 | — |
| FR-C3 心跳 | done | 持有者 `note` 之后，租约 `heartbeat_at` 从 03:01:03 变为 03:01:11，`updated` 也被刷新 | — |
| FR-C4 actor 解析 | **partial** | domain/actor.ts:61-99：`--as` > `TODOPI_ACTOR` > git user.name（经规范化，"Audit Person"→`audit-person`）> `unknown@host`；`--as` 对查询同样生效 | **没有 agent 环境推断这一级**（PRD §15 / D014 承认，记为「待核实」，不是推迟）。实际后果：`setup` 生成的六份钩子/插件都**没有**带 `--as` 或 `TODOPI_ACTOR`，所以同一台机器上的 Claude Code、Codex 和人全都解析成同一个 git 用户名 actor。FR-C6 的严格匹配分不开两个 agent，`@<host>` 宽松匹配也永远不会触发。`setup` 在安装时知道自己装的是哪家，今天就可以写成 `--as <agent>@<host>`。直接影响 MVP 验收第 1 条 |
| FR-C6 严格/宽松匹配 | done（机制）/ 实际效果见 C4 | 由 bob 持有时：`note`、`check`、`edit`、`dep add`、`move`、`done`、`close` 都 → 退出 3；`--as claude-code@<host>` 持有的任务在我自己的 `ls --mine` / `prime` 里可见 | 宽松匹配依赖 agent 的 actor 是 `…@host`，而默认配置下没有任何东西产生这种 actor（见 C4） |
| FR-C5 租约位置 | done | 有 git 时在 `.git/todopi/leases/<id>.json`；无 git（`/tmp/tpaudit/nogit`）时在 `.todopi/.cache/leases/`；会话记录放在 `leases/sessions/` | — |
| FR-D1 check | done | `check P 1`、`--undo`，Log 为 `check ac=1: crit one` / `uncheck ac=1` | — |
| FR-D2 done | done | commands/done.ts:18、transition.ts:66；执行前原样打印命令（stderr）；非零退出 → 退出 2；timeout=2s 时，孙进程 `sleep 30` 连同整个进程组被杀；成功时记录 `done verify=pass commit=… dirty=…`，并删除租约；Windows 下拒绝（exec/run.ts:75） | — |
| FR-D2a 拒绝报告 | **partial** | 各门禁都有报告：未勾 AC 列序号与文本，子任务列 id/标题/状态，verify 列命令/退出码/尾部/日志路径，归属冲突列持有者与「Their last write was …」；结尾两条出路；不追加 Log | **AC 门禁的修复建议叫 agent 手改文件**：「Change `- [ ]` to `- [x]` for criteria 2 in .todopi/tasks/…」（output/render/gate.ts:83-85，注释写着「`todopi check` 要到 F09 才有」，这句注释已经过时）。这与协议里的「Never edit those files by hand」矛盾，而且 `todopi check <id> <n>` 早已存在 |
| FR-D3 --force | done | `done F --force` 不带 `--reason` → 退出 1；带理由时 verify 照跑，任务照常关闭，记录 `done verify=fail … forced=true: check is wrong` 加输出尾部；列表中显示 `[unverified]` | — |
| FR-D4 信任 | **partial** | exec/trust.ts：信任按仓库路径记录在 `$XDG_CONFIG_HOME\|~/.config/todopi/trust`，不在 `.todopi/` 内（tools/check-trust-location.mjs 把关）；`CI=true` / `--yes` 可跳过；每次执行前原样打印命令；`handoff` 标出 verify 有变化的任务（实测「tp-skyx9t B2: changed `echo changed`」） | **「要求确认」其实没有做成交互式确认**：即使有 TTY 也直接拒绝（退出 2），要求重跑并带 `--yes`（commands/verify.ts:52-57）。这个取舍只写在代码注释里，没有对应的 D-编号。按命令内容信任属于 n/a-v0.1（PRD 明确推迟到 v0.2） |
| FR-D4a 输出去向 | done | 通过时 Log 不带输出；强制关闭时带尾部；完整输出写到 `.todopi/.cache/verify/<id>-<ts>.log`（在 gitignore 中） | 尾部没有独立验证到恰好是 512 字节（依据 verify.test.ts:134） |
| FR-D5 close/reopen | **partial** | `close` 不带 resolution → 退出 1；`-r obsolete` 可用；`cancel` 别名可用；有未关闭子任务时 → 退出 2；`--force --reason` 可用；非法 resolution 被拒；`reopen` 可用；已关闭任务再 close → 拒绝 | **`close <id> -r obsolete --reason "…"` 被拒**：「--reason only applies together with --force.」（transition.ts:77-79，退出 1）。而 §8 把 `[--reason text]` 与 `[--force]` 列为两个独立参数，FR-D5 写的也是 `[--reason]`，所以普通 close 无法记录放弃的原因。另外 `-r` 的归属有歧义：PRD 写的是「[--reason]（短写 `-r`）」，实现把 `-r` 给了 `--resolution`，需要产品方拍板 |
| FR-L1 note | done | 多行文本以两格缩进续行写入 | — |
| FR-L2 只追加 | done | 各命令都只追加；被拒的迁移不写任何内容（已核对多次拒绝后的 Log） | — |
| FR-P1 prime | done | 持有任务时：标题、AC 状态、最近 2 条 Log、指针行；没有时为单行「No task in progress · 4 ready: `todopi ls --ready`」；指针包含「1 held by others」 | — |
| FR-P1a 预算 | done | `--budget 20` 时 Log 减到 1 条，指针保留；prime.test.ts:96-126 | — |
| FR-P1b 按会话记录 | done | `prime --session s1` 在 `leases/sessions/` 下写一份记录；`--hook` 从 stdin 读 session_id（cli.ts:175-185） | — |
| FR-P1c | done（设计属性） | 同 P1 | — |
| FR-P2 prime --json | done | 实测输出结构化报告（held/ready/heldByOthers/budget/overBudget/pointer） | — |
| FR-P3 prime --full | done | 各节齐全：你的、他人的、Ready（前 5 条）、Counts、最近关闭 3 条 | — |
| FR-H1 handoff | done | 报告包含三节（一小时内无 Log、自上次 prime 以来新建、verify 有变化）；只给持有者写 `handoff` Log，心跳被刷新、认领不释放；`--check` 什么都不写 | 摘要很单薄（例如「no checkbox criteria」）；handoff.test.ts:48-116 |
| FR-A1 setup | done | 六家都能装；幂等（再跑一次输出「unchanged」）；`--user` 写到 HOME 下；打印每个写入的文件；未知 agent → 退出 1 | — |
| FR-A2 钩子映射 | done | claude/codex：SessionStart（无 matcher）+ SessionEnd；opencode：插件订阅 session.created/compacted，并通过 `experimental.chat.system.transform` 注入；pi：session_start/session_compact + before_agent_start；cursor：sessionStart `--hook-json cursor` + sessionEnd；gemini：SessionStart、PreCompress(manual) 打标记、BeforeAgent `--if-compacted`、SessionEnd，并设 `context.fileName` 包含 AGENTS.md | 钩子里没有 actor，见 C4 |
| FR-A2a | done | `.cursor/rules/todopi.mdc` 设 `alwaysApply: true`；gemini 的打标记/取标记流程（commands/hook.ts:67） | — |
| FR-A2b Cursor 实机验证 | **partial** | 回退规则文件已提供 | PRD 用 MUST 要求的 CLI 与 IDE 各手工验证一次没有做：账本里 `tp-zagvp5「Cursor 接入：CLI 与 IDE 实机验证」` 状态为 open，PRD §17 也写着「Cursor 未实测」 |
| FR-A3 协议 ≤800 token | done | protocol.test.ts:5；src/protocol.ts:7 写的是实测 411 token（o200k）；init 写入的这一节 290 个英文词；§9 的 7 条大纲逐条都有 | — |
| FR-A4 首发时接入完整 | **partial** | 六家的 `setup` 都已实现；上架各市场属于 n/a-v0.1（FR-A4 写明首发后再做） | **README 没有给出六家的安装说明**，只有一句「`todopi setup <agent>`」。缺少：Codex 需要在 `/hooks` 里信任钩子，pi 需要信任项目，Codex 的钩子要求 `todopi` 在常规 PATH 上，Cursor/Gemini 压缩后的行为 |
| FR-B1 web | done | 只监听 127.0.0.1（lsof）；在前台运行；`--port`；`--open`（board/open.ts）；端口被占用 → 退出 1 | `--open` 没有实机试 |
| FR-B2 视图 | done | board-page.ts:127（open/blocked/in progress/done/closed 五列）、Ready、Tree、抽屉里有 evidence；board.test.ts:37 | — |
| FR-B3 只读 | done；写操作 n/a-v0.1 | POST → 405；Host: evil.com → 403 | 写操作按 FR-B3 推迟到 v0.2 |
| FR-B4 刷新 | done | SSE 实测：新增任务后 /events 推送了新数据；board/watch.ts 在 WSL 下或 fs.watch 出错时退为轮询，`--poll` 可强制，有 5 秒兜底轮询（watch.ts:117-120） | — |
| FR-I1 import md | done | 标题建成容器；已勾选条目 → closed/done 且 forced；`created source=plan.md`；重复导入 0 个新任务；两个同名「Step 1」都导入了 | done 那行 Log 没有 `commit=`/`dirty=`（spec 没要求必须有） |
| FR-I2 import beads | done | 实测：tombstone 被跳过；in_progress → open，原状态进 imported 事件；`Duplicate of …` → duplicate；parent/blocks 正确映射；`external.beads.id`；type → label；重复导入幂等 | — |
| FR-Q1 doctor | **partial** | 能检出冲突标记（invariant-7）、未知键给警告不判失败、坏的 Log 行只报告、`--fix` 回填 rank 并把 `[X]` 改为 `[x]`、仍有问题时退出 1、Log 不动 | **`--fix` 之后 `updated` 仍是不加引号的 `updated: 2026-09-01T00:00:00Z`**（doctor-fix.ts:119-120，doctor-fix.test.ts:32 有意钉住这个行为）。spec §5.1 要求写入者对每个标量都加引号；§6.3 只禁止改动 `updated` 的值。这是 spec 内部两条规则的冲突，需要用户裁定，未必是 bug。§7.2 的「blocker 以 duplicate 关闭时 SHOULD 警告」没有测 |
| FR-Q2 退出码 | done | 0/1/2/3/4 都实测到了（version:2 → 4） | — |
| FR-Q3 --json 有文档 | **missing**（文档部分） | 各命令都支持 `--json` | docs/、spec/、README 里都**没有**描述任何 `--json` 输出结构或其版本策略 |
| FR-Q4 动词宽容 | **partial** | `done\|finish\|complete`、`close\|cancel`、`ready` 都可用 | **`list`、`new`、`create`、`log`、`block` 都是「unknown command」，退出 1**。PRD 列的 6 组别名里有 4 组缺失，也没有测试覆盖 |
| FR-Q5 init | done | 创建 config.yml、tasks/、.gitignore（`.cache/`）；AGENTS.md 里写入被标记包住的段落；再跑一次输出「already current」；非法 `--prefix` → 退出 1；version 2 → 退出 4 | — |
| FR-Q5a CLAUDE.md | done | `setup claude` 创建含 `@AGENTS.md` 的 CLAUDE.md；setup.test.ts:75 | — |

## 2. 命令参考（§8）、别名与全局参数

| 条目 | 判定 | 证据 | 缺什么 |
|---|---|---|---|
| `init [--prefix]` | done | cli.ts:44-59 | — |
| `setup <agent> [--user]` | done | cli.ts:248-259 | — |
| `add … [--edit]` | **partial** | cli.ts:61-94 | **缺 `--edit`**。`--label`/`--ac` 是可变参数写法（`--label x y`），也支持重复给 |
| `ls [--open\|--closed\|--all] [--ready] [--blocked] [--mine] [--label] [--limit] [--json]` | done | cli.ts:108-146 | — |
| `show <id> [--full] [--tree] [--json]` | done | cli.ts:148-166 | — |
| `edit <id> … [--label +l\|-l] [--parent id\|none] [--edit]` | **partial** | cli.ts:298-316 | 缺 `--edit`；不带符号的 `--label baz` 也被接受为添加（比规定宽松） |
| `done <id> [--force --reason] [--yes]` | done | cli.ts:437-457 | — |
| `close <id> --resolution … [--reason] [--force]` | **partial** | cli.ts:522-523 | `--reason` 不带 `--force` 时被拒（见 FR-D5） |
| `reopen <id>` | done | — | — |
| `move <id> --top\|--before\|--after` | done | cli.ts:318-330 | — |
| `dep add\|rm <id> --on <id>` | done | cli.ts:332-345 | — |
| `claim <id> [--as] [--steal]` | done | `--as` 用的是全局参数；`claim X --as bob` 也有效 | — |
| `release <id>` | done | — | — |
| `note <id> <text>` | done | — | — |
| `check <id> <n> [--undo]` | done | — | — |
| `prime [--budget] [--full] [--json]` | done | cli.ts:187-221（另有 `--session/--hook/--hook-json/--mark-compacted/--if-compacted` 供钩子使用） | — |
| `handoff [--check]` | done | cli.ts:223-246 | — |
| `web [--port] [--open] [--poll]` | done | cli.ts:485-519 | — |
| `doctor [--fix]` | partial | 见 FR-Q1 | — |
| `import <file.md> \| import beads [path]` | done | cli.ts:460-483 | — |
| 20 个子命令的上限 | done | `--help` 里恰好 20 个基础命令，另加别名 | — |
| 别名 `ready` | done | cli.ts:145 | — |
| 别名 `finish`/`complete`/`cancel` | done | cli.ts:521-523 | — |
| 别名 `list` | **missing** | `tp list` → 「unknown command 'list' (Did you mean ls?)」，退出 1 | — |
| 别名 `new`/`create` | **missing** | 退出 1 | — |
| 别名 `log` | **missing** | 退出 1 | — |
| 别名 `block` | **missing** | 退出 1 | — |
| 全局 `--json` | done | cli.ts:14；所有有输出的命令都支持（web 除外，不适用）；放在子命令之后也能用（`show X --json`） | 输出结构没有文档（FR-Q3） |
| 全局 `--quiet` | **partial** | cli.ts:15；只在 doctor/init/add/ls/claim/release/done/close/reopen 里传给了渲染函数 | cli.ts 对 import/web/setup/show/note/check/edit/move/dep/prime/handoff 都没有传 `quiet`。实测漏掉的：`--quiet import p2.md` 仍打印「Next: todopi ls --ready」；`--quiet web` 仍打印「Read-only; … Press Ctrl+C to stop」；`--quiet setup codex --user` 仍打印 Codex 信任提示。其余命令本来就没有伴随文本 |
| 全局 `--as` | done | 对写入和查询都生效（`--as bob ls --mine`）；不合法的 actor → 退出 1 | — |
| 全局 `-C <dir>` | done | 在 /tmp 下运行 `-C /tmp/tpaudit/r ls` 可用；子目录也能向上找到账本 | — |

## 3. 协议（§9）

| 条目 | 判定 | 证据 | 缺什么 |
|---|---|---|---|
| 大纲第 1–7 条 | done | init 写入 AGENTS.md 的内容逐条都有：是什么/不要手改、粒度、时刻表、原生 todo、提交、查询、压缩后跑 `todopi prime` | — |
| 英文 | done | — | — |
| ≤ 800 token | done | 约 411 token；protocol.test.ts:5 | — |
| 与 CLI 其他文案一致 | **partial** | — | done 拒绝报告叫 agent 手改文件，与协议矛盾（见 FR-D2a） |

## 4. 非功能（PRD §10）

| 条目 | 判定 | 证据 | 缺什么 |
|---|---|---|---|
| 性能：2000 个任务 < 200 ms | **未验证 / 没有门禁** | 在 `/tmp/tpaudit/perf` 造了 2000 个任务：`ls`/`prime`/`doctor`/`show`/`move` 大多在 130–190 ms，`ls --ready`/`--all`/`--json` 在 130–590 ms 之间波动。**测量时机器负载 85**，结果不可信 | tests/ 与 harness.sh 里都没有任何性能测试或门禁 |
| 平台：Windows 上 verify 拒绝 | done / n/a-v0.1 | run.ts:75；D026 | — |
| 运行时：Node ≥ 20，不需要 Bun | done | package.json 声明 engines；install.yml 在 node:20 容器里跑 | — |
| 安全：信任、回环地址、无网络 | done | ARCH-001（.harness/arch-rules.json）；Host 头校验 | ARCH-001 把 `src/board/` 整个豁免了 |
| 兼容：拒绝写入更新版本（退出 4） | done / partial | 写入 → 4 | 读也被拒（`ls` → 4），而 spec §9 规定读者 SHOULD 仍然能读 |
| 隐私/许可 | done | 无遥测；MIT | — |

## 5. README 的声明

| 声明 | 判定 | 证据 | 缺什么 |
|---|---|---|---|
| 别名 `tp` | done | package.json 的 bin | — |
| 12 个字段、纯 Markdown、`.todopi/` | done | spec §5.2 | — |
| 「验证命令失败时无法以 done 关闭任务」 | **partial（说过头了）** | `done --force --reason` 在 verify=fail 时照样关闭（虽然标为 unverified） | 需要补上「除非强制，并被记录」这个限定 |
| 无常驻进程、无数据库、无 API key、无遥测 | done | — | — |
| 无网络 | done | ARCH-001 | — |
| 「no automatic git」 | done | 只调用 `git rev-parse/config/status`（fs/git.ts），全是只读 | — |
| CI 拒绝任何出站网络调用 | done（有例外） | ARCH-001 由 harness.yml 运行 | `src/board/` 被整个豁免 |
| verify 执行前打印命令 | done | — | — |
| 首次运行前询问 | **partial** | 实际是拒绝 + 要求 `--yes`，没有交互式询问（见 FR-D4） | — |
| 标出 verify 有变化的任务 | done | handoff | — |
| 约 3.3 MB、约 430 KB 的 JS、4 个依赖 | done | dist 下 JS 共 426,829 字节；package.json 有 4 个依赖 | 3.3 MB 这个数没有复测 |
| 安装：install.sh、Node ≥ 20 走 npm 否则下二进制、SHA-256、`~/.local/bin`、`TODOPI_VERSION` | done（尚未发布） | install.sh:61,68,128,132；install.yml | npm 上的 `todopi` 返回 404，raw 安装链接返回 404（README 自己写了「Once released」） |
| 「然后 `todopi init` 与 `todopi setup <agent>`」 | partial | — | 没有各家的具体说明（见 FR-A4） |
| 文档表里的链接 | done | spec/IMPLEMENTING.md、docs/harness/index.md、brainstorm 文档都存在 | — |
| MIT | done | LICENSE | — |

## 6. MVP 验收（§12）

| # | 判定 | 说明 |
|---|---|---|
| 1 用 todopi 管自己，同时用 Claude + Codex | 有风险 | 因为 FR-C4 的差距，两个 agent 在同一台机器上默认是同一个 actor |
| 2 prime 足够接续 | 无法从代码判断 | 需要人工跨会话确认 |
| 3 按 README 两分钟内装好 | 无法验证 | 还没发布 |
| 4 doctor 在本仓库通过 | done | 「doctor: 23 task(s), no problems found」 |
| 5 六家都在全新克隆上验证过 | partial | Cursor 未实测（tp-zagvp5 仍 open） |

## v0.1 的主要差距（按对用户的影响排序）

1. **所有 agent 与人共用同一个 actor**（FR-C4/C6）。没有环境推断这一级，而且 `setup` 生成的钩子不带 `--as`/`TODOPI_ACTOR`，所以同一台机器上 Claude Code、Codex 和人都解析成同一个 git 用户名。严格归属分不开两个 agent，`@host` 宽松匹配永远不会触发，MVP 第 1 条有风险。最省事的修法：`setup <agent>` 生成的钩子命令带上 `--as <agent>@<host>`，或者设置 TODOPI_ACTOR（前提是 agent 后续的 shell 调用能继承这个环境变量，这一点需要核实）。
2. **done 拒绝报告叫 agent 手改任务文件**（FR-D2a，gate.ts:83-85，注释已过时）。这与协议「Never edit those files by hand」直接矛盾，而且出现在 agent 被要求「修工作」的那一刻。应改为 `todopi check <id> <n>`。
3. **没有 CLI 办法编辑验收标准 / Plan，`add --edit`、`edit --edit` 都缺**（FR-T4、§8）。创建之后无法增补 AC，再加上第 2 条，agent 实际上被推向手改文件。
4. **`close -r X --reason "…"` 被拒**（FR-D5、§8）。普通放弃无法记录理由；另外 `-r` 究竟是哪个参数的短写有歧义。
5. **FR-Q4 的别名缺 4 组**：`list`、`new`/`create`、`log`、`block`。
6. **`--quiet` 在 import/web/setup 上没有生效**，仍打印「Next:」提示、Ctrl+C 提示、Codex 信任提示。
7. **`--json` 输出结构没有任何文档**（FR-Q3）。
8. **README 缺六家各自的安装说明**（FR-A4），并且把 verify 门禁说过头了（没提 `--force`）。
9. **Cursor 的 CLI/IDE 实机验证没做**（FR-A2b 的 MUST，tp-zagvp5 仍 open）。
10. **FR-D4 首次信任没有交互式确认**：有 TTY 也直接拒绝，要求 `--yes`，这个取舍没有记成 D-编号。
11. **`doctor --fix` 留下不加引号的 `updated`**：spec §5.1 与 §6.3 冲突，需要裁定。版本号更高时连读都拒绝（spec §9 规定 SHOULD 仍可读）。
12. **性能目标没有验证，也没有门禁**：负载 85 下测到 130–590 ms，没有自动化的性能测试。
