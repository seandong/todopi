# F32 import beads 用更多真实导出测过 实现计划

**任务：** `tp-ow8pb0`。**Spec:** 首发清单 §13（至少两份真实导出）；D041。

1. 用 `gh search code` 找公开仓库提交的 `.beads/issues.jsonl`，挑六份（有进行中、有 tombstone、有评论、有自定义状态），按最近一次改动它的提交钉住，
   下到本地（不进仓库）：导入、doctor、再导入。
2. 发现：imbue-ai/offload 的 `cancelled` / `done` 被静默建成 open。先按名字关（评审否决：自定义状态的类别不在导出里），最终仍照 open 建，
   但按状态汇总大声警告（个数、Beads id、怎么关）；`status` 非字符串按格式错误拒绝。
3. 结果表与状态规则记进 D041。
