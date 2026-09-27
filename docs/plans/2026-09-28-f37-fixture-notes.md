# F37 规格语料的说明改成英文 实现计划

**任务：** `tp-i8vcpd`（F33 派生）。**Spec:** PRD 本地化一行（规格与语料面向实现者，English-first）。

1. `spec/fixtures/*/*.json` 的 `note` / `reason` 逐条译成英文，意思不变、不添加原文没有的断言；`unknown-keys` 原文重复的一句合并。
   只换这几个值：先确认重新序列化能逐字节还原原文件，其余格式不动。语料数据里的中文（`title-unicode` 的标题）是被测内容，不动。
2. `tests/spec-fixtures-english.test.ts`：说明字段里不许再有中文。
