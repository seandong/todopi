# F20 `import beads` 实现计划

**任务：** `tp-66vnyl`（旧 F20）。**Spec:** PRD FR-I2；格式规格 §5.2 字段 10 / 11、§5.3.3（`imported`）；D040、D041。

## 先核实的外部事实

Beads 仓库已迁到 gastownhall/beads。Classic = Dolt 成为默认存储（v0.49.3 前后）之前的 JSONL + SQLite 时代；字段以
v0.47.1 的 `internal/types/types.go` 的 json 标签为准。用 Beads 仓库自己在 v0.47.1 提交的 `.beads/issues.jsonl` 统计
实际出现的值（状态、类型、依赖类型、close_reason、tombstone / ephemeral）再定映射。

## 组成

1. `domain/beads.ts`：`planBeadsImport(issues, alreadyImported, safeText)` → 建的顺序（拓扑序）、rank 顺序（priority）、
   resolution、labels、parent / blocked_by / from、描述（不安全就围栏）、跳过与丢弃的计数、警告。纯函数。
2. `format/write.ts`：`createTaskUnlocked` 的 `known` 参数；`emit.ts` 的 NewTask 加 `external`。
3. `commands/import-beads.ts`：读 JSONL（坏行、重复 id、非 UTF-8 整体拒绝）、按 `external.beads.id` 跳过已导入、一把锁里建。
4. DTO、文本渲染（警告只列前 20 条）、`cli.ts` 的 `import beads [path]`。
5. `tools/e2e/f20-import-beads.sh`。

## 要用例钉住的

resolution 的开头判定与词边界；label 规范化；时间戳（拒绝不存在的日期）；跳过 tombstone / ephemeral / 已导入；拓扑序；
priority 顺序（同 priority 按 created_at 再按 id）；成环、多父级、悬空边；描述合并与围栏；导入后每个字段；幂等与引用旧任务；
描述里的顶格 `##` 与没闭合的围栏读回一字不差；未来的 created_at；文件错误整体拒绝。e2e：并发导入只建一份。
