# PROGRESS

跨 session 的状态交接文件。每个 session 结束前更新，不靠记忆、不靠聊天记录。
权威顺序见 [docs/harness/index.md](docs/harness/index.md)。

## Current State

- Last code commit: `1f874a2` —— 交互终端 `--help` 用现有样式策略高亮标题、命令与选项（tp-ktfizt）；`done` 的 `make check` 为 `pass`，记录 `commit=1f874a2 dirty=false`。`prime` 仍是无 ANSI 的 Agent 上下文文本。GitHub 主页为 `https://todopi.com/`，仓库仍 private；v0.2.0 标签仍指向 `6fa0d4b`。
- `make check`: `pass` —— Layer 1 五项：docs-links / spec-version / prd-present /
  arch-rules（**28/29 条通过、1 条不适用**，ARCH-019/021 与 clean-check 的 no-debug-artifacts 于 2026-09-23 收窄，其中 ARCH-020 有 16 条正反例）/ typecheck（`pass`，tsc --noEmit）
- `make test`: 本地 `pass`（2026-10-08），帮助输出新增真实 CLI 测试：彩色帮助去转义后与纯文本逐字一致；Agent、管道、JSON、钩子、NO_COLOR、TERM=dumb 均无 ANSI。看板历史偶发失败尚未定位，需在下次复现时保留完整堆栈。
- `make e2e`: 本地 `pass`（2026-10-08），CLI 全部端到端脚本退出 0；运行时有一条临时目录清理权限提示，未令门禁失败。原远端 Harness 的 e2e:f31-private-tmp 失败是 README 单测失败造成的级联（嵌套 `make test` 返回 1），临时目录清理检查本身通过。
- `make clean-check`: `pass` —— 收尾提交 `04014c6` 后和快进合回 main 后各通过一次；第 5 维 diff 聚焦度人工核对，只涉及任务账本和 PROGRESS。
- `make audit`（课程校验器）: 本次未重跑；早期结果 58/73 已过期，不能据此判断当前状态。
- 账本: `.todopi/` 53 个任务，50 个 `closed/done`、3 个 `open`（tp-0obw6s 需下一次完整失败堆栈；tp-ujjc6y brew 实测；tp-zagvp5 Cursor 实机验证）、0 个 `in_progress`。
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

**无。** tp-ktfizt 帮助输出高亮已完成，终端 `--help` 使用现有颜色判定；Agent、管道、JSON、钩子、NO_COLOR、TERM=dumb 仍是纯文本，`prime` 未改。仓库仍 private，匿名 raw 安装脚本和 Release 下载须在可见性变更后另行实测。上轮主线 Harness / Install 已通过；本轮分支尚未推送。

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

**remote 状态**：`origin` 是私有的 `github.com/seandong/todopi`。`v0.2.0` 已推送，标签 peeled SHA 为 `6fa0d4b`。主线 Harness `37098785798` / Install `37098785838`，标签 Release `37406508070` / Harness `37406508071` / Install `37406508057` 全部成功。Release 为正式版，共 7 项资产；四个平台归档通过 SHA256SUMS，npm tarball SHA512 与公开 registry 的 `dist.integrity` 一致。Homebrew tap 更新因无 token 跳过，私有仓库的 Release 资产仍不支持匿名安装。

## 里程碑

迁移自 `feature_list.json` 的 `milestones`。分组本身进了任务的 `labels`
（`m1`/`m2`/`m3`），而「什么时候算完成」是叙述性上下文——按契约「PROGRESS.md 与
DECISIONS.md 不迁移」的同一理由留在这里。

- **M1**（F01–F07，共 7 条）——docs/harness/state-migration.md 的三个触发条件全部满足，仓库切换到用 todopi 管自己
- **M2**（F08–F13，共 6 条）——20 个子命令中与日常回路相关的全部可用，dogfooding 不再需要手工绕开任何环节
- **M3**（F14–F21，共 8 条）——PRD §13 首发清单中与代码相关的条目全部可勾

## Next Steps

按编号保留已完成工作的记录；当前可接手的任务以 `todopi ls --ready` 为准：tp-zagvp5 的 CLI sessionStart 注入和 alwaysApply 规则已有隔离实测，sessionEnd、真实压缩、IDE 和 --user 仍待验证；tp-0obw6s 需保留下一次失败的完整堆栈；tp-ujjc6y 待 brew 实装。当前帮助高亮提交留在 `feat/interactive-help-color` 本地分支，尚未推送。仓库仍为 private；README 只展示已验证的 npm 安装。可见性变更后需从匿名环境验证仓库、原始安装脚本、Release 校验文件和二进制的可达性及实际安装；Homebrew tap 单独核实。官网部署另受 TripREC 旧隐私 URL 门槛约束。

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
71. ~~tp-nxy1hu v0.2.0 发布~~ 已完成（2026-10-06）：主包、锁文件、运行时 VERSION、六家插件清单升为 0.2.0；README / CHANGELOG 更新。`make check`、完整 `make test`（1013/1013）、`make e2e` 通过；本地 npm pack 装入隔离前缀，在全新 git 仓库实跑 `init --setup claude`、doctor 和 done 门禁。私有仓库的匿名 raw URL 和 Release 资产不可直接下载，README 改以公开 npm 为默认安装入口，并说明 brew 需公开资产、旧 PATH 二进制可能遮蔽新版。`v0.2.0` 标签指向已验证的 main `6fa0d4b`；发布工作流、主线与标签 Harness / Install 均成功。公开 registry 安装实跑 `--version`、`init --setup claude`、doctor；Release 7 项资产中四个平台归档通过 SHA256SUMS，npm tarball SHA512 与 registry `dist.integrity` 一致。独立子代理对发布后证据评审 Go；`done`: verify=pass commit=e02febc dirty=false。仓库仍私有，brew tap 更新因缺 token 跳过；tp-ujjc6y、tp-zagvp5 继续独立待办。
70. tp-0obw6s 看板测试偶发失败（2026-10-02 阶段性加固）：原 2026-09-28 失败仅留 `not ok 5 - tests/commands/board.test.ts` 文件级摘要，具体断言 / 堆栈已被 grep 过滤且未保存；无法确认根因。将三处固定 sleep 的正向轮询断言改为等待实际回调，写后以写前回调数为基线，兜底轮询保留原 400ms 界；三层验证通过，子代理评审两轮 → Go。三次修改前及两次修改后整套测试都通过，不能据此宣称原 flake 消失。任务 note 留了原证据边界和下次复现的捕获要求，已 release 为 open，待抓到完整失败堆栈后继续。
69. ~~tp-hxa6yp 错误与警告整句强调~~ 已完成（2026-10-02）：Cargo 式 `error:` 与 `warning:` 标签保留红/黄色，正文整句加粗，门禁任务 id 仍青色；PLAIN / MONO 无转义，FORCE_COLOR 管道仍仅上色。右下 Herdr pane 的独立新项目实测 done 门禁拒绝和强制完成警告，三层验证全绿，独立只读评审 Go。`done`: verify=pass commit=03c679b dirty=false。e2e 曾报临时目录清理 Permission denied，但整体通过；tp-0obw6s 待查。
68. ~~tp-jyvt6i `init --setup <agent>`~~ 已完成（2026-09-28）：dogfood 反馈，初始化时一并接入 agent（可重复、可逗号分隔）；未知 agent 与空 --setup 写之前报错；
    某一家失败时错误里说清已写文件、失败的一家（可能已写一部分，重跑安全）、还差哪几家与恢复命令（带 -C <root>；路径含会被转义的字符时改说在项目根下跑）。
    InitReport 新增可选 setup: SetupReport[]。Codex 五轮 → Go。真终端（herdr pane）里跑过。
67. ~~tp-rk6o8q 终端输出统一为 Cargo 式~~ 已完成（2026-09-28）：dogfood 反馈「init 输出真丑」，用户选 Cargo / uv 式、所有命令统一。style.ts（PLAIN / MONO / ANSI / ANSI_PIPED，
    唯一判定 chooseStyle）+ render/layout.ts（动作行、task、error/warning/note、Next）；有没有人在看（interactive）与上不上色分开——管道里只有数据行，
    ls | head -1、wc -l 照旧；--json、钩子、agent 在场一律纯文本。错误统一 error: 前缀、控制字符可见转义。ARCH-029：转义只在 style.ts。
    子进程测试逐条跑 23 个命令守住不上色。prime / handoff 排版不动。D059。Codex 三轮 → Go。另建 tp-0obw6s（board.test 偶发失败）。
    合并后 CI 的 f21 红：只在有 Docker 时跑的容器用例还断言旧 ls 的 `[done] first`（本机无 Docker，文字断言清单漏了 [done] 一类），已改成新格式。
66. ~~tp-ornltg 发布工作流修复，v0.1.0 发布~~ 已完成（2026-09-28）：首次推标签失败在 npm publish（`out/x.tgz` 被当成 GitHub 简写）；改 ./out/、加 tests/workflows.test.ts，
    按 Codex 三轮评审加固（npm 已有同版本只在 integrity 相同时跳过、发布前核对标签、`--verify-tag`、Release 已存在以已发布资产为准）。
    用 --force-with-lease 把 v0.1.0 移到新 main；第二次失败在 EOTP（令牌没勾 bypass 2FA），维护者换令牌后重跑成功。
    **npm 上有 todopi@0.1.0，GitHub Release 附四个平台二进制、SHA256SUMS、formula。** npm 与 install.sh 的 npm 路径实装通过；
    **仓库仍是私有的**：raw install.sh、Release 资产匿名下载都 404，二进制路径与 brew 要等维护者公开仓库后再实测。
65. ~~tp-i3zabw 版本号改为 0.1.0~~ 已完成（2026-09-28）：package.json / lock / src/version.ts 与六家包清单；README 不再说未发布；CHANGELOG.md（进 npm 包）。
    npm pack 实装验证。NPM_TOKEN 已由维护者配好。Codex 一轮 → Go。下一步：维护者打 `v0.1.0` 标签，发布工作流发 npm、二进制与 Release。
64. ~~tp-lv7y3h 六家市场 / 注册表的包与 awesome 条目~~ 已完成（2026-09-28）：tools/plugins/build.mjs 从 setup 的同一份源生成 plugins/ 与 packages/、三份市场文件，
    tests/plugins.test.ts 防漂移。本机沙箱逐家装过：Claude Code、Codex 真模型，Gemini、OpenCode、pi 走假 API——会话开始都收到 prime，叠上 setup 的钩子都只注入一次；
    Cursor 未登录，并入 tp-zagvp5。实测抓到 Codex 清单必须在 .codex-plugin/、Gemini 压缩标记并发被取走多次（APFS 并发 unlink 可都成功 → 锁内取）。
    docs/marketplaces.md 列维护者步骤与 awesome 条目。D058。Codex 一轮 → Go。下一步：剩下的都是维护者的动作（发布、上架、tp-ujjc6y、tp-zagvp5）。
63. ~~F38 setup 的钩子与市场包同时装了时 prime 只注入一次~~ 已完成（2026-09-28）：prime --hook 在账本锁里按 agent|事件|会话 占位，10 秒内第二次什么都不印，
    判定在 prime 之前（被挡下的不写 prime 记录、不挪 handoff 基准）；无会话 id 与 --if-compacted 不去重，出错放行。OpenCode 插件 / pi 扩展把事件名传给 prime，
    进程内的第二份用 performance.now() 5 秒窗口判定不注册（重载、墙钟回拨后照常注册）。D057。Codex 四轮 → Go。下一步：回到 tp-lv7y3h。
62. ~~F37 规格语料的说明译成英文~~ 已完成（2026-09-28）：25 条 note / reason；评审抓到两处跟着原文带过来的问题（unquoted 语料说 doctor --fix 全部加引号——
    自 F30 起不对；「允许」被译成「要求」）。测试钉住说明字段不再有中文。Codex 两轮 → Go。
61. ~~F36 prime 回到 200 ms 以内~~ 已完成（2026-09-28）：快照紧跟校验取、复用上一段正文的解析，git 公共目录一次运行只问一遍（缓存键带 .git 身份），
    prime 记录不 fsync。同机交替 A/B：prime 225 → 186、prime --full 221 → 188 ms，ls / doctor 不变。高负载下单次基准的中位数仍会飘到 220 左右，
    空闲机器上的绝对值待 CI / 空闲时确认。D056。Codex 两轮 → Go。
60. ~~F35 prime / handoff 的可见转义覆盖零宽与双向文字字符~~ 已完成（2026-09-28）：并入 domain/visible.ts（全仓一份），ARCH-027 按同一 Unicode 类别检查、
    夹具加 U+200B / U+202E。D055。Codex 一轮 → Go。
59. F34 Homebrew formula（部分完成，2026-09-28）：tools/brew/formula.mjs 按 SHA256SUMS 生成（四个平台逐个 sha256，缺平台 / 坏版本 / 冲突的重复即失败），
    release.yml 附上并在有 HOMEBREW_TAP_TOKEN（只注入那一步）时更新 tap；docs/brew.md。本机临时 tap 实测：下载与校验、改坏 sha256 被拒、brew style
    通过，**安装被过旧的 Command Line Tools 拦下**——验收标准 3 未勾，任务已 release，等维护者更新 CLT 或 tap 上线后实测。D054。Codex 两轮 → Go。
58. ~~F33 格式规格站点（首发清单 §13）~~ 已完成（2026-09-28）：tools/site/build.mjs（make site）从 spec/ 生成静态页（规格、12 字段表、实现者笔记、
    语料库与每个语料一页），无脚本、不加载外部资源（原始 HTML 显示成文字、危险链接拿掉、图片变普通链接）；部署是维护者的事（docs/site.md）。
    D053。Codex 四轮 → Go。另建 tp-i8vcpd（语料说明改英文）。
57. ~~F32 import beads 用更多真实导出测过（首发清单）~~ 已完成（2026-09-28）：六个别的公开仓库的 .beads/issues.jsonl（按提交钉住，1,211 行）
    全部导入、doctor 通过、重复导入 0 新建。发现自定义状态（cancelled / done）被静默建成 open：导出里没有状态类别，仍照 open 建，但按状态汇总警告，
    给 todopi id（带 Beads id）与关法。D041 补记。Codex 三轮 → Go。
56. ~~F31 make test / make e2e 不在系统临时目录里留垃圾~~ 已完成（2026-09-28）：磁盘写满（系统临时目录攒了 23.6 万个 todopi-* 目录，5.7 GB）。
    harness 的 test / e2e 在私有 TMPDIR 里跑、退出时删；打断时按运行记号停掉孤儿测试进程（node --test 的测试文件进程在自己的进程组里，Ctrl-C 到不了）
    再删。清掉了攒下的约 6 GB。Linux 的 /proc 分支首次实跑在 CI。D052。Codex 三轮 → Go。
55. ~~F30 规格措辞：doctor --fix 保留 updated 的原文~~ 已完成（2026-09-28）：§5.1 写明引号规则的唯一例外，§6.3 写明逐字节保留（引号、形态、注释）
    与非规范 updated 的去向，§9.1 修订记录。顺带修了 doctor 的 invariant-6 对非规范时间戳按字符串比的误报。D051。Codex 一轮 → Go。
54. ~~F29 性能基准（PRD §10）~~ 已完成（2026-09-28）：tools/bench/ledger-2000.sh 确定地生成 2,000 个任务（形状运行时印出）、doctor 把关、
    各命令热身后取中位数；CI 里跑、不设阈值。参考结果（Docker Linux 虚拟机，宿主 M4 Pro）：ls 155、show 85、doctor 148、prime 215 ms——
    prime 超出 200 ms，拆出 tp-fpy1s4。D050。Codex 三轮 → Go。
53. ~~F28 README 首发版（FR-A4、首发清单 §13）~~ 已完成（2026-09-28）：六家各一节（setup、写的文件、压缩后怎么恢复、Codex 钩子与 pi 项目要信任）、
    PATH、--user 的范围、install.sh 的分支与二进制平台、协议（链 src/protocol.ts）、vs Beads（按 Beads 当前 README 核实）、读音。纠正 done 可强制、
    体积按文件大小。tests/readme.test.ts 把易过时的事实与实现对着查。D049。Codex 三轮 → Go。
52. ~~F27 --json 输出契约（FR-Q3）~~ 已完成（2026-09-28）：docs/json.md（通则、兼容承诺、命令→报告对照、逐类型字段表）；ARCH-028 用 tsc
    把每节与真实导出类型做精确相等断言，导出清单读 tsc 产出的声明文件、未知导出形式 / 子目录 / 同名导出失败关闭；另有真跑每个命令的映射测试。
    D048。Codex 八轮 → Go（七轮都是检查器的绕过，文档本身无误）。新建 tp-yce3ah（prime / handoff 的可见转义覆盖零宽与双向文字字符）。
51. ~~F26 首次执行 verify：有终端时当场确认（FR-D4）~~ 已完成（2026-09-28）：stdin 与 stderr 都是终端时拿锁之前问一次，命令按 Unicode 类别
    可见转义（控制 / 格式 / 默认不可见 / 非普通空白，否则 ESC 序列或零宽字符能把命令藏起来）；EOF 不算同意，CR 也结束答案。无终端、--yes、
    CI=true 不变。D047。Codex 三轮 → Go。
50. ~~F25 格式版本更高的账本：读照常、写退出 4（spec §9）~~ 已完成（2026-09-28）：闸门从读取口挪到写入口（withLedgerLock 拿锁前后各判一次、
    init、各落盘处），读磁盘上此刻的版本；createTask 原先绕过了闸门（e2e 发现）。handoff 整条退出 4，prime 会话状态不写不取。D046。Codex 四轮 → Go。
49. ~~F24 建好之后改验收标准与 Plan；add / edit --edit（FR-T4）~~ 已完成（2026-09-28）：edit 的 --plan、--ac-add / --ac-set / --ac-rm
    （编号是编辑前的编号），add --plan，add / edit --edit（只在终端里开 $VISUAL / $EDITOR）。已勾选的标准文字与编号都不变，AC 小节里的
    嵌套项与普通文字原样保留（spec §5.3.2），编辑器开着时任务被改则冲突退出。D045。Codex 三轮 → Go。
48. ~~F23 CLI 表面补齐~~ 已完成（2026-09-28）：FR-Q4 别名（list、new / create、log、block，帮助里都看得见）、close --reason 不用 --force、
    --quiet 覆盖 setup / import / web、done 被拒时给 todopi check（照着跑就能过）。D044。Codex 两轮 → Go。
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
