# 自举：`feature_list.json` → `.todopi/`

**Goal:** 用 todopi 自己管理 todopi 的开发任务，删除 `feature_list.json`，
让「当前在做什么」只有一个答案。

**Spec:** [docs/harness/state-migration.md](../harness/state-migration.md)（契约，
含字段映射与「迁移完成的同一个 commit 内必须一起做完」五条）

**触发条件已满足 5/5**：spec Stable ✅、doctor 能检出违规 ✅、
`init`/`add`/`claim`/`done`/`verify` 五个命令全部 `passing` ✅。

**Architecture:** 一次性、原子。契约写着 **MUST NOT 让两套状态并存**，而
ARCH-006 已经把这条钉成机器规则（`applies_when: test -f feature_list.json`，
`.todopi/` 一出现就 fail）。所以迁移只能是一个 commit：`.todopi/` 建立、
`feature_list.json` 删除、harness 与文档改写，同时发生。

## Dry run 的结论（已实测，2026-09-23）

在 `git worktree` 副本里跑过 `init → add → claim → done`：

| 问题 | 结论 |
|---|---|
| e2e 脚本会不会打到仓库自己的 `.todopi/` | **不会**。全部 `cli` 调用都带 `-C "$TMP/..."`，已逐条核对 |
| 测试会不会读仓库自己的 `.todopi/` | **不会**。全部用 `mkdtemp` |
| `make check` 删掉 `feature_list.json` 后会红在哪 | **两处，都由本次迁移解决**：必需文件表（harness.sh:252）要去掉它；ARCH-006 的 `applies_when` 挂在它身上，删后自动 `not_applicable` |
| `todopi done` 跑三层合并命令跑得通吗 | **跑得通**，且门禁报告正确——dry run 里它如实拒绝了（因为当时 `.todopi/` 与 `feature_list.json` 并存，ARCH-006 正在 fail），并给出能直接跑的下一步 |
| 意外发现 | `todopi init` 会往 `AGENTS.md` 追加协议段。迁移时要预期这处改动 |

## 损失 / 替代物

契约只预告了一条损失。损失表 **三条 → 五条 → 八条 → 十条 → 十二条**（最后两条是
执行**之后**的评审才找出来的——这本身就是这份清单的结论：纸面上穷尽不了），每一轮评审
都实测出新的。第三轮我问它「还有没有第九条」，它的回答是**「至少还有，但我无法证明
已经穷尽」**——那比一句「没了」有用得多，也是这份清单该有的态度。彩排（Task 5）
存在的意义就是接住这份清单没接住的。

| 没了 | 替代物 | 说明 |
|---|---|---|
| `layers[].label` 的分层报告与 `not_applicable` | **无** | 契约已接受：`verify` 是一条命令行，只有一个退出码，`a && b && c` 里跳过的层和通过的层都表现为「没让整条命令失败」 |
| `make reverify` | **无** | 它存在是因为 evidence 曾指向错误的 commit。CLI 里重跑一个已关闭任务的验证会被状态门禁拒绝。记进 PRD §15 |
| `make activate` 的 WIP=1 与「依赖未关闭不许开工」 | **ARCH-023，但是降级** | 见下 |
| `make test` 的其余维度（`fixtures`、`no-skipped-tests`、`test-not-filtered`） | **改 `verify` 命令挽回** | 第一版计划直接搬了 `node --test`，会绕过它们。改成 `make check && make test && bash tools/e2e/fNN-*.sh` |
| `verify-feature` **拒绝把脏工作区的结果归给 HEAD** | **无，改成工作流约定** | `todopi done` 允许脏工作区，只在 Log 记 `dirty=true`。AGENTS.md 写明「先提交再 done」；`dirty=true` 该不该成为门禁，记进 PRD §15 —— 这是自举第一天就问出来的产品问题，正是它该有的作用 |
| 旧状态机的三条约束：**不许跳级**（`not_started` 不能直接到 `passing`）、**`passing` 是终态**、**禁止手工编辑 `state`/`evidence`** | **部分，靠工作流** | todopi 允许 `open → done`（不必先 claim）与 `closed → reopen`。「历史证据不被改写」这条因此从机器约束降为约定。AGENTS.md 写明「先 claim 再干活」；`reopen` 留着是对的——它是格式规格的一部分，不该为本项目的偏好去改产品 |
| `milestones`（M1/M2/M3 的 `features` 分组与 `done_when`） | **分组进 `labels`，`done_when` 进 PROGRESS.md** | 评审指出我会静默丢掉它。分组用 `labels: ["bootstrap", "m2"]`；`done_when` 是叙述性上下文，按契约「PROGRESS.md 与 DECISIONS.md 不迁移」的同一理由归 PROGRESS |
| `schema`（字段清单与「state/evidence 不得手工编辑」的注记） | **无** | 它描述的是 `feature_list.json` 自己的结构，随文件一起消失。那条注记的精神移到上面一行 |
| **完成不再要求存在验证命令** | **ARCH-023 第三条** | 旧 `verify-feature` 对空 `layers[]` 明确拒绝；而 `todopi add` 的 `--verify` 可以省略，无 `verify` 的任务能被 `done`，Log 记 `verify=none`（评审实测）。迁移的 21 条都有命令，**日后新建的开发任务没有这道保障**。加进检查器：本仓库的每个任务都必须有 `verify`；确实无可验证时显式写 `verify: "true"`——那是一次看得见的决定 |
| 失败时**立即打印对应层的 `repair`** | **无** | 旧 harness 在失败层当场打印 `layers[].repair`；现在它只存在任务正文里，`done` 的拒绝报告不会自动带出来。失败后自己去读：`cat .todopi/tasks/<id>.md` 的 Repair 段（`todopi show` 要等 F08）。记进 PRD §15：拒绝报告该不该带上任务正文里的 Repair |
| **VCR 与「session 末未完成」提醒** | **无** | 评审在执行后才指出——前十条没有它。`make vcr` 的计数源是 `feature_list.json` 的 `state`，随文件一起消失。对应信号现在分散在 `make status`（就绪队列 + 在做）与 ARCH-023（第二个 in_progress 报警），但「这个 session 认领的活干完了没有」这个提醒没有了 |
| `make status` 的**最近 check overall + generated_at**、**PROGRESS 的 Current State 全文**、**closed/open 计数** | **已恢复** | 我改写 status 面板时把这三样一起弄丢了，只剩结果文件名和一行 Last commit。评审在执行后指出。**这一条不是迁移的必然代价，是我改写时的疏漏**——已全部补回，如实留在表里，因为它说明「重写一个入口时，丢掉的东西不会自己喊」 |

### ARCH-023 是**降级**，说清楚

`make activate` 在**认领时拒绝**：WIP=1、依赖未关闭不许开工。ARCH-023 只能**事后
发现**。这是约束降级，不是等价替换。

**为什么不做薄包装保住它**：契约第 3 步要求 AGENTS.md 的工作流直接改成
`todopi claim` / `todopi done`，那么一个没人调用的 `make activate` 保不住任何
东西——人照着文档敲 `todopi claim` 就绕过去了。事后检查反而更强：**不论谁、用什么
方式**把第二个任务变成 `in_progress` 都会红。

**为什么 CLI 不该承担这一条**：spec §6.1 的迁移表里 `claim` 那一行没有 `blocked_by`
门禁，当前实现也确实允许——**这是现有契约与实现的边界，我不该说成「明确的产品
决策」**。第二版计划我引了 FR-C1 里「队列把任务摆出来、claim 又拒绝它，两者会自相
矛盾」来论证，而评审指出那句话针对的是**过期租约的重新认领**，撑不起这个结论。
（这是本 session 第二次把推断写成既定事实，第一次是 D022 那三条。）

真正的理由只有一条，而它够了：**WIP=1 是本项目的策略，不是 todopi 的功能**，
所以这道门属于 harness。「被阻塞的任务能不能直接认领」是另一个问题，留给 dogfooding
回答，不在这次迁移里改产品。

**不能用 grep 数。** 第一版计划写的是 `grep -l '^status: "in_progress"$'`——评审
指出它漏掉规格允许的**手写无引号**形式。改成 `tools/check-wip.mjs`，用仓库自己的
解析器加载任务（与 ARCH-020 / ARCH-022 的 node 检查器同源）。这个 session 刚学过
一遍：**别用字符形状近似一个需要真解析的判断。**

---

## Task 1：迁移脚本与数据

**Files:** Create `tools/bootstrap-migrate.mjs`（一次性脚本，迁移后删除）

按契约的字段映射把 21 条 feature 写成 `.todopi/tasks/*.md`：

- `id` → 新的 `tp-xxxxxx`；旧 id 进 `external.harness.legacy_id`
- `behavior` → `title`（≤200 字符）；完整描述进 body
- `verification` → body 的「验收判据」段（**散文，不是 checkbox**）
- `state: passing` → `status: "closed"` + `resolution: "done"`；
  `not_started` → `status: "open"`
- `depends_on[]` → `blocked_by[]`（用新 id）
- `layers[].cmd` → `verify`，按 `static → runtime → system` 用 `&&` 串联。
  **runtime 层用 `make test` 而不是原样的 `node --test`**：评审指出原样搬会绕过
  `make test` 的 `fixtures`、`no-skipped-tests`、`test-not-filtered` 三维——那正是
  昨天九轮评审刚建起来的门
- `layers[].repair` → body 的「Repair」段
- `evidence` → body 的 Log 段
- `labels` → `["bootstrap"]`
- `created`/`updated` → 迁移时刻，body 注明真实创建时间未知

**为什么验收判据是散文而不是 checkbox：** `done` 的验收门禁要求全部勾选，而勾选
要 `check`（F09，尚未实现）。写成 checkbox 就意味着每次关闭都得手改 markdown——
正是这个产品要消灭的负担。F09 落地后再评估要不要回填。

**但必须说清它的代价**（评审指出，成立）：散文形式下**验收门禁对这批任务不生效**，
`done` 只门禁 `verify` 与子任务。所以 `done` 通过**不等于**这些判据已被机器核对过——
关闭前由人对着 body 的判据段逐条核对。这句话要写进 AGENTS.md 的工作流，
不能只留在计划里。

- [ ] **Step 1：写迁移脚本，先只 dry-run 打印**
- [ ] **Step 2：写一个独立的对账脚本 `tools/bootstrap-verify.mjs`**

第一版计划这里写的是「数量对得上 + 抽查两条」。评审指出两处硬伤，都成立：

1. `todopi ls --json` **默认只返回未关闭任务**，要加 `--all`——不加的话 21 条只
   数得出 14 条，而我会以为对上了。
2. 数量、旧 id 集合、抽查两条，**都发现不了其余 19 条的 `blocked_by`、`verify`、
   验收文字或 evidence 静默丢失**。

所以对账必须**逐条逐字段**，而且由一个**独立**脚本做——迁移函数不能兼任自己的
唯一校验器。这正是本 session 栽过的那个形状：断言和被断言的东西共享同一个假设。

**原始数据从哪读。** 第二版写的是 `git show HEAD:feature_list.json`——评审指出它
在迁移 commit 成为 HEAD 之后就失效了，和「随时可重跑」自相矛盾。改成两段式：

```
HEAD 上还有这个文件 → 直接读（迁移提交之前）
HEAD 上没有了       → git log --diff-filter=D --format=%H -1 -- feature_list.json
                      取删除它的那个 commit，读它的父提交
```

**对账清单。** 第二版那份评审指出「按字面无法实现，而且仍会漏数据」，两处都成立：

- `layers[].cmd` 串联后与 `verify` **逐字相等**是错的——原数据是 `node --test`，
  而目标已规定改成 `make test`。**期望值由对账脚本自己算**（独立实现那个转换），
  不是拿迁移脚本的输出去对迁移脚本。
- 清单漏了一批字段，补齐如下。

```
21 条全在，legacy_id 集合与原 id 集合相等
state → status/resolution：7 条 closed+done、14 条 open，逐条对
behavior → title（≤200 字符）且完整原文出现在 body 里
depends_on → blocked_by：换算成新 id 后每条边集合相等
layers[].cmd → verify：脚本独立算出期望值（含 node --test → make test），逐字相等
layers[].repair 原文出现在 body 的 Repair 段
verification 原文出现在 body 的验收判据段
evidence 原文出现在 body 的 Log 段
labels 含 "bootstrap"，且 milestones 的分组落成 m1/m2/m3 标签
created/updated 都是迁移时刻，body 注明真实创建时间未知
原数组顺序 → rank 的字典序与之一致（F01 最前、F21 最后）
milestones[].done_when 三条原文出现在 PROGRESS.md
每条 Log 行经仓库自己的 parseLogLine 解析通过（§5.3.3）
```

- [ ] **Step 3：`todopi doctor` 退出 0**（8 条不变量全过，含无环）
- [ ] **Step 4：对账脚本退出 0，且实测它会红**——故意漏掉一条的 `verify`、
      改坏一条的 `blocked_by`，两种都必须被它抓到。**没验证过会红的校验器等于没有。**

## Task 2：harness.sh 改写

**Files:** Modify `tools/harness.sh`

- [ ] **Step 1：删除 feature 相关的全部子命令与辅助函数**

第一版计划只列了四个命令。评审补出漏掉的一批——**删了 JSON 之后 `make vcr` 会直接
报错**：

```
cmd_activate / cmd_verify_feature / cmd_reverify / cmd_release
cmd_vcr / vcr_value          ← 漏了；VCR 的计数源就是 feature_list.json
features_guard / feature_field / feature_exists / features_write
FEATURES 变量（harness.sh:17）
clock-in 状态面板里的 VCR 行（harness.sh:305）
帮助文本里的 status / vcr 说明（harness.sh:827、832）与 dispatch（853）
Makefile 的 activate / verify-feature / reverify / release / vcr 目标与 .PHONY
```

- [ ] **Step 2：必需文件表去掉 `feature_list.json`**（harness.sh:252）
- [ ] **Step 3：clock-in 的状态面板（295-310）改为调用 `todopi ls`**
- [ ] **Step 4：`make check` 里 e2e 脚本与 feature 的对应关系（476 行附近注释）改写**
- [ ] **Step 5：最终检查 `grep -rnE 'feature_list|verify-feature|reverify|vcr|VCR'`
      只剩 `docs/plans/` 与 `DECISIONS.md` 里的历史记载**——旧命令名也要清零，
      不只是文件名

## Task 3：ARCH-023（WIP=1 与依赖）

**Files:** Create `tools/check-ledger-policy.mjs`；Modify `.harness/arch-rules.json`

- [ ] **Step 1：写检查器 `tools/check-ledger-policy.mjs`**，用仓库自己的解析器
      加载 `.todopi/tasks/`，断言三条（第三条是评审第四轮补的）：
      至多一个 `in_progress`；没有 `in_progress` 任务的 `blocked_by` 指向
      **不是 `closed` + `resolution: done`** 的任务。

      **必须是 `done` 而不只是 `closed`**：旧 `make activate` 要求依赖
      `state: passing`，而 `close --resolution wontfix` 之后后继同样会解除阻塞
      （评审实测）。只查「已关闭」就是又一次静默降级。

      **不用 grep**——规格允许手写无引号的 `status: in_progress`，字符形状漏得掉
      （评审实测）。

      第三条：**每个任务都必须有 `verify`**。旧 `verify-feature` 对空 `layers[]`
      明确拒绝，而 `todopi add` 的 `--verify` 可省略、无 `verify` 也能 `done`。
      确实无可验证时显式写 `verify: "true"`——**要求写出来，而不是默许省略**。

      **解析失败要吵**：读不动的任务文件必须输出诊断并失败，否则它会被读成空字段
      然后从计数里消失——那是最坏的一种假绿。

- [ ] **Step 2：加规则**（`applies_when: test -d .todopi/tasks`，
      与 ARCH-020 / ARCH-022 同为 node 检查器）

- [ ] **Step 3：六个反例都实测会红，逐项记录结果**
      - 两条规范形式的 `in_progress`
      - 一条规范形式 + 一条**手写无引号**的 `in_progress`（这条专治第一版的 grep）
      - 一条 `in_progress` 的 `blocked_by` 指向 open 任务
      - 一条 `in_progress` 的 `blocked_by` 指向 **`closed` + `wontfix`** 的任务
      - 一个读不动的任务文件（必须报错，不能静默跳过）
      - 一个没有 `verify` 字段的任务

## 工作流的顺序，以及它和协议段的冲突

评审第四轮指出：计划里写的「提交 → done → clean-check」按字面跑不通——`done` 会
再次改动任务文件，而 `clean-check` 在工作区有改动且 PROGRESS 未更新时会失败。
更麻烦的是，`init` 追加的**协议段第 43 行**写着「把 `.todopi/` 的改动放进它所描述的
那次工作的同一个 commit」，而「先提交再 done」必然要第二次提交。两处都成立。

**定下来的顺序：**

```
todopi claim <id>                    ← 它会改任务文件，那处改动跟着工作走
干活
人核对 Acceptance Criteria           ← 散文判据，机器不查
git commit                           ← 代码 **加上** claim 留下的账本改动
todopi done <id>                     ← verify 跑在刚提交的那棵树上，dirty=false
git commit                           ← done 的账本改动 + PROGRESS
make clean-check                     ← 必须在两次提交都完成之后
```

**为什么 `done` 只能在代码提交之后**：它的 Log 记 `commit=<HEAD7> dirty=<bool>`。
放在提交前，验证跑的是未提交的树、`dirty=true`，那条证据就指不实任何东西——这正是
损失表里第五条说的，旧 `verify-feature` 会直接拒绝这种情况。所以 `done` 必须在后，
它的账本改动也就只能落进第二次提交。

**协议段的那句话因此有一个例外，要写进 AGENTS.md 而不是藏着**：`add` / `note` /
`claim` 的账本改动跟着工作走同一个 commit——**第一次提交必须带上它们**，否则 `done`
看到的工作区还是脏的（评审在执行后实测出这一点，计划前几版写的「只提交代码」是错
的）；**`done` 是例外，因为它验证的正是那个 commit，只能在其后落地**。两种说法同时出现在 AGENTS.md 里却不说破，就是这个
session 反复栽的那个形状。

协议文本本身要不要带上这个例外，是**产品决定**（它是用户可见的英文文案），
不在这次迁移里改，记进 PRD §15。

## Task 4：文档

**Files:** Modify `docs/harness/index.md`、`AGENTS.md`、
`docs/harness/state-migration.md`、`docs/harness/scope.md`、
`docs/harness/verification.md`、`templates/clean-state-checklist.md`、
`PROGRESS.md`、`docs/product/todopi-prd.md`

- [ ] **Step 1：`docs/harness/index.md` 权威顺序第 4 条** → `.todopi/` + `PROGRESS.md` + `DECISIONS.md`
- [ ] **Step 2：`AGENTS.md` Scope 段** → `make activate` / `make verify-feature`
      改为 `todopi claim` / `todopi done`。注意 `init` 已往 AGENTS.md 追加协议段，
      两处改动要合得上
- [ ] **Step 3：`state-migration.md` 改为历史记录，但标识符不能是 SHA**

评审指出一个真实的逻辑不可能：契约要求「本文件在迁移 commit 内标注完成的日期与
**commit**」，而提交前拿不到自己的 SHA，事后补写又会产生另一个 commit。

所以先改契约的措辞，改成可验证的标识：

```
迁移完成于 2026-09-23，即「删除 feature_list.json 并改写本文件」的那个 commit。
查找：git log --diff-filter=D --oneline -- feature_list.json
```

- [ ] **Step 4：`AGENTS.md` 的可执行路径要写准**

`todopi init` 会往 AGENTS.md 追加协议段，而**协议里提到的 `prime` / `note` /
`handoff` 还没实现**（F09、F11、F12）。评审指出这一点，成立：agent 照着协议敲会
撞上「命令不存在」。

迁移期 AGENTS.md 必须写清现在真能跑的路径：
`todopi ls --ready` → `todopi claim <id>` → 干活 → **人核对散文验收判据** →
`git commit` → `todopi done <id>`。并注明协议段里其余命令尚未实现、随 F09/F11/F12
落地。

- [ ] **Step 5：`scope.md`、`verification.md`、`clean-state-checklist.md` 里的
      `feature_list.json` 引用逐处改写**
- [ ] **Step 6：PRD §15 记五条开放项**——全部是自举第一天问出来的产品问题，
      正是它该有的作用：
      1. `reverify` 没有对应物
      2. `verify` 的单一退出码表达不了 `not_applicable`
      3. `dirty=true` 该不该成为 `done` 的门禁
      4. 协议文本要不要写明「`done` 的账本改动是同一 commit 规则的例外」
      5. 拒绝报告该不该带上任务正文里的 Repair 段
- [ ] **Step 7：PROGRESS.md 的「VCR 7/7」措辞改写**——计数源没了

## Task 5：彩排，然后落地

- [ ] **Step 1：在 `git worktree` 副本里彩排完整的最终形态**

前面那次 dry run 只证明了 CLI 的基本路径能走、以及新旧并存时会被 ARCH-006 拒绝；
**没有证明最终形态能自检**。彩排按下面的顺序，每一步都有断言——评审指出前几版的
彩排「可能全绿却没验到东西」，两处都补上了：

```
1. 副本里做完整套改动
2. make check / make test / make e2e 三层全绿；todopi doctor 退出 0
3. tools/bootstrap-verify.mjs 退出 0（此时 feature_list.json 还在 HEAD 上）
4. 提交迁移
5. **再跑一次 bootstrap-verify.mjs** ← 关键：这一次才走「从删除它的 commit 取父
   提交」那条分支。不跑，那条分支到主工作区才第一次运行
6. make status / make clean-check 跑得通（它们刚被改写过）
7. todopi add 一条临时任务（--verify 'true'），演练完整回路：
     claim → 改一个无关紧要的文件 → git commit（**把 add/claim 的账本改动一起提交**）
     → todopi done
     → 断言 Log 里 dirty=false 且 commit 等于刚才那次提交的短 SHA
     → 提交账本与 PROGRESS → make clean-check
```

第 7 步那两个断言是评审补的，而它们正是彩排的要害：不断言 `dirty=false`，
一次留着未提交账本改动的彩排照样「通过」，却证明不了「先提交再 done」这个顺序
真的成立。

- [ ] **Step 2：主工作区重做同一套改动，然后对「真正要提交的那棵树」重跑全部检查**

评审指出：`clean-check` 只重跑 `make check`，**不跑 `make test` 与 `make e2e`**。
副本彩排全绿 + 重做时漏一处 = 最终树没被运行时验证过就提交了。所以顺序是：

```
主工作区做完全部改动，并删除 tools/bootstrap-migrate.mjs
对这棵树跑：make check / make test / make e2e / todopi doctor / bootstrap-verify.mjs
一个 commit 提交
git show --stat 核对文件清单，断言 .todopi/tasks/ 下恰好 21 个文件进了这个 commit
make clean-check
```

- [ ] **Step 3：`tools/bootstrap-migrate.mjs` 删除**（一次性脚本，留着会让人以为
      可以重跑）。`tools/bootstrap-verify.mjs` **保留**——它从 git 读原始数据，
      随时可重跑，是这次迁移唯一的事后证据

## 自查清单

本 session 出现过三次**静默 no-op**（PROGRESS 的 `str.replace`、ARCH-019 的
revert 及其配套断言）。都出在密集改文件时，而一次性大 commit 正是那个形状。

- 每个文本替换都断言锚点命中
- **断言不能和被断言的东西共享同一个假设**（ARCH-019 那次，revert 和它的断言用了
  同一个拼错的串，于是两个一起失效）
- 数量核对写成断言，不是眼看
