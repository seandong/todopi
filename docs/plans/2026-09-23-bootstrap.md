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

契约只预告了一条损失，实际有三条。如实列出，**不假装有替代物**：

| 没了 | 替代物 | 说明 |
|---|---|---|
| `layers[].label` 的分层报告与 `not_applicable` | **无** | 契约已接受：`verify` 是一条命令行，只有一个退出码，`a && b && c` 里跳过的层和通过的层都表现为「没让整条命令失败」 |
| `make reverify` | **无** | 它存在是因为 evidence 曾指向错误的 commit。CLI 里重跑一个已关闭任务的验证会被状态门禁拒绝。记进 PRD §15，不硬造 |
| `make activate` 的 WIP=1 与依赖检查 | **ARCH-023**（新增） | 不做薄包装：契约第 3 步要求 AGENTS.md 的工作流直接改成 `todopi claim` / `todopi done`，没人调用的包装保不住任何东西。改成一条**持续检查**的机器规则——不论谁把第二个任务变成 `in_progress` 都会红，比只在 activate 时查一次更强 |

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
- `layers[].cmd` → `verify`，按 `static → runtime → system` 用 `&&` 串联
- `layers[].repair` → body 的「Repair」段
- `evidence` → body 的 Log 段
- `labels` → `["bootstrap"]`
- `created`/`updated` → 迁移时刻，body 注明真实创建时间未知

**为什么验收判据是散文而不是 checkbox：** `done` 的验收门禁要求全部勾选，而勾选
要 `check`（F09，尚未实现）。写成 checkbox 就意味着每次关闭都得手改 markdown——
正是这个产品要消灭的负担。散文形式下验收门禁对这批任务不生效，`done` 只门禁
`verify` 与子任务。F09 落地后可以再评估要不要回填。

- [ ] **Step 1：写迁移脚本，先只 dry-run 打印**
- [ ] **Step 2：断言数量对得上**（不是眼看）

```
迁移前 feature_list.json：21 条，7 passing，14 not_started
迁移后 .todopi/：todopi ls --json 数出 21 条、7 closed、14 open，
                 且每条的 legacy_id 与原 id 一一对应（集合相等）
```

- [ ] **Step 3：`todopi doctor` 退出 0**（8 条不变量全过，含无环）
- [ ] **Step 4：抽查两条**——F07（passing，有 evidence 与三层）与 F08
      （not_started，depends_on F04）的文件内容逐字段核对

## Task 2：harness.sh 改写

**Files:** Modify `tools/harness.sh`

- [ ] **Step 1：删除 `cmd_activate` / `cmd_verify_feature` / `cmd_reverify` / `cmd_release`**
      与它们的 `feature_field` / `feature_exists` / `features_write` 辅助函数
- [ ] **Step 2：必需文件表去掉 `feature_list.json`**（harness.sh:252）
- [ ] **Step 3：clock-in 的状态面板（295-310）改为调用 `todopi ls`**
- [ ] **Step 4：`make check` 里 e2e 脚本与 feature 的对应关系（476 行附近注释）改写**
- [ ] **Step 5：Makefile 去掉 `activate` / `verify-feature` / `reverify` / `release` 目标**

## Task 3：ARCH-023（WIP=1）

**Files:** Modify `.harness/arch-rules.json`

- [ ] **Step 1：加规则**

```
id: ARCH-023
description: 同一时刻只有一个任务处于 in_progress（WIP=1）
applies_when: test -d .todopi/tasks
check: grep -l '^status: "in_progress"$' .todopi/tasks/*.md | wc -l | awk '$1 > 1 {print $1 " 个任务同时 in_progress"}'
expect: empty
```

依赖格式规格 §5.1 的规范形式（写入方给每个标量加双引号），与其余 grep 规则同源。

- [ ] **Step 2：两个方向都实测**——一个 in_progress 通过；手工造第二个必须变红

## Task 4：文档

**Files:** Modify `docs/harness/index.md`、`AGENTS.md`、
`docs/harness/state-migration.md`、`docs/harness/scope.md`、
`docs/harness/verification.md`、`templates/clean-state-checklist.md`、
`PROGRESS.md`、`docs/product/todopi-prd.md`

- [ ] **Step 1：`docs/harness/index.md` 权威顺序第 4 条** → `.todopi/` + `PROGRESS.md` + `DECISIONS.md`
- [ ] **Step 2：`AGENTS.md` Scope 段** → `make activate` / `make verify-feature`
      改为 `todopi claim` / `todopi done`。注意 `init` 已往 AGENTS.md 追加协议段，
      两处改动要合得上
- [ ] **Step 3：`state-migration.md` 顶部标注迁移完成的日期与 commit**，全文改为历史记录
- [ ] **Step 4：`scope.md`、`verification.md`、`clean-state-checklist.md` 里的
      `feature_list.json` 引用逐处改写**（`grep -rn feature_list` 清零，
      `docs/plans/` 与 `DECISIONS.md` 里的历史记载除外）
- [ ] **Step 5：PRD §15 记两条开放项**：`reverify` 没有对应物；
      `verify` 的单一退出码表达不了 `not_applicable`
- [ ] **Step 6：PROGRESS.md 的「VCR 7/7」措辞改写**——VCR 计数源没了

## Task 5：落地

- [ ] **Step 1：`make check && make test && make e2e` 三层全绿**
- [ ] **Step 2：`todopi doctor` 退出 0**
- [ ] **Step 3：`grep -rn feature_list` 只剩历史记载**
- [ ] **Step 4：删除 `tools/bootstrap-migrate.mjs`**（一次性脚本，留着会让人以为可以重跑）
- [ ] **Step 5：一个 commit 提交全部改动**
- [ ] **Step 6：`make clean-check` 通过**

## 自查清单

本 session 出现过三次**静默 no-op**（PROGRESS 的 `str.replace`、ARCH-019 的
revert 及其配套断言）。都出在密集改文件时，而一次性大 commit 正是那个形状。

- 每个文本替换都断言锚点命中
- **断言不能和被断言的东西共享同一个假设**（ARCH-019 那次，revert 和它的断言用了
  同一个拼错的串，于是两个一起失效）
- 数量核对写成断言，不是眼看
