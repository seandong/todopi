# todopi v0.1 需求差距审计

范围：仓库 `main`，只读审计；按简报指定的 PRD、格式规格、README 顺序核对。所有 FR（含字母后缀）、§8 的 20 个命令/参数、四个全局参数及 README 声明均逐项列出。`done` 表示源码/实际调用符合；`partial` 表示存在差异或验收证据不足；`missing` 表示未实现；`n/a-v0.1` 仅用于明确记录的延期/决策。

## 验证记录

- 工作区审计前后均干净：`git status --short --branch` 为 `## main...origin/main`。
- 在 `/tmp/todopi-audit.NhOs89` 创建临时 git 仓库，运行 `node src/cli.ts -C <tmp> init`，再经真实 CLI 执行 `add`（含 `--json`）、父子任务、`check`、`note`、`dep add`、`show --tree --full`、`prime --full --json`、`handoff --check`、`doctor --json`、`ready --limit 5 --json`；均成功，doctor 输出 `ok:true`、`findings:[]`。
- `npm test`：891 tests、12 suites、0 failures。测试通过不替代下面的命令级反例与手工验收项。
- 实际反例：`close tp-js7mhu --resolution wontfix --reason 'no longer needed'` 返回 1，输出 `--reason only applies together with --force.`；`new` 与 `list` 返回 `unknown command`。
- `setup pi --quiet` 仍输出 trust 提示；成功的 `import ... --quiet` 仍输出 `Next: todopi ls --ready`。

## §7 功能需求（50 项）

| Item | Verdict | Evidence (file:line or command + output) | What is missing |
|---|---|---|---|
| FR-T1 | done | `src/commands/add.ts:37`；`src/format/id.ts`；`tests/commands/add.test.ts` | 创建任务、来源、验收项、verify、rank 覆盖。 |
| FR-T2 | done | `src/commands/ls.ts:54`；`src/output/render/ls.ts`；`tests/commands/ls.test.ts` | 过滤、数组 JSON、限制、stale/forced 状态标记已实现。 |
| FR-T3 | done | `src/commands/show.ts:119,150`；`tests/commands/show.test.ts` | 最近 5 条/总数、full、tree、JSON 均实现。 |
| FR-T4 | partial | `src/commands/edit.ts:4-5,39-42`；`src/cli.ts:298-316`；PRD §15:341-344 | `$EDITOR` 的 `--edit` 和正文分节编辑缺失；编辑仅覆盖标题、描述、verify、labels、parent。 |
| FR-T5 | done | `src/commands/move.ts:21`；`tests/commands/move.test.ts`、`tests/format/rank.test.ts` | move 只改一个任务，rank 边界由测试覆盖；doctor 回填缺 rank 是 FR-Q1 明定例外。 |
| FR-T6 | done | `src/format/id.ts:17,23`；`tests/format/id.test.ts` | 生成 6 位 base36 并检查碰撞。 |
| FR-T7 | done | `spec/todopi-format-v1.md` §5.2；`src/commands/close.ts`；`tests/commands/transition.test.ts` | 无 priority/type 字段、无硬删除；obsolete 关闭可用。 |
| FR-G1 | done | `src/commands/dep.ts:15`；`src/domain/graph.ts`；`tests/commands/dep.test.ts` | 维护依赖、拒绝循环并给出环。 |
| FR-G2 | done | `src/commands/ls.ts:54`；`src/domain/order.ts`、`derive.ts`；实际 `ready --limit 5 --json` 成功 | ready 条件与排序有实现。 |
| FR-G3 | done | `src/domain/derive.ts`；`tests/domain/derive.test.ts` | 容器不进入 ready，列表显示子任务进度。 |
| FR-C1 | done | `src/commands/claim.ts:24`；`src/format/lease.ts`；`tests/commands/claim.test.ts`、`claim.concurrent.test.ts` | 过期认领、有效租约、steal 与日志已覆盖。 |
| FR-C2 | done | `src/commands/release.ts:19`；`tests/commands/release.test.ts`、`release.concurrent.test.ts` | 清除认领与租约并记录事件。 |
| FR-C3 | done | `src/commands/worker-write.ts:32`；`src/commands/transition.ts:66`；写命令测试 | 持有者写入刷新 heartbeat/updated。 |
| FR-C4 | n/a-v0.1 | `src/domain/actor.ts:60-87`；`DECISIONS.md` D014（约 652-700 行）；PRD §15:317 | agent 环境推断按 D014 因无可靠唯一标记而明确不实现；现有链为 `--as`、`TODOPI_ACTOR`、git name、`unknown@host`。 |
| FR-C5 | done | `src/format/lease.ts`、`src/fs/git.ts`；`tests/format/lease.test.ts` | git common-dir/worktree 共用路径与无 git 回退已实现。 |
| FR-C6 | done | `src/domain/ownership.ts`、`src/domain/actor.ts:23-27`、`src/commands/worker-write.ts:32`；对应命令测试 | 写入严格归属、展示按 actor 或本机 host 宽松匹配。 |
| FR-D1 | done | `src/commands/check.ts:25`；`tests/commands/note-check.test.ts` | 切换验收项并追加 Log。 |
| FR-D2 | done | `src/commands/transition.ts:66`；`src/exec/run.ts`、`runner.ts`；`tests/commands/verify.test.ts`、`tests/exec/run.test.ts` | POSIX 进程组超时终止；Windows 明确不支持是 D026 的记录修订。 |
| FR-D2a | done | `src/output/render/gate.ts:186`；`src/commands/transition.ts:392-431`（CLI）；`tests/output/gate.test.ts` | 拒绝报告包含门禁、内容、输出和处理路径，不写 Log。 |
| FR-D3 | done | `src/commands/transition.ts:71-121`；`src/output/render/gate.ts:221`；forced 验证测试 | 强制仍运行 verify，失败关闭时留 forced/理由/尾部证据。 |
| FR-D4 | done | `src/exec/trust.ts:18,59,72`；`src/commands/done.ts`；`tests/exec/trust.test.ts`、`tests/commands/verify.test.ts` | 路径信任在仓库外；yes/CI 绕过提示；执行前打印命令。 |
| FR-D4a | done | `src/exec/runner.ts`、`src/exec/tail.ts`、`src/commands/transition.ts`；verify 测试 | 完整输出缓存；forced Log 记录尾部；成功 Log 不复制完整输出。 |
| FR-D5 | partial | `src/cli.ts:521-524`；`src/commands/transition.ts:66-90`；临时仓库命令重现见验证记录 | §7/§8 把 `--reason` 列为 close 可选项，但实现仅允许 `--force` 同时带 reason；照参考命令传独立 reason 会被拒绝。 |
| FR-L1 | done | `src/commands/note.ts`、`src/commands/worker-write.ts:32`；`tests/commands/note-check.test.ts` | 多行文本可追加。 |
| FR-L2 | done | `src/commands/transition.ts:162`；各写命令经 worker-write/统一 emit；Log 语法测试 | 状态变更追加，不改旧 Log；doctor --fix 不改 Log 是 PRD 明定例外。 |
| FR-P1 | done | `src/commands/prime.ts:128`；`src/output/render/prime.ts`；`tests/commands/prime.test.ts` | 当前任务推送，其他内容以指针提供；无持有任务时退化。 |
| FR-P1a | done | `src/commands/prime.ts:37,81,128`；`tests/domain/tokens.test.ts`、prime 测试 | 预算裁剪及 `overBudget` 实现。 |
| FR-P1b | done | `src/format/session.ts`；`src/commands/prime.ts`；`src/cli.ts:168-195`；hook/session 测试 | 会话时间写入运行时目录；取不到 session id 时回退 actor。 |
| FR-P1c | done | `src/commands/prime.ts:128-175`；`tests/commands/prime.test.ts` | 当前任务验收和最近 Log 优先推送，计数与关闭项留在指针/全景。 |
| FR-P2 | done | `src/output/render/prime.ts`；实际 `prime --full --json` 输出 JSON；prime 测试 | JSON 形状可输出。 |
| FR-P3 | done | `src/commands/prime.ts:176`、prime 测试 | full 包含持有任务、他人任务、ready、计数、最近关闭。 |
| FR-H1 | done | `src/commands/handoff.ts:73,142,158`；`tests/commands/handoff.test.ts` | 报告与写日志归属规则、check 只读路径已实现。 |
| FR-A1 | done | `src/commands/setup.ts:25-96`；`tests/commands/setup.test.ts` | 六家项目级/user 级配置幂等合并并报告文件；Cursor/Gemini 专项测试另有覆盖。 |
| FR-A2 | done | `src/format/claude-settings.ts`、`opencode-plugin.ts`、`pi-extension.ts`、Cursor/Gemini merger；PRD §17 | 钩子事件与注入路径按各家接口实现；集成运行证据见 §17，见 FR-A2b 的未完成手工验收。 |
| FR-A2a | done | `src/format/cursor-rule.ts`、Gemini settings/hook 生成；`tests/commands/setup-cursor-gemini.test.ts`；PRD §17:445-462 | Cursor always-apply 规则；Gemini manual 标记、BeforeAgent 消费；压缩行为经假 API runtime 验证。 |
| FR-A2b | partial | `src/format/cursor-rule.ts`；PRD §17:445-465 | 回退规则存在；PRD 明确记录 Cursor CLI 与 IDE 两种形态手工验证拆到后续任务，因此首发 MUST 验收尚未完成。 |
| FR-A3 | partial | 六家生成器共用 `src/protocol.ts:13-45`；`tests/protocol.test.ts:5-8,10-31` | 协议内容一致且英语；预算测试以字符数/4 近似，不是真 tokenizer。此审计环境未安装 tiktoken，无法复核实际 ≤800 token；源码注释中的 411 是历史测量，不当作本轮实测。 |
| FR-A4 | partial | `src/commands/setup.ts:23-95`；`README.md:11,29` | 六家 setup 能力存在，市场上架按 PRD 延后；README 只给通用 `setup <agent>` 一句，没有列出六家各自的命令/说明。 |
| FR-B1 | done | `src/commands/board.ts:21,29`、`src/cli.ts:486-519`；`tests/commands/board.test.ts` | loopback、前台、默认端口/open 行为实现。 |
| FR-B2 | done | `src/commands/board.ts:29`、`src/output/dto/board.ts`、`board-page.ts`；board 测试 | 状态列、树、ready、任务详情数据存在。 |
| FR-B3 | n/a-v0.1 | `src/board/server.ts`、`src/output/render/board-page.ts`；PRD §7.9、D039 | 只读是 v0.1 明确设计；四类写操作排到 v0.2。 |
| FR-B4 | done | `src/board/watch.ts`、`src/board/server.ts`；`tests/commands/board.test.ts`、`tools/e2e/f18-web.sh` | fs.watch、自动 fallback、poll、兜底轮询与 SSE 已实现。 |
| FR-I1 | done | `src/commands/import.ts:38`、`src/domain/import-plan.ts`；`tests/commands/import.test.ts` | 标题/checkbox/来源身份/父映射/幂等和强制关闭按 D040 实现。 |
| FR-I2 | done | `src/commands/import-beads.ts:35,70`、`src/domain/beads.ts`；`tests/commands/import-beads.test.ts` | Classic 映射；Dolt 格式明确不在范围，已关闭任务不标 forced 是 D041 修订。真实 Beads 导出样本的首发清单验收仍需完成。 |
| FR-Q1 | done | `src/commands/doctor.ts:9`、`src/commands/doctor-fix.ts:51`；`tests/commands/doctor.test.ts`、`doctor-fix.test.ts`、fixtures | 不变量、冲突标记、未知键警告、修复边界按 D034 执行。 |
| FR-Q2 | done | `src/exit.ts`；`tests/cli.test.ts`、verify/transition/claim 测试 | 0/1/2/3/4 各路径定义并测试。 |
| FR-Q3 | partial | `src/output/dto/*.ts`、`src/cli.ts:13-16`；README 无 JSON 输出契约文档，仓库未找到公开 JSON schema/兼容政策文档 | JSON DTO 存在，但 PRD 要求的公开结构文档及随 CLI 版本化的承诺没有对用户发布；测试源码不足以替代 API 契约。 |
| FR-Q4 | partial | `src/cli.ts:141-146,521-524`；实测 `new`/`list` 为 unknown command；代码只注册 `ready`, `finish`, `complete`, `cancel` | `add|new|create`、`ls|list`、`note|log`、`dep|block` 四组别名缺失；`done|finish|complete` 与 `close|cancel` 可用。 |
| FR-Q5 | done | `src/commands/init.ts:30`、`src/format/init.ts`、`src/format/agents-md.ts`；`tests/commands/init.test.ts` | 创建账本与幂等替换协议段。 |
| FR-Q5a | done | `src/commands/setup.ts:44-54`、`src/format/claude-md.ts`；setup 测试 | `setup claude` 在已有 CLAUDE.md 只补缺失导入；项目级 ensure 在账本根。 |

## §8 命令、命令参数、全局参数与别名

| Item | Verdict | Evidence (file:line or command + output) | What is missing |
|---|---|---|---|
| `init [--prefix]` | done | `src/cli.ts:44-59`；`tests/commands/init.test.ts` | 命令参数实现。 |
| `setup <agent> [--user]` | partial | `src/cli.ts:248-259`；`src/output/render/setup.ts:5-8` | 配置参数实现；`--quiet` 不传给 renderer，实际仍打印 notes。 |
| `add` 的普通字段/选项 | done | `src/cli.ts:61-94`；实际 add 创建并 doctor 通过 | §8 列出的普通字段可用。 |
| `add --edit` | missing | `src/cli.ts:61-94` 无此 option；`node src/cli.ts add --help` 无此项 | 命令参考公开的 `$EDITOR` 快捷入口未实现。 |
| `ls` / `ready` 过滤与 JSON | done | `src/cli.ts:96-146`；实际 `ready --limit 5 --json` | 过滤选项和 ready 包装齐全。 |
| `show [--full] [--tree] [--json]` | done | `src/cli.ts:148-166`；实际 `show --tree --full` | 参数可用。 |
| `edit` 参数 | partial | `src/cli.ts:298-316`；`node src/cli.ts edit --help` | title/description/verify/label/parent 实现；缺 `--edit` 与正文分节编辑。 |
| `done [--force --reason] [--yes]` | done | `src/cli.ts:437-457`；verify 与 transition 测试 | 选项可用。 |
| `close --resolution [--reason] [--force]` | partial | `src/cli.ts:521-524`；`src/commands/transition.ts:71-90`；重现返回 1 | `--reason` 实际要求 `--force`，与独立可选语法不符。 |
| `reopen` | done | `src/cli.ts:521-524`；transition 测试 | 已实现。 |
| `move --top/--before/--after` | done | `src/cli.ts:318-330`；move 测试 | 已实现。 |
| `dep add/rm <id> --on <id>` | done | `src/cli.ts:332-345`；实际 dep add；dep 测试 | 语法与选项可用。 |
| `claim [--as] [--steal]` | done | `src/cli.ts:347-367`；claim 测试 | --as 为全局选项；--steal 实现。 |
| `release` | done | `src/cli.ts:369-387`；release 测试 | 已实现。 |
| `note` | done | `src/cli.ts:261-275`；实际 note 与多行测试 | 已实现。 |
| `check [--undo]` | done | `src/cli.ts:277-292`；实际 check | 已实现。 |
| `prime [--budget] [--full] [--json]` | done | `src/cli.ts:187-220`；prime 测试 | §8 参数可用；另有 hook 专用参数。 |
| `handoff [--check]` | done | `src/cli.ts:224-246`；实际 handoff --check | 已实现。 |
| `web [--port] [--open] [--poll]` | done | `src/cli.ts:485-519`；board 测试/e2e | 三个参数可用。 |
| `doctor [--fix]` | done | `src/cli.ts:19-42`；doctor/doctor-fix 测试 | 已实现。 |
| `import <file.md>` / `import beads [path]` | partial | `src/cli.ts:460-483`；import 测试；实际成功导入 | 功能实现；`--quiet` 后仍打印纯提示 `Next: todopi ls --ready`（render/import.ts:14）；Beads renderer 同样在 :32 输出 Next。 |
| 动词别名组 | partial | `src/cli.ts:141-146,437-524`；`new`/`list` 实测 unknown | FR-Q4 要求 `done|finish|complete`、`close|cancel`、`ls|list`、`add|new|create`、`note|log`、`dep|block`；后三组（除 ready 这个另行别名外）未注册。 |
| 全局 `--json` | done | `src/cli.ts:13-16`；临时仓库 add/ls/prime/doctor JSON 调用成功 | 各 JSON-capable 命令使用 DTO renderer。`web` 是常驻服务，没有 JSON 输出模式。 |
| 全局 `--quiet` | partial | `src/cli.ts:15`；setup/import 调用结果见验证记录；renderers `setup.ts:5-8`、`import.ts:14`、`import-beads.ts:32` | 普通结果保留正确；setup 的 notes 和 import 的 Next 提示没有被抑制。 |
| 全局 `--as <actor>` | done | `src/cli.ts:16`；`src/commands/actor.ts:11-23`；`actor` 测试 | 写与查询均使用身份解析器。 |
| 全局 `-C <dir>` | done | `src/cli.ts:13`，命令 action 传入 directory；实际临时仓库全程使用 `-C` 成功 | 等价指定执行目录。 |

## §9 协议文本与 §10 非功能要求

| Item | Verdict | Evidence (file:line or command + output) | What is missing |
|---|---|---|---|
| §9 协议内容、英文、与 agent 共用 | done | `src/protocol.ts:13-45`；六家生成器引用同一常量；`tests/protocol.test.ts` | 大纲要求的事项均在文本中。 |
| §9 ≤800 tokens | partial | `tests/protocol.test.ts:5-8` 只按字符数/4；`src/protocol.ts:7` 记载历史 tiktoken 411 | 当前门禁不是 tokenizer 验证；本轮无法把历史注释当成当前 token 计数。 |
| 性能：2,000 tasks <200ms，冷缓存 <1s | partial | PRD §10:258 有历史 M 系列测量；本轮未重建 2,000 项当前代码 benchmark，也未见 CI 性能门禁 | 当前版本/目标 I/O 环境没有可复现的性能验收证据。 |
| 平台：macOS/Linux；Windows 尽力 | done | `.github/workflows/*.yml`、`tools/e2e/*`；跨平台 shell/E2E 记录 | 发布平台范围与实现一致；Windows 为非阻塞 CI。 |
| Node ≥20、npm 包、Bun 二进制 | done | `package.json:engines/bin/scripts`、`tsconfig.build.json`、D042；F21 E2E | 当前 npm 构建路径在 D042 记录 Node 20.0 验证。 |
| 安全：verify 信任、loopback web、运行时零网络 | done | `src/exec/trust.ts`、`src/board/server.ts`、network 静态规则/CI；README:13-15 | install/发布下载需要网络，但 CLI 自身边界与文档描述的运行时相符。 |
| 隐私：无遥测；公开仓库任务可见 | done | `src/` outbound network 规则；README:13、PRD §10:262 | 文档有公开仓库提醒；未发现遥测路径。 |
| 格式 v1 / 拒绝新版本写入 | done | `spec/todopi-format-v1.md`、`src/format/discover.ts`/`validate.ts`；version 与 fixtures 测试 | 写入版本门禁存在。 |
| 英文优先、MIT | done | README、spec、`LICENSE`；`package.json` MIT | 可核实内容符合约定。 |

## §12 MVP 验收

| Item | Verdict | Evidence (file:line or command + output) | What is missing |
|---|---|---|---|
| MVP-1：≥3 sessions，Claude+Codex，无进度丢失/重复 | partial | 当前源码具备跨会话文件账本与集成；本审计临时 CLI smoke | 这是 dogfooding 结果，当前未找到可独立复核的三会话端到端记录；不能由单元测试替代。 |
| MVP-2：真实账本接续与 prime 指针使用 | partial | `src/commands/prime.ts` 与 prime 测试 | 未执行三会话人工接续实验；裁剪与指针是否被 agent 真正使用未验证。 |
| MVP-3：README 新用户两分钟内建出可认领任务 | partial | README install/init/setup 指令；本轮临时仓库 CLI 流程成功 | 官方 curl 路径标明首发后可用；本轮未做计时的新用户全流程。 |
| MVP-4：每个发布 tag doctor 通过 | n/a-v0.1 | README:7 标记 pre-alpha、尚未发布；PRD §12:4 | 无发布 tag 可验收。 |
| MVP-5：六个 setup 在新克隆干净安装且会话开始收到 prime | partial | Setup 测试、PRD §17 记录各家的验证；PRD §17:465 明确 Cursor CLI/IDE 手工验证另拆任务 | 六家运行时手工验收仍非全闭环，尤其 Cursor CLI 与 IDE 明确未完成。 |

## README 声明核对

| Item | Verdict | Evidence (file:line or command + output) | What is missing |
|---|---|---|---|
| README:1-7 名称、pre-alpha、未发布 | done | README；`package.json` version 0.0.1 | 与当前仓库状态吻合。 |
| README:3-11 任务为 12 字段 Markdown、同一账本供六家 agent 使用 | done | `spec/todopi-format-v1.md` §5.2；`src/commands/setup.ts:23-95` | 接入需要用户运行 setup 并接受相应 agent 的项目/插件信任流程；README 有提示入口。 |
| README:11 “A task cannot be closed as done while its verification command fails” | partial | `src/commands/transition.ts:71-121` 明确允许 `--force --reason` 在 verify 失败时关闭；README:33 也承认可 force | 首句绝对化，和有意支持的强制关闭相矛盾；应限定为正常路径。 |
| README:13 无常驻服务/DB/API key/遥测/网络/自动 git；web 前台 loopback | done | `src/board/server.ts`、网络静态规则、无自动 git 写入；README 同行 | “无网络”适用于 todopi CLI 运行时；安装下载与用户 verify 命令是明示的外部动作。 |
| README:15 CI 拒绝 `src/` outbound network；verify 命令打印后执行 | done | workflow 调用网络架构检查；`src/commands/transition.ts`、`src/exec/runner.ts` | 该声明针对源码 CI 检查，非安装器下载。 |
| README:17 npm 包约 3.3MB、JS 约430KB、四个直接依赖 | done | `package.json` 四项 dependencies；D042/PRD §10 当前包体重测 | 约数与依赖清单一致。 |
| README:17 plain JS / Node 20+；binary 给无 Node 环境 | done | `package.json` engines/bin；D042 | 与发布构建/安装器路径一致。 |
| README:21-27 curl installer、npm优先、无 Node 下载并校验 SHA256、版本钉选 | done | `install.sh`、`tools/e2e/f21-install.sh` | 说明带“首发后”前提；当前仍未发布。 |
| README:27 默认落在 `~/.local/bin`，也可 npm global | done | `install.sh` 默认 `TODOPI_INSTALL_DIR` 与 npm prefix；`package.json` bin | 用户自定义安装目录/环境变量可改变默认位置。 |
| README:29 初始化并为所用 agent 执行 setup | partial | `src/cli.ts` help 与 setup action；README 只给通用命令 | 未逐项列出六家安装命令/特有信任与配置说明，弱于 FR-A4 要求的六家说明。 |
| README:33 verify 安全说明（首次信任、逐次打印、变更提醒、OS 沙箱） | done | `src/exec/trust.ts`、`src/commands/handoff.ts`；`src/commands/transition.ts` | `--yes`/`CI=true` 是 PRD 定义的提示绕过；其余声明有实现。 |
| README:35-52 文档链接、名称读音/来源、MIT | done | 各链接目标、README、`LICENSE` | 未发现失效链接或与实现矛盾项。 |

## Top gaps for v0.1

1. **命令兼容面不完整（FR-Q4）**：`ls|list`、`add|new|create`、`note|log`、`dep|block` 没有注册；agent 按 PRD 习惯调用会直接 `unknown command`。
2. **关闭原因的参考用法失败（FR-D5/§8）**：`close --resolution ... --reason ...` 单独传 reason 会退出 1，实际必须另加 `--force`；PRD 语法没有说明这一依赖。
3. **编辑入口缺失（FR-T4/§8）**：`add --edit`、`edit --edit` 与正文分节编辑未实现。
4. **公开 JSON 契约缺失（FR-Q3）**：有内部 DTO，但没有给 CLI 消费者的结构文档和兼容/版本化说明。
5. **全局 quiet 不完整**：setup notes、import/import-beads 的 `Next:` 纯提示在 `--quiet` 下仍输出。
6. **接入验收未闭环**：Cursor CLI/IDE 手测按 PRD 仍待做；MVP 的跨会话人工接续与 prime 指针使用也没有本轮可复核证据。
7. **文案与能力边界不一致**：README 把普通失败表述成“不能关闭”，但 force 明确允许 verify 失败后关闭；PRD §9 token 上限及性能目标也缺少当前版本可重复的自动验收。
