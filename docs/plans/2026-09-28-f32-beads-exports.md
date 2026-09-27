# F32 import beads 用更多真实导出测过 实现计划

**任务：** `tp-ow8pb0`。**Spec:** 首发清单 §13（至少两份真实导出）；D041。

1. 用 `gh search code` 找公开仓库提交的 `.beads/issues.jsonl`，挑六份（有进行中、有 tombstone、有评论、有自定义状态），按最近一次改动它的提交钉住，
   下到本地（不进仓库）：导入、doctor、再导入。
2. 发现：imbue-ai/offload 的 `cancelled` / `done` 被建成 open。`domain/beads.ts`：明确结束的自定义状态建成 closed（resolution 由状态定，close_reason
   更准时照它）；不认得的照 open 建并按状态汇总警告；用例覆盖别名、大小写、close_reason 优先、Classic 状态不警告、汇总计数。
3. 结果表与状态规则记进 D041。
