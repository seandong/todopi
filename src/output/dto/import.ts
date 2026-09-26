// src/output/dto/import.ts
// import 的 --json 契约（FR-Q3）。

export type ImportReport = {
  /** 记进 Log 的来源：相对项目根的路径（在项目外时是绝对路径），空白与 % 按 %XX 编码 */
  source: string;
  /** 这次新建的任务，文档顺序 */
  created: { id: string; title: string; status: string; resolution?: string; parent?: string }[];
  /** 已经从同一来源导入过、这次原样保留的任务数 */
  existing: number;
  warnings: { line: number; message: string }[];
};
