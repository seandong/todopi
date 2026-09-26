# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `48747b1` —— F14 setup claude 经 todopi done 关闭（verify=pass dirty=false，验收门禁 9/9）。
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
- 账本: `.todopi/` 21 个任务，14 个 `closed/done`（F01–F14）、7 个 `open`。
  **`make vcr` 已随 `feature_list.json` 一起删除**（迁移损失表第十一条）；
  这一行的计数由 `make status` 给出。
- 代码状态：**F01–F14 已完成（M1、M2 收齐，M3 开始）**。`doctor` / `init` / `add` / `ls`（及别名 `ready`）/
  `claim` / `release` / `done` / `close` / `reopen` / `show` / `note` / `check` /
  `edit` / `move` / `dep` / `prime` / `handoff` / `doctor --fix` / `setup claude` 可用。正文结构（标题、代码块）交给 commonmark 判定（D031）。写入端基座：发射器（spec §5.1 引号规则的唯一执行者）、id 生成、文件锁。
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
