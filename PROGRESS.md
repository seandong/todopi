# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last commit: `dbe34b9` —— F06 第二轮评审整改完成。
  HEAD，提交后它是新 HEAD 的父
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（**20 条全部通过**，其中 ARCH-020 有 16 条正反例）/ typecheck（`pass`，tsc --noEmit）
- `make test`: `pass` —— `fixtures`（语料质量）+ `unit-test`（`node --test`，
  **525 个用例**）。其中 53 个是语料库驱动的一致性断言，已用变异测试确认它们会咬。
  锁有一条多进程用例——10 个单进程用例在锁存在致命竞态时全部通过，只有它会红
- `make e2e`: `pass` —— `f01-doctor` 11 项 + `f02-init` 19 项 + `f03-add` 13 项 +
  `f04-ls` 24 项 + `f05-claim` 47 项 + `f06-gates` 62 项。f03 的并发压测（20 个 add 产出 20 个不同 id 与 rank）
  是单元测试抓不到的那类；Codex 第二轮评审另补了跨 worktree 锁测试
  （30 进程计数 30、无残留），确认 `leasePaths` 重构没有回归
- `make clean-check`: `pass`（第 5 维 diff 聚焦度需人工判断）
- `make audit`（课程校验器）: 58/73，CRITICAL 6/7，RECOMMENDED 52/66。唯一的
  CRITICAL FAIL 是「缺依赖 lockfile」——当前没有任何依赖，属有意缺省
- VCR: `6/6` —— F01–F06 均 `passing`，evidence 由 harness 写入
- 代码状态：**F01–F04 已完成**。`doctor` / `init` / `add` / `ls`（及别名 `ready`）
  可用。写入端基座：发射器（spec §5.1 引号规则的唯一执行者）、id 生成、文件锁。
  读出端：spec §7 的派生态与 §7.4 的排序都在 `domain/` 的纯函数里，
  `TaskDto` 定下了 `--json` 这个公开 API 的第一块形状。
  身份解析（FR-C4 前三级）在 `domain/actor.ts` + `commands/actor.ts`，`ls` 与
  `add` 共用。运行时依赖三个：`commander`、`yaml`、`fractional-indexing`

## In Progress

**F06 `done` / `close` / `reopen`** —— 三层通过、`passing`，在分支 `feat/f06-done` 上，
尚未合回 `main`。**第三轮评审待发。**

Codex 第一轮：**No-go，4 个阻塞项**，全部整改完毕（DECISIONS D022）。
其中三个是同一种错误的不同形状——边界只用到我想到的入口（`reopen` 走了另一条
分支，D019 那条边界第四次被漏）、权限只覆盖我理解的范围（`--force` 被当成万能
钥匙，连状态机也越）、门禁只按笼统那段话而不是明确那张表（`close` 查了验收标准）。
共同点是**按脑子里的模型做，没有逐条对回规格原文**。

还有一条最该记的：**Codex 是读我的测试发现问题的**——我写了一条标题叫
「D019 的边界用到三条命令上」的用例，循环里只有两条。「看起来在测 X、实际只测了
Y」换了个形状又来一次。

Codex 第二轮：**No-go，2 个阻塞项 + 2 条应改**，全部整改完毕（DECISIONS D023）。
**其中两条来自 D022——我把没做到的事写成了已完成的事实**（「文本与 JSON 共用
动作」「CRLF 写回自然回到 LF」），两句已在 D022 就地标注。决策文档里的一句假
陈述比代码缺陷更难发现，因为后来的人会拿它当前提。往后凡写进 DECISIONS 的行为
断言，要么当场验证，要么写成「预期」而不是「已完成」。

另外「看起来在测 X、实际只测了 Y」在本 feature 出现了**第三次**：这次是断言的
方向只有一半（只检查「JSON 的命令出现在文本里」，文本多一条、detail 分叉、
甚至文本压根不调用 gateActions 都不会红）。

本 feature 改过一次规格：spec §6.1 表格的 `close --as` 改成 `close --resolution`
（短写 `-r`），PRD FR-D5 与命令参考同步。理由是实测出来的——全局 `--as` 是 actor
（FR-C4），撞名时 commander 让全局优先，`todopi close tp-1 --as wontfix` 会把
**actor 设成 `"wontfix"`** 而 resolution 为空，静默写坏。试过
`enablePositionalOptions()` 保住原形，但它会让 `todopi ls --json` 报
unknown option，而那是命令参考与协议文本给 agent 的写法。改的是 CLI 标志名不是
格式语义，按 §9 不升 `version`。方案由产品负责人选定。

**三条迁移命令共用一份骨架**（`commands/transition.ts`）。这是对 F05 那个教训的
直接应对：「共享租约也要查」那条边界在 F05 里被我按入口一个个加、漏了三次
（D019）。同一个骨架意味着下次再立新边界时三条命令自动一起拿到——这次归属门禁
同时看任务文件的 assignee 与共享租约，三条一并生效。

F01–F05 已合回 `main`。**整个仓库尚未推送到 remote。**

自举触发条件（[状态迁移契约](docs/harness/state-migration.md)）：spec 定稿 ✅、
doctor 能检出违规 ✅、五个命令 passing 进度 **4/5**（`init`、`add`、`claim`、
`done` 已完成，**只差 `verify`**，那是 F07）。

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
22. **下一步：请 Codex 评审 `feat/f06-done` 并合回 `main`**，然后 activate F07
    （`verify` 的执行与超时终止整个进程组）。F07 完成后状态迁移的触发条件就齐了。
    **下面这段是给 F06 评审看的**：
    F06 的报告是 agent 唯一能看到的东西，值得重点审「它是不是真的不需要再跑
    别的命令就能据以行动」。另外三条命令共用 `commands/transition.ts` 的骨架，
    请确认那条共享租约边界三处都生效。

    F07 的地基已经齐了：Log 行的 `verify=` 现在恒为 `none`，F07 填 `pass`/`fail`；
    FR-D2 要求超时**终止整个进程组**而不只是直接子进程——实测过运行时默认只向
    直接子进程发 SIGTERM，孙进程全部存活，而 `verify` 的典型值（`pnpm test`、
    `cargo test`）都会 fork worker。
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
