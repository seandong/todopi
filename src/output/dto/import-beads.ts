// src/output/dto/import-beads.ts
// import beads 的 --json 契约（FR-Q3）。

export type ImportBeadsReport = {
  /** 记进 Log 的来源（同 import <plan.md>） */
  source: string;
  /** 这次新建的任务：Beads id → 新 id，建的顺序 */
  created: { id: string; beads_id: string; title: string; status: string; resolution?: string }[];
  skipped: { tombstone: number; ephemeral: number; already_imported: number };
  /** todopi 没有对应物、或指向没导入的条目而丢掉的东西 */
  dropped: { dangling_edges: number; other_edge_types: number; cycle_edges: number; extra_parents: number; comments: number };
  warnings: string[];
};
