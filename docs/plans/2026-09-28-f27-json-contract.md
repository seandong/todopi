# F27 `--json` 输出契约 实现计划

**任务：** `tp-eo6vyg`。**Spec:** PRD FR-Q3、FR-Q2；v0.1 缺口审计。决策见 D048。

1. `docs/json.md`：通则（stdout 一个 JSON 值、stderr、退出码、可选字段省略而非 null、时间戳、字段名冻结）、兼容与版本承诺、
   命令 → 报告对照表、每个报告类型一节（Field / Type / Meaning 表，或 `type X = …;` 的 ts 块）。字段逐个从 `src/output/dto/` 与
   `src/domain/`（Refusal、Transition、Criterion）核对。
2. `tools/check-json-doc.mjs` + ARCH-028：小节 → TypeScript → 与真实类型精确相等（tsc）；dto 导出都有小节；引用的类型都有小节。
3. 测试：`tests/harness/check-json-doc.test.ts`（检查器正反例：类型、可选性、字面量联合、多 / 少字段、缺小节、行号不漂）；
   `tests/output/json-doc-mapping.test.ts`（真跑每个命令的 `--json`，顶层键与文档一致）。
