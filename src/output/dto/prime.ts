// src/output/dto/prime.ts
// prime 的对外契约（FR-P1、FR-P2、FR-P3）。--json 输出的就是这个——裁剪**之后**的，所以
// 「以结构化数据输出相同内容」字面成立；`truncated` 说明预算有没有起作用。

export type PrimeTask = {
  id: string;
  title: string;
  /** 带状态的验收标准；裁剪时丢掉的已勾项不在这里，计数在 checkedOmitted */
  acceptance: { n: number; text: string; checked: boolean }[];
  checkedOmitted: number;
  /** 这个任务一共有几条验收标准（勾选项形式的）；0 表示只有散文或没有 */
  acceptanceTotal: number;
  /** 最近的 Log，旧的在前；每条是原文（头行加续行） */
  log: string[];
};

export type PrimeReport = {
  /** 调用者正在进行的任务，按 updated 由新到旧；装不下的只计数 */
  held: PrimeTask[];
  moreHeld: number;
  ready: number;
  heldByOthers: number;
  budget: number;
  truncated: boolean;
};

/** --full（FR-P3）：全景，不受预算约束。 */
export type PrimeFullReport = {
  held: PrimeTask[];
  heldByOthers: { id: string; title: string; assignee: string }[];
  ready: { id: string; title: string }[];
  readyTotal: number;
  counts: { open: number; in_progress: number; ready: number; blocked: number; closed: number };
  recentlyClosed: { id: string; title: string; resolution: string }[];
};
