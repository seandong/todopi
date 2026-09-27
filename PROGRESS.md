# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `a2cdb54` —— F22 agent 环境推断身份 经 todopi done 关闭（verify=pass dirty=false）。
  HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（**22 条全部通过**，ARCH-019/021 与 clean-check 的 no-debug-artifacts 于 2026-09-23 收窄，其中 ARCH-020 有 16 条正反例）/ typecheck（`pass`，tsc --noEmit）
- `make test`: `pass` —— `fixtures`（语料质量）+ `unit-test`（`node --test`，
  **607 个用例**）。其中 53 个是语料库驱动的一致性断言，已用变异测试确认它们会咬。
  锁有一条多进程用例——10 个单进程用例在锁存在致命竞态时全部通过，只有它会红
- `make e2e`: `pass` —— `f01-doctor` 11 项 + `f02-init` 19 项 + `f03-add` 13 项 +
  `f04-ls` 24 项 + `f05-claim` 47 项 + `f06-gates` 66 项 + `f07-verify` 38 项。f03 的并发压测（20 个 add 产出 20 个不同 id 与 rank）
  是单元测试抓不到的那类；Codex 第二轮评审另补了跨 worktree 锁测试
  （30 进程计数 30、无残留），确认 `leasePaths` 重构没有回归
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: 58/73，CRITICAL 6/7，RECOMMENDED 52/66。唯一的
  CRITICAL FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省
- 账本: `.todopi/` 36 个任务，23 个 `closed/done`、13 个 `open`：v0.1 缺口审计建的 13 个（label m4），加 tp-zagvp5（Cursor 实机验证，等维护者）。
  **`make vcr` 已随 `feature_list.json` 一起删除**（迁移损失表第十一条）；
  这一行的计数由 `make status` 给出。
- 代码状态：**F01–F21 已完成（M1、M2 收齐，M3 进行中）**。`doctor` / `init` / `add` / `ls`（及别名 `ready`）/
  `claim` / `release` / `done` / `close` / `reopen` / `show` / `note` / `check` /
  `edit` / `move` / `dep` / `prime` / `handoff` / `doctor --fix` / `setup claude|codex|opencode|pi|cursor|gemini` / `web` / `import <plan.md>` / `import beads` 可用。正文结构（标题、代码块）交给 commonmark 判定（D031）。写入端基座：发射器（spec §5.1 引号规则的唯一执行者）、id 生成、文件锁。
  读出端：spec §7 的派生态与 §7.4 的排序都在 `domain/` 的纯函数里，
  `TaskDto` 定下了 `--json` 这个公开 API 的第一块形状。
  身份解析（FR-C4 前三级）在 `domain/actor.ts` + `commands/actor.ts`，`ls` 与
  `add` 共用。运行时依赖四个：`commander`、`yaml`、`fractional-indexing`、`commonmark`（F10，D031）

## In Progress

**无。** F01–F07 全部 `passing` 且都在 `main` 上。

**2026-09-23：自举完成。** `feature_list.json` 已删除，21 条 feature 迁进
`.todopi/tasks/`，todopi 用自己管理自己的开发任务。

- 迁移计划与**损失表**（十三条，其中四条没有替代物；最后三条是**执行之后**
  的评审才找出来的）：
  [docs/plans/2026-09-23-bootstrap.md](docs/plans/2026-09-23-bootstrap.md)
- 对账脚本 `tools/bootstrap-verify.mjs` 保留，随时可重跑——它从 git 读原始 JSON，
  逐条逐字段对回去。三个突变验证过它会红。
- 新的 WIP=1 / 依赖 / 必须有 verify 三条策略由 **ARCH-023** 持续检查
  （`tools/check-ledger-policy.mjs`，六个反例验证过）。它是**事后发现**，
  不是当场拒绝——这是从 `make activate` 降级而来的，如实记在损失表里。

日常回路（见 AGENTS.md）：

```
todopi ls --ready → todopi claim <id> → 干活 → todopi check 逐条勾验收标准
→ git commit（代码 + claim 留下的账本改动）→ todopi done <id>
→ git commit（done 的账本改动 + PROGRESS）→ make clean-check
```

**remote 状态**：`origin` 是 `github.com/seandong/todopi`。2026-09-24 已把 `main` 推到
`92edf6d`（F08 合并之后）。此后合回 `main` 即推送，只在快进时推、不 force。

## 里程碑

迁移自 `feature_list.json` 的 `milestones`。分组本身进了任务的 `labels`
（`m1`/`m2`/`m3`），而「什么时候算完成」是叙述性上下文——按契约「PROGRESS.md 与
DECISIONS.md 不迁移」的同一理由留在这里。

- **M1**（F01–F07，共 7 条）——docs/harness/state-migration.md 的三个触发条件全部满足，仓库切换到用 todopi 管自己
- **M2**（F08–F13，共 6 条）——20 个子命令中与日常回路相关的全部可用，dogfooding 不再需要手工绕开任何环节
- **M3**（F14–F21，共 8 条）——PRD §13 首发清单中与代码相关的条目全部可勾

## Next Steps

按顺序，每条都是可立即执行的动作：

1. ~~评审格式规格~~ 已完成（2026-09-15）：规格 Stable，PRD 1.1，11 个问题逐条
   落文档。结论见 DECISIONS.md D004。
2. ~~核实六家 agent 的外部事实~~ 已完成（2026-09-16）：结果写入 PRD §17，
   FR-A2 按核实结果重写。查出三处出入，其中 Cursor 与 Gemini CLI 都已支持钩子
   （PRD 1.1 写的「规则文件加命令」已过期）、pi 的压缩事件选错了方向。
3. ~~确认技术方案~~ 已完成（2026-09-16）：十条选型附实测数据，见 DECISIONS D006。
4. ~~拆出 v0.1 的第一批 feature~~ 已完成（2026-09-16）：21 条，三个里程碑，
   依据见 DECISIONS D011。
5. ~~activate F01、写计划并执行~~ 已完成（2026-09-16）：9 个 task 逐个 TDD 通过，
   计划在 [docs/plans/2026-09-16-f01-doctor.md](docs/plans/2026-09-16-f01-doctor.md)。
6. ~~把 `feat/f01-doctor` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
7. ~~执行 F02 的 plan~~ 已完成，5 个 task 逐个 TDD 通过。
8. ~~Codex review~~ 已完成（2026-09-21）：No-go，7 项全部属实并已修复，
   三类错误提升为 ARCH-014/015/016，详见 DECISIONS D012。
   顺带修掉一个 harness 缺陷：`verify-feature` 验证工作区却记录 HEAD，
   导致 F01 与 F02 的 evidence 都指向不含被验证代码的 commit；
   现在工作区脏时会拒绝，并新增 `make reverify` 修复坏掉的记录。
9. ~~把 `feat/f02-init` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
10. ~~执行 F03 的 plan~~ 已完成，5 个 task 逐个 TDD 通过。
11. ~~Codex review 并合回 main~~ 已完成。**四轮**评审：前两轮是架构级（文件锁的
    整个「自动接管」设计被推翻），后两轮是细节级，且第四轮的两个阻塞项都是第三轮
    修复时新引入的。结论与方法论记在 DECISIONS D013。
12. ~~activate F04 并写计划、执行 plan~~ 已完成，5 个 task 逐个 TDD 通过。
    F04 几乎全部落在 `domain/`，是 D006 决策 3「纯函数领域层」第一次真正兑现：
    `isStale` 需要的「现在几点」与「本机有无租约」**注入**而不在 domain 里读，
    于是每个分支都能用普通用例覆盖——不需要 sleep、不需要造租约文件、
    也不会有时序 flake。
13. ~~Codex 评审第一轮~~ No-go，8 个阻塞项，全部处理，见 DECISIONS D014。
14. ~~Codex 评审第二轮~~ No-go，2 个阻塞项 + 5 条应改，全部处理，见 DECISIONS D015。
15. ~~Codex 评审第三轮~~ No-go，2 个阻塞项 + 1 条应改，全部处理，见 DECISIONS D016。
16. ~~Codex 评审第四轮~~ **Go**，两条应改已处理，见 DECISIONS D017。检查器改用
    Node 自带的真解析器，并补了 16 条正反例——ARCH-001/002/011/013/020 都曾
    误伤或从来没生效过，而它们没有一条有测试。其余四条补正反例列为 harness 改进项。
17. ~~把 `feat/f04-ls` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
18. ~~activate F05、写计划并执行~~ 已完成，6 个 task 逐个 TDD 通过，三层全绿。
    写计划时实测出两件事改变了 Task 划分：`emitFrontmatter` 遇到嵌套映射直接
    抛错（`external` 就是），而那个「留给 F10」的推迟到 F05 不成立；
    `createTask` 只能建新任务，所以要抽出通用的 `updateTask`。
19. ~~Codex 评审 F05~~ 四轮才拿到 Go，阻塞项 6 → 2 → 1 → 0，见 D018–D021。
    其中两条是真正的数据正确性问题（改写既有任务破坏扩展字段、跨 worktree
    覆盖别人的活租约），一条是我写错的技术结论（D021 纠正）。
20. ~~把 `feat/f05-claim` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
21. ~~activate F06、写计划并执行~~ 已完成，6 个 task 逐个 TDD 通过，三层全绿。
    顺带改了一处规格（`close --as` → `close --resolution`，见上）。
22. ~~Codex 评审 F06~~ 四轮才拿到 Go，阻塞项 4 → 2 → 1 → 0，见 D022–D025。
23. ~~把 `feat/f06-done` 合回 `main`~~ 已完成。若要上远端：`git push origin main`。
24. ~~activate F07、写计划并执行~~ 已完成，5 个 task 逐个 TDD 通过，三层全绿。
25. ~~Codex 评审 `feat/f07-verify` 并合回 `main`~~ 已完成。**九轮**：阻塞项
    3+0+1+0+2+2+2+1+0。第一轮抓到「计划写着不该全缓存在内存、实现却正好在内存里
    全缓存」；第五至八轮全在「怎么判断一条测试被停掉」上，最后拔根而不是加第四版
    guard。见 DECISIONS D026、D027。
26. ~~开始自举~~ 已完成（2026-09-23）。21 条迁进 `.todopi/`，`feature_list.json`
    已删除。计划先经四轮评审才执行，损失表 三 → 五 → 八 → 十 → 十三条。
27. ~~自举评审并合回 `main`~~ 已完成。**五轮**（计划另有四轮）。
    评审找出的东西里有三条不是迁移的必然代价，是我重写 `status` 面板时自己弄丢的
    ——损失表里都标注了。
28. ~~F08 `show`~~ 已完成（2026-09-24）。**第一个用 todopi 自己管出来的 feature**：
    claim → 提交 → Codex 两轮评审 → `todopi done`（`verify=pass commit=92baaf7
    dirty=false`）。流程上定下「评审必须在 done 之前」（自举后没有 reverify）；
    在真实账本上 dogfood 发现散文验收判据在 `show` 里看不见，已修。见 D028。
29. ~~F09 `note` / `check`~~ 已完成（2026-09-24）。三轮评审，阻塞项 2+1+0——两条都是
    新命令第一次走到的**旧**缺陷（写入端找 `## Log` 用 trim、`- [ ]x` 被当成标准）。
    `todopi done`：`verify=pass commit=22dc272 dirty=false`。见 D029。
    它给了勾选的**机制**；但自举任务的散文判据**不会因此自动有去处**——见下一条。
31. ~~F10 `edit` / `move` / `dep`~~ 已完成（2026-09-26）。**十四轮评审**，大部分花在同一个类上：
    正文里某种 Markdown 结构让未勾的验收标准从 done 门禁里消失。手写 CommonMark 近似三轮被绕过后
    引入 commonmark（D031）；之后按机制论证「只有三类块能吞掉后面的行」并用暴力枚举验证；再之后是
    CLI 自己的入口（edit -d、add --ac）能造出这种正文——加了写后读回；最后三轮是规格版本与迁移说明
    （用户决定：发布前的修订记在 spec §9.1、不升版），用旧实现对照差分核实迁移断言。ARCH-024 从手写
    bash 词法退回文字判据（DECISIONS，F10 第七轮）。`todopi done`：verify=pass dirty=false。
    教训：**后置条件加在一个入口上，要问其余入口；迁移说明也是断言，要拿旧实现对照跑过再写。**
32. ~~F11 `prime`~~ 已完成（2026-09-26）。token 估算按字符类别加权（用户定）；会话标识用 `--session`，
    没给按 actor（D032）。四轮评审，阻塞项都在「--json 与文本是同一份内容」与「输出里没有控制字符」
    这两条性质上：先补指针，再把转义从渲染挪到投影，最后让渲染不生成任何内容。
    教训：**一条「A 与 B 内容相同」的性质，要让 B 只从 A 生成，而不是两边各自拼。**
    `todopi done`：verify=pass dirty=false。下一步是 F12 handoff（读 prime 记下的会话时间）。
33. ~~F12 `handoff`~~ 已完成（2026-09-26）。verify 变更靠 prime 时的快照判断（D033）——手改文件与合并的
    PR 不留 Log。九轮评审：前五轮在快照状态判断的边界（锁内重核归属、读不出来、同秒编辑、旧格式），
    最后成了一张 96 项的状态矩阵用例；后四轮在补上的两条规则 ARCH-026 / ARCH-027 上，检查从 grep 改成
    检查输出本身，措辞收窄到检查真正能拒绝的东西。顺带修了 harness 在终端里跑 `make test` 被判 blocked。
    教训：**一条规则的措辞只能宣称它的检查能拒绝的东西**（措辞宽于检查，第十一次）。
    `todopi done`：verify=pass dirty=false。
34. ~~F13 `doctor --fix`~~ 已完成（2026-09-26），**M2 收齐**。用户定：修复不刷新 `updated`、不碰 Log
    （规格 §6.3 例外，D034）。孤儿租约不判——租约目录由所有 worktree 共享，单个 checkout 分辨不出，只按过期
    清（FR-Q1 改写，评审接受）。四轮评审：updated 的写法、非法 UTF-8、rank 回填的前提与两阶段、用 YAML 解析器
    定位 updated 原文。`todopi done`：verify=pass dirty=false。
    下一步：F14 `setup claude`（M3 的第一个）。
47. ~~F22 agent 环境推断身份（FR-C4）~~ 已完成（2026-09-28）。六家 agent 给工具子进程设的变量逐家按一手资料核实（D043）：Claude Code
    CLAUDECODE、Codex CODEX_THREAD_ID、Gemini GEMINI_CLI、OpenCode OPENCODE、pi PI_SESSION_ID、Cursor CURSOR_AGENT；恰好一个信号才推断
    （嵌套时分不出哪层在跑）。钩子子进程里不一定有这些变量，setup 写出的钩子与插件显式带 --agent；旧钩子就地迁移。测试与 e2e 与跑它的
    agent 无关。Codex 三轮 → Go。**本仓库从此在 Claude Code 里是 claude-code@<host>，不再是 seandong。**
46. v0.1 缺口审计（2026-09-28）：Codex 与 Claude 子代理各自独立地把 PRD §7–§12、README 与实现逐条对照，报告在 docs/plans/2026-09-28-v01-gap-audit-*.md。
    核实后建成 13 个任务（label m4），按对用户的影响排序：FR-C4 agent 环境推断身份（同机多个 agent 现在都是同一个 git 用户名）、CLI 表面补齐
    （别名、close --reason、--quiet、done 被拒时提示 check）、建好后改验收标准与 Plan / --edit、更高版本账本只读可用、首次 verify 的终端确认、
    --json 契约文档、README 首发版、性能基准、规格措辞、第二份 Beads 导出、规格站点、brew。**审计中子代理误改了维护者的 ~/.cursor/hooks.json**
    （多了 todopi 的 sessionStart 与 sessionEnd 两项；它被拒绝回滚，我没有代做，留给维护者删）。
45. Codex 补审（2026-09-28）：额度恢复后，把只经子代理评审的 F20 / F21 / 探针 / 看板兜底轮询交给 Codex 再审。发现并修好：Beads 自己挡自己的
    边被静默丢（改为计数并警告）；install.sh 的安装目录竞态——临时文件名可预测、别人可写的目录、上级目录与路径里的符号链接、ACL（含上级目录；
    macOS 家目录默认的 deny ACL 不算）、getfacl 读失败时误判为安全。最终做法：解析成物理路径一次、此后只用它，逐级查属主 / 权限位 / ACL，
    临时文件用 mktemp。六轮 → Go。
44. ~~tp-1ssqrw OpenCode 压缩后注入实测~~ 已完成（2026-09-27）。不需要凭据：OpenCode 自带的自定义 provider 指向本地假 OpenAI 兼容服务器
    （tools/probes/openai-fake-api.mjs），在真实运行时里看请求体——压缩后第一个请求的系统提示里出现压缩前刚记的标记，之前（含压缩摘要请求）
    都没有。验收标准 #1 原文「模型能原样引出」按替代验证改写（假模型不回显；看请求体更直接），Log 里写明。子代理评审 Go。
43. ~~F21 安装~~ 已完成（2026-09-27）。npm 包改为 tsc 逐文件编译的 JS（Node 20.0 起可跑），单二进制（Bun）里 runner 把自己再起一次；
    install.sh 按 D008 决策 3 的清单；install.yml（有 / 无 Node 的干净容器）与 release.yml（先发 npm 再建 Release）。D042。
    **重大发现：远端 Harness CI 自 09-17 起一直是红的**（没装依赖），本地三层一直绿、没人看远端——修好，并顺带修了 CI 环境才暴露的
    runner 竞态（日志写不进去时漏报）、locale 依赖的中文判断（在某些 locale 下悄悄放行）、verify 用例被 CI=true 带偏。**以后合并推送后
    要看远端 CI。** 评审由 Claude 子代理做（三轮 → Go）。发布（打 v 标签、npm 发包与 `todopi` 名字占位）是维护者的动作，还没做。
42. ~~F20 `import beads`~~ 已完成（2026-09-26）。Beads Classic（v0.47.1 的字段）→ 任务（D041）：tombstone / ephemeral 不导入；只有 closed 映射成
    closed，resolution 按 close_reason 开头判 duplicate / wontfix / done；已关闭的**不标 forced**，出处记在 imported 事件里（我按规格定，可推翻）；
    parent / blocks 排建立顺序，from 只在不成环时保留；不安全的描述缩进成代码块；写之前全部预检。用 Beads 仓库自己的 2404 行导出实测：1738 条、
    doctor 通过。**评审改由 Claude 子代理**（Codex 额度见底，用户定）：四轮 → Go。顺带修了两个导入器的标题截断口径（F19 同病）。
41. ~~F19 `import <plan.md>`~~ 已完成（2026-09-26）。Superpowers / spec-kit / OpenSpec 的 checkbox 计划 → 任务（D040）：身份键含父级
    标题链（每个 Task 下同名的「Step 1」各自独立），重复导入不动已有任务，整次导入一把锁（e2e：去锁时 28 变 49），分隔线结束小节。
    Codex 评审：键与标题里的 #n 撞、`..notes.md` 被当成项目外 → 修 → Go。**同一分支上修了看板的偶发失败**：macOS 的 FSEvents
    高负载下会丢事件，watch 模式加每 5 秒的兜底轮询（未经 Codex 评审：额度见底）。
40. ~~F18 `web`~~ 已完成（2026-09-26）。127.0.0.1 上的只读看板：五列 / 树 / ready 队列，抽屉看验收标准、Log、验证证据；SSE 推全量。
    新层 board/ 只懂 HTTP 与监听（D039）：Host 头校验防 DNS rebinding、CSP、只允许 GET；fs.watch 出错、目录被重建、WSL 下改为轮询，
    另有 --poll。**顺带发现 ARCH-002 / ARCH-014 的注释过滤匹配空串，两条规则一直空转**——修好并补了正反例用例。
    Codex 评审三轮 → Go。WSL 分支本机未实跑。
39. ~~F17 `setup cursor / gemini`~~ 已完成（2026-09-26）。FR-A2a 原方案「压缩前把 prime 交给摘要」前提不成立（两家的
    压缩前钩子都不能改摘要），按一手来源改写（D038）：Cursor 用 sessionStart 注入 + alwaysApply 规则文件；Gemini 用
    PreCompress(manual) 打标记、下一轮 BeforeAgent 注入，context.fileName 含 AGENTS.md。Gemini 0.26.0 在真实运行时里用
    假 API 服务器实测（tools/probes/），0.61.0 源码核对。**Cursor 没能实测**（需要登录）——CLI / IDE 验证拆到 tp-zagvp5。
    Codex 评审：context:null 被覆盖、多根工作区漏注入，已修 → Go。
38. ~~F16 `setup pi`~~ 已完成（2026-09-26）。扩展与 OpenCode 插件同构（D037）。本机 pi 没有模型凭据，改用测试专用的
    echo provider 在真实 pi 运行时里验证会话开始与压缩后的注入——这个办法也许能补 OpenCode 的 tp-1ssqrw（已记在那里）。
    两轮评审：空结果在同一会话出现账本后重跑（OpenCode 同修）；项目级目标必须真的落在项目里（符号链接）。
37. ~~F15 `setup codex / opencode`~~ 已完成（2026-09-26）。两家都在本机实测（PRD §17）：Codex 与 Claude 同构，
    但压缩后 PostCompact 与 SessionStart(compact) 都触发，只装 SessionStart；项目级钩子要在 Codex 里信任。
    OpenCode 的 event 钩子不能注入，插件经 experimental.chat.system.transform 进系统提示（D036）。
    **OpenCode 压缩后注入没能实测**（免费模型不能压缩，其余凭据不可用）——拆到 tp-1ssqrw（用户定），等凭据。
    实测在你的 ~/.codex/config.toml 里留下了临时目录的信任记录（projects / hooks.state 各几条），可删。
36. harness：`clean-check` 的 state-updated 在 `--no-ff` 合并提交上改看被合并分支的末端（合并提交本身在
    `git show --name-only` 下是空的，以前每次合入 main 后都判失败；上一次我补了一个空的状态提交凑数）。
35. ~~F14 `setup claude`~~ 已完成（2026-09-26）。外部事实先重核：查文档的子 agent 说「PostCompact 不存在」，
    直查官方页面发现它错了——它存在，但 stdout 不进上下文；压缩后注入走 SessionStart 的 compact 来源。
    **真 Claude Code 会话实测**：会话开始、交互式 /compact 之后、退出，三次钩子都触发且注入生效（PRD §17）。
    七轮评审，后五轮在「合并用户的 settings.json」上：最后收成 D035——不校验用户别的钩子、连 matcher 语义都
    不猜，只认我们写出的标准组；「原样保留」收窄为 JSON 值。第一个经过验收门禁（9/9 勾选）关闭的自举任务。
30. ~~要不要把 open 自举任务的散文判据回填成勾选项~~ 已做（2026-09-26，用户定「改」）。8 个任务逐条
    拆分，一条对应一项核对，不增不减；任务标题本身是验收结果的另列一条并标「标题」。唯一改动：安装器任务的「依赖只有三个
    且都零传递依赖」已被 D031 改变，改为「限定在 ARCH-010 白名单内」。每个任务都记了一条 note。
    从此验收门禁对这 8 个任务生效（已关闭的仍是散文，不再经过门禁）。评审一轮要求拆细：一条勾选项
    只对应一项核对，标题结果按原题完整列出。
    F07 的地基已经齐了：Log 行的 `verify=` 现在恒为 `none`，F07 填 `pass`/`fail`；
    门禁骨架在 `commands/transition.ts`，`verify` 那道门加进 `domain/gates.ts` 即可，
    报告与动作走 `gateActions()`（`command` 无占位符、`template` 需填空）。

    F07 的两处硬要求：FR-D2 说超时**必须终止整个进程组**而不只是直接子进程——
    实测过运行时默认只向直接子进程发 SIGTERM，孙进程全部存活，而 `verify` 的
    典型值（`pnpm test`、`cargo test`）都会 fork worker，被遗弃的 worker 会继续
    占端口、写文件、烧 CPU。FR-D4 要求首次执行前按仓库路径确认信任，
    而**信任记录 MUST NOT 放在 `.todopi/` 内**——随仓库传播的信任记录等于让仓库
    为自己背书。FR-D4a 规定验证输出的去向：通过时不记录、强制关闭时记最后 512
    字节、完整输出写 `.todopi/.cache/verify/` 且不提交。
    地基已在 F04 打好，**不要重写**：身份解析链在 `domain/actor.ts`（纯函数）
    + `commands/actor.ts`（取外部事实），租约目录与锁路径由 `format/lease.ts`
    的 `leasePaths` 一次派生，租约读取是 `readHeartbeats`。
    F05 只需补租约的**写入**端（`O_EXCL` 创建、心跳、删除）与 `claim` / `release`。
    已知陷阱：spec §5.4 的规范化步骤有序，且取外部值时不能 `.trim()`。，通过后合回 `main`，然后 activate F05 `claim`。
    F05 的地基已经齐了，**不要重写**：解析链在 `domain/actor.ts`（纯函数）
    + `commands/actor.ts`（取外部事实），租约目录与锁路径由 `format/lease.ts`
    的 `leasePaths` 一次派生。F05 只需补租约的**写入**端（`O_EXCL` 创建、
    心跳、删除）与 `claim` / `release` 两个命令。
    一处已知陷阱：spec §5.4 的规范化**步骤有序**（小写 → 空白换 `-` →
    删非法字符 → 截断 64），且取值时不能 `.trim()`——那会吃掉值本身的首尾空白，
    与按规格实现的第三方得出不同身份（第二轮评审的阻塞项之一）。

   F03 是写入端基座：发射器（spec §5.1 的引号规则）、id 生成与碰撞检查、
   `fractional-indexing` 的 rank 分配、以及**文件锁**（`O_EXCL` + pid 判活 +
   退出清理）。锁建在 F02 的 `src/fs/atomic.ts` 之上，不替换它。
   D006 决策 5 明确把「并发压力测试进 CI 且不得 flaky」列为 F03 的真实成本。

   F02 与 F03 的实际边界（D011 拆分时说 F02「不需要原子写」，执行时收紧过一次）：
   **原子写在 F02**（`src/fs/atomic.ts`——config.yml 写到一半账本就坏了），
   **文件锁在 F03**（spec §8 的锁针对任务文件的读-校验-写，`init` 不写任务文件）。
   锁建在原子写之上，不替换它。

## Blockers

无。

## 更新约定

- Current State 每次 clock-out 必须更新，至少包含 commit 与 `make check` 结果。
  `Last commit` 写的是写这行时的 HEAD；`make clean-check` 校验它在当前历史中，
  并校验最后一个 commit 确实带上了本文件。
- 一个 session 结束时若还有任务处于 `in_progress`，必须在 In Progress 写明卡在
  哪一层、下一步要跑什么命令。（旧措辞说的是 `VCR < 1.0`，而 `make vcr` 已随
  自举删除——迁移损失表第十一条。）
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
