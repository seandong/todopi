// src/domain/findings.ts
// rule 的取值与 spec/fixtures/invalid/*.json 的 violates 字段一一对应。
// 改这里就是改对外契约——第三方的 CI 会跑那份语料。

export const RULES = [
  "envelope",      // 信封或 YAML 无法解析
  "invariant-1",   // 文件解析且 id 与文件名一致
  "invariant-2",   // resolution present iff status closed
  "invariant-3",   // assignee present iff in_progress（closed 可选）
  "invariant-4",   // parent 与 blocked_by 引用存在的文件
  "invariant-5",   // parent 图与 blocked_by 图无环
  "invariant-6",   // updated >= created
  "invariant-7",   // 无行首冲突标记
  "invariant-8",   // actor 符合 §5.4
  "field",         // 字段类型或取值不符合 §5.2（非编号不变量，但 doctor 要报）
] as const;

export type Rule = (typeof RULES)[number];

export type Finding = {
  rule: Rule;
  /** 相对账本根目录的路径 */
  path: string;
  message: string;
};
