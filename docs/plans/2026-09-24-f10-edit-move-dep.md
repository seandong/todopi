# F10 `edit` / `move` / `dep` 实现计划

**任务：** `tp-lxj04s`（旧 F10）。**Spec:** PRD FR-T4、FR-T5、FR-G1、FR-C6；格式规格
§5.2（`rank`、`blocked_by`）、§5.3.3（`moved`、`edited fields=…`）、§6.2 不变量 4/5、§7.4。

## 已有的，不重写

**成环拒绝已经在写入门禁里**：`validateWrite` 对「这次写入新引入的」图问题做差集，环带着
路径报出来（`cycle in the blocked_by graph: a -> b -> a`）。`dep add` 与 `edit --parent`
走 `prepareUpdate` 就自动拿到，不另写一个查环器——两个查环器迟早给出不同结论。

## 顺序：dep → move → edit

**`dep add/rm <id> --on <id>`**：维护 `blocked_by`，写回时排序去重（它是集合）。自依赖在碰图
之前就拒绝；边已存在 / 本就不存在 → 幂等空操作；`--on` 不存在 → 退出 1 点名。

**`move <id> --top | --before X | --after Y`**：邻居在 `sortTasks` 的真实顺序上算（§7.4 的并列
按 id 破，`--after Y` 必须落在 Y 与它**真正的**下一个之间）。
- X / Y 无 rank → 拒绝，指向 `doctor --fix`（F13 回填 rank）。混合种群下 `--after` 无解（FR-T5）。
- **两个邻居 rank 相同**（两个 worktree 各自 add 就会撞）→ `generateKeyBetween` 无解。spec
  允许重编号，但那要改多个文件并各记一条 `moved`，而 FR-T5 要「只重写一个文件」。**拒绝**，
  点名两个任务，建议先把其中一个挪开。
- 已经在目标位置 → 幂等空操作。
- 只重写一个文件：用例断言整个账本只有被挪的那个 `updated` 变了。

**`edit`**：`--title`、`-d/--description`、`--verify`（空串 = 清除该字段）、`--label +l|-l`、
`--parent <id>|none`。记 `edited fields=<排序后的逗号列表>`，只列**真的变了**的字段；什么都没
变 → 空操作。**不做 `--edit`（$EDITOR）与正文分节编辑**：前者是交互式的（F07 立过的规矩：
绝不阻塞在 TTY 上），后者不在本任务的验收判据里。记进 PRD §15。

## 归属与已关闭任务（要被挑战的判断）

- **归属**：PRD FR-C6 列出的「写入严格匹配」是 note、check、**edit**、done、close、心跳、
  handoff。`dep` 与 `move` 不在其中——它们是规划操作，与 `add --blocked-by` 同类（`add` 也不查
  归属）。照 PRD：`edit` 走 `writeAsWorker`，`dep` / `move` 取锁但不查归属。
- **已关闭任务**：`move` 允许（重排历史的显示顺序无害）；`dep` 拒绝（改已关闭任务的依赖等于改写
  它当时是在什么条件下被接受的）；`edit --parent` 拒绝（同理）；`edit` 其余字段允许（修一个
  标题的错字不改写证据）。
