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

契约只预告了一条损失。**第一版计划我列了三条，评审实测出还有两条**——如实列全，
不假装有替代物：

| 没了 | 替代物 | 说明 |
|---|---|---|
| `layers[].label` 的分层报告与 `not_applicable` | **无** | 契约已接受：`verify` 是一条命令行，只有一个退出码，`a && b && c` 里跳过的层和通过的层都表现为「没让整条命令失败」 |
| `make reverify` | **无** | 它存在是因为 evidence 曾指向错误的 commit。CLI 里重跑一个已关闭任务的验证会被状态门禁拒绝。记进 PRD §15 |
| `make activate` 的 WIP=1 与「依赖未关闭不许开工」 | **ARCH-023，但是降级** | 见下 |
| `make test` 的其余维度（`fixtures`、`no-skipped-tests`、`test-not-filtered`） | **改 `verify` 命令挽回** | 第一版计划直接搬了 `node --test`，会绕过它们。改成 `make check && make test && bash tools/e2e/fNN-*.sh` |
| `verify-feature` **拒绝把脏工作区的结果归给 HEAD** | **无，改成工作流约定** | `todopi done` 允许脏工作区，只在 Log 记 `dirty=true`。AGENTS.md 写明「先提交再 done」；`dirty=true` 该不该成为门禁，记进 PRD §15 —— 这是自举第一天就问出来的产品问题，正是它该有的作用 |

### ARCH-023 是**降级**，说清楚

`make activate` 在**认领时拒绝**：WIP=1、依赖未关闭不许开工。ARCH-023 只能**事后
发现**。这是约束降级，不是等价替换。

**为什么不做薄包装保住它**：契约第 3 步要求 AGENTS.md 的工作流直接改成
`todopi claim` / `todopi done`，那么一个没人调用的 `make activate` 保不住任何
东西——人照着文档敲 `todopi claim` 就绕过去了。事后检查反而更强：**不论谁、用什么
方式**把第二个任务变成 `in_progress` 都会红。

**为什么 CLI 不该承担这一条**：核实过 spec §6.1 的迁移表与 FR-C1——`claim` 对被
阻塞的任务不设门禁是**明确设计**（`ls --ready` 才是队列过滤器，「队列把任务摆出来、
claim 又拒绝它，两者会自相矛盾」）。WIP=1 更是本项目的策略，不是 todopi 的功能。
所以这道门属于 harness，不属于 CLI。

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

对账脚本从 `git show HEAD:feature_list.json` 读原始数据（迁移后文件已删，从 git
读让它随时可重跑），逐条核对：

```
21 条全在，legacy_id 集合与原 id 集合相等
state → status/resolution 映射逐条正确（7 closed+done / 14 open）
depends_on 的每条边在 blocked_by 里都有对应（用新 id 换算后集合相等）
layers[].cmd 按 static→runtime→system 串联后与 verify 字段逐字相等
verification 原文出现在 body 里（逐字包含）
layers[].repair 原文出现在 body 的 Repair 段
evidence 原文出现在 body 的 Log 段
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

**Files:** Create `tools/check-wip.mjs`；Modify `.harness/arch-rules.json`

- [ ] **Step 1：写检查器**，用仓库自己的解析器加载 `.todopi/tasks/`，断言两条：
      至多一个 `in_progress`；没有 `in_progress` 任务的 `blocked_by` 指向未关闭的
      任务。**不用 grep**——规格允许手写无引号的 `status: in_progress`，
      字符形状漏得掉（评审实测）。

- [ ] **Step 2：加规则**（`applies_when: test -d .todopi/tasks`，
      与 ARCH-020 / ARCH-022 同为 node 检查器）

- [ ] **Step 3：三个反例都实测会红**
      - 两条规范形式的 `in_progress`
      - 一条规范形式 + 一条**手写无引号**的 `in_progress`（这条专治第一版的 grep）
      - 一条 `in_progress` 的 `blocked_by` 指向 open 任务

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
- [ ] **Step 6：PRD §15 记三条开放项**：`reverify` 没有对应物；`verify` 的单一
      退出码表达不了 `not_applicable`；**`dirty=true` 该不该成为 `done` 的门禁**
      （自举第一天就问出来的产品问题）
- [ ] **Step 7：PROGRESS.md 的「VCR 7/7」措辞改写**——计数源没了

## Task 5：彩排，然后落地

- [ ] **Step 1：在 `git worktree` 副本里彩排完整的最终形态**

评审建议的，采纳。前面那次 dry run 只证明了 CLI 的基本路径能走、以及新旧并存时会
被 ARCH-006 拒绝；**没有证明最终形态能自检**。彩排要在副本里把整套改动都做完，
然后验证：

```
make check / make test / make e2e 三层全绿
todopi doctor 退出 0
tools/bootstrap-verify.mjs 退出 0
make status / make clean-check 跑得通（它们刚被改写过）
照 AGENTS.md 新写的路径真跑一遍：ls --ready → claim → done
```

- [ ] **Step 2：彩排通过后，在主工作区重做同一套改动**（或把副本的改动搬过来）
- [ ] **Step 3：删除 `tools/bootstrap-migrate.mjs`**（一次性脚本，留着会让人以为
      可以重跑）。`tools/bootstrap-verify.mjs` **保留**——它从 git 读原始数据，
      随时可重跑，是这次迁移唯一的事后证据
- [ ] **Step 4：一个 commit 提交全部改动**
- [ ] **Step 5：`make clean-check` 通过**

## 自查清单

本 session 出现过三次**静默 no-op**（PROGRESS 的 `str.replace`、ARCH-019 的
revert 及其配套断言）。都出在密集改文件时，而一次性大 commit 正是那个形状。

- 每个文本替换都断言锚点命中
- **断言不能和被断言的东西共享同一个假设**（ARCH-019 那次，revert 和它的断言用了
  同一个拼错的串，于是两个一起失效）
- 数量核对写成断言，不是眼看
