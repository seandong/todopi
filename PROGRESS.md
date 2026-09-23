# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `5591680` —— F07 第一轮评审的三条阻塞项已修。
  HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（**22 条全部通过**，其中 ARCH-020 有 16 条正反例）/ typecheck（`pass`，tsc --noEmit）
- `make test`: `pass` —— `fixtures`（语料质量）+ `unit-test`（`node --test`，
  **601 个用例**）。其中 53 个是语料库驱动的一致性断言，已用变异测试确认它们会咬。
  锁有一条多进程用例——10 个单进程用例在锁存在致命竞态时全部通过，只有它会红
- `make e2e`: `pass` —— `f01-doctor` 11 项 + `f02-init` 19 项 + `f03-add` 13 项 +
  `f04-ls` 24 项 + `f05-claim` 47 项 + `f06-gates` 66 项 + `f07-verify` 38 项。f03 的并发压测（20 个 add 产出 20 个不同 id 与 rank）
  是单元测试抓不到的那类；Codex 第二轮评审另补了跨 worktree 锁测试
  （30 进程计数 30、无残留），确认 `leasePaths` 重构没有回归
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: 58/73，CRITICAL 6/7，RECOMMENDED 52/66。唯一的
  CRITICAL FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省
- VCR: `7/7` —— F01–F07 均 `passing`，evidence 由 harness 写入
- 代码状态：**F01–F04 已完成**。`doctor` / `init` / `add` / `ls`（及别名 `ready`）
  可用。写入端基座：发射器（spec §5.1 引号规则的唯一执行者）、id 生成、文件锁。
  读出端：spec §7 的派生态与 §7.4 的排序都在 `domain/` 的纯函数里，
  `TaskDto` 定下了 `--json` 这个公开 API 的第一块形状。
  身份解析（FR-C4 前三级）在 `domain/actor.ts` + `commands/actor.ts`，`ls` 与
  `add` 共用。运行时依赖三个：`commander`、`yaml`、`fractional-indexing`

## In Progress

**F07 `verify`** —— 三层通过、`passing`，在分支 `feat/f07-verify` 上，
尚未合回 `main`。**第一轮评审 No-go，三条阻塞项已修，待第二轮。**

1. **日志不是完整输出，而那个「上限」也没有限制内存。** runner 把每个 chunk 攒进
   数组、退出时才 concat 再截尾——截尾只让返回值变小，concat 之前那份内存一直在
   涨，超过 1 MiB 的输出在写盘前就丢了。计划文档第 57 行写的正是「全缓存在内存里
   不合适」，实现却反着来。而我的用例只断言返回的字符串短，**无界版本照样绿**。
   改成流式落盘 + 有界尾部环 + `pipe` 的背压（背压那条判据故意不用 RSS，基线就
   100 MB、差距只有 1.5 倍；改问「日志挂住的那几秒里子进程写完了没有」）。
2. 同上，同一个根因。
3. **FR-D2 的 Windows MUST 与平台表「Windows 尽力」自相矛盾**，收窄到 POSIX（D026）。

两条「应该改」也照做了：「整棵树」这个承诺过宽（PRD 写的一直是进程**组**，漂的是
feature_list、测试名、计划文档）；特殊字符检查从一次性脚本变成仓库用例——写的时候
发现原来那组断言本身就是「看起来在测 X、实际只测了 Y」：条数、末条可解析、doctor
三个加起来都看不见一个被注入的假 `## Log` 小节。

在等的这段时间，我把发给它的那几条最尖的检查自己跑了一遍（Log 语法撞车、
刁钻进程树、求值顺序、输出落点、信任边角），抓到两处：

1. 信任文件的位置被占成目录时抛裸 `EISDIR`，使用者无从知道该动哪里。已改成
   说得清的错误。
2. **我自己那条「孙进程用 setsid 脱离组」的检查是假绿**——macOS 没有 `setsid`
   可执行文件，用例走了 `||` 的回退分支，等于又测了一遍普通情形。用 Node 的
   `detached` 重新构造后确认：**主动脱离进程组的后代确实杀不到**。这是进程组
   终止的固有边界（替代方案是遍历 `ps` 追整棵树，跨平台既不可靠也有竞态），
   现已如实写进 `run.ts` 的注释并钉成一条用例——哪天有人「修好」它，那条会红，
   然后他会读到那段说明。

**状态迁移的触发条件到此齐了**（[状态迁移契约](docs/harness/state-migration.md)）：
spec 定稿 ✅、doctor 能检出违规 ✅、五个命令 passing **5/5**
（`init`、`add`、`claim`、`done`、`verify`）。**自举可以开始了。**

本 feature 改过 PRD 一处：FR-D3 明确「`--force` 绕过的是门禁那次拒绝，**不是
`verify` 的执行**」。两条规则本来对不上——FR-D3 说绕过任何门禁，FR-D4a 又说强制
关闭时记录 verify 输出的最后 512 字节「因为证据必须留在 diff 里看得见」；
若 `--force` 连执行都跳过，那条规则永远走不到。方案由产品负责人选定。

新增 `src/exec/` 层（与 `fs/` 同级，只 import `node:*`），**在同一提交里登记
ARCHITECTURE.md 并加 ARCH-021**；信任记录另有 ARCH-022 钉死它不进 `.todopi/`。
现在 22 条架构规则。

核心是一条实测结论：**默认方式杀不掉孙进程**。`spawn` + `child.kill()` 之后孙进程
仍然存活，只有 `detached: true` + `process.kill(-pid)` 才终止整棵树——而 `pnpm
test`、`cargo test` 都会 fork worker。实现因此分成两个进程：`done` 在文件锁内串行
执行所以调用必须同步，而「独立进程组」只有 Node 的**异步** spawn 支持。

F01–F06 已合回 `main`。**整个仓库尚未推送到 remote。**

`feature_list.json` 于 2026-09-16 填入 21 条，拆分依据见 DECISIONS D011。

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
25. **下一步：请 Codex 评审 `feat/f07-verify` 并合回 `main`。**
    F07 的子进程与信任面是全新的，而且「`--force` 照跑 `verify`」这条读法是新拍板
    的，值得让第二双眼睛核一遍它与 §5.3.3 的 Log 语法、§6.1 的「被拒绝的迁移不写
    Log」是否处处自洽。
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
- 一个 session 结束时若 VCR < 1.0，必须在 In Progress 写明卡在哪一层、
  下一步要跑什么命令。
- 本文件记录**状态**，不记录决策理由。理由写进 [DECISIONS.md](DECISIONS.md)。
