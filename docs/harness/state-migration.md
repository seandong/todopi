# 状态层迁移契约：feature_list.json → `.todopi/`（已完成，历史记录）

> **迁移完成于 2026-09-23**，即「删除 `feature_list.json` 并改写本文件」的那个
> commit。查找它：
>
> ```
> git log --diff-filter=D --oneline -- feature_list.json
> ```
>
> 本文件此后只是历史记录。**这次迁移丢掉了什么、拿什么替代、哪些没有替代物**，
> 见[迁移计划](../plans/2026-09-23-bootstrap.md)的损失表——**十三条**，其中四条
> 没有替代物。最后三条是**执行之后**的评审才找出来的，这本身就是那份清单的结论：
> 纸面上穷尽不了。对账脚本 `tools/bootstrap-verify.mjs` 保留着，随时可重跑。
>
> 契约原文如下，一字未改。

todopi 是一个任务台账工具，却用 `feature_list.json` 管理自己的开发任务。这是
过渡形态，不是终点。本文件固化迁移的触发条件与字段映射，避免「以后再说」变成
「一直没做」。

## 为什么现在不 dogfood

- ~~`spec/todopi-format-v1.md` 仍是 Draft~~ —— 2026-09-15 已推进到 Stable，此条不再成立。
- 现在没有 CLI。手写 `.todopi/tasks/*.md` 意味着人肉维护 `blocked_by` 图的无环性、
  `updated` 时间戳和 id 唯一性——正是这个产品要消灭的负担。
- 自举的价值在于「用真实工具跑真实流程」。用手写文件模拟，拿不到任何自举反馈。

## 触发条件

以下全部满足时执行迁移，不早也不拖：

1. ~~`spec/todopi-format-v1.md` 状态从 Draft 变为 Stable~~ —— 2026-09-15 已满足；
2. `init`、`add`、`claim`、`done`、`verify` 五个命令对应的 feature 全部
   `state: passing`；
   **进度（2026-09-21）**：`init`（F02）✅、`add`（F03）✅；
   还差 `claim`（F05）、`done`（F06 门禁 / F07 验证执行）。
3. ~~`todopi doctor` 能检出格式违规（孤儿引用、环、id 冲突）~~ —— 2026-09-16
   随 F01 满足：spec §6.2 的 8 条不变量全部有实现与语料覆盖。

## 字段映射

| feature_list.json | `.todopi/tasks/<id>.md` | 说明 |
|---|---|---|
| `id`（`F01`） | `id`（`tp-xxxxxx`） | 重新生成随机 id；旧 id 存入 `external.harness.legacy_id` 以便追溯 |
| `behavior` | `title` + body | `title` 取单行摘要（≤200 字符），完整描述进 body |
| `verification` | body 的验收判据段 | 人读判据不是 frontmatter 字段，归 body |
| `state: not_started` | `status: open` | 无 `assignee` |
| `state: active` | `status: in_progress` + `assignee` | assignee 取认领者的 actor 字符串 |
| `state: passing` | `status: closed` + `resolution: done` | |
| `depends_on[]` | `blocked_by[]` | 语义一致；迁移后由 CLI 保证无环 |
| `layers[].cmd` | `verify` | 多层合并为一条 `&&` 命令行；若合并后不可读，拆成父子任务，父任务 `parent` 指向原 feature。**已知损失见下** |
| `layers[].repair` | body 的 Repair 段 | 格式没有 repair 字段，保留为正文 |
| `evidence` | body 的 Log 段 | |
| （无） | `created` / `updated` | 迁移时写入迁移时刻的 UTC 时间戳，并在 body 注明真实创建时间未知 |
| （无） | `labels` | 迁移时可加 `bootstrap` 标签标记来源 |

`layers[].label` 没有对应字段——三层模型是 harness 概念，不是格式概念。
合并命令时按 `static → runtime → system` 顺序串联。

### 已知损失：`&&` 表达不了 `not_applicable`

[验证契约](verification.md) 要求某层不适用时如实报 `not_applicable`，而不是 `pass`。
但 `verify` 是一条命令行，只有一个退出码，承载不了这个区分——`a && b && c` 里
跳过的层和通过的层都表现为「没有让整条命令失败」。

迁移后这个区分只能由被调用的脚本自己在**输出**里说明，不能由退出码说明。
PRD 的 FR-D2a 要求拒绝时打印结构化报告（哪道门禁、具体是什么），这让「哪一层挂了」
至少在输出里可读，但「某层没跑」与「某层跑了并通过」在退出码层面仍然同形。

这是 dogfooding 要付的真实代价，不是可以靠写法绕开的问题。记录在此，
避免迁移后把它当成新发现的 bug。

## 迁移后的权威变更

迁移完成的同一个 commit 内必须一起做完：

1. 删除 `feature_list.json`；
2. 更新 `docs/harness/index.md` 的权威顺序，把第 4 条改为
   `.todopi/` + `PROGRESS.md` + `DECISIONS.md`；
3. 更新 `AGENTS.md` 的 Scope 段：`make activate` / `make verify-feature`
   改为 `todopi claim` / `todopi done`；
4. 更新 `tools/harness.sh`：feature 相关子命令改为调用 CLI，
   或直接删除并由 CLI 承担；
5. 本文件改为历史记录，在顶部标注迁移完成的日期与 commit。

**MUST NOT 让两套状态并存。** 并存期内「当前在做什么」会有两个答案，
而这个 harness 的全部价值就在于那个答案唯一。

## PROGRESS.md 与 DECISIONS.md 不迁移

它们承载的是叙述性上下文（为什么这么定、现在卡在哪），不是任务图。
`.todopi/` 的 12 字段刻意不表达这些，强行塞进 body 只会让两者都变差。
