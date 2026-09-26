// src/output/dto/prime.ts
// prime 的对外契约（FR-P1、FR-P2、FR-P3）。--json 输出的就是这个——裁剪**之后**的，所以
// 「以结构化数据输出相同内容」字面成立；`truncated` 说明预算有没有起作用。任务内容是**展示值**：
// 控制字符已转义成 `\xNN`（commands/prime.ts 的 visible），与文本输出逐字相同。

export type PrimeTask = {
  id: string;
  title: string;
  /** 带状态的验收标准；裁剪时丢掉的已勾项不在这里，计数在 checkedOmitted */
  acceptance: { n: number; text: string; checked: boolean }[];
  checkedOmitted: number;
  /** 这个任务一共有几条验收标准（勾选项形式的）；0 表示只有散文或没有 */
  acceptanceTotal: number;
  /** 没有勾选项形式的标准时，去哪里看散文判据；有标准时为 null */
  seeAlso: string | null;
  /** 最近的 Log，旧的在前；每条是头行加续行 */
  log: string[];
  /** 默认推 2 条，因预算少推了几条 */
  logOmitted: number;
};

export type PrimeReport = {
  /** 调用者正在进行的任务，按 updated 由新到旧；装不下的只计数 */
  held: PrimeTask[];
  moreHeld: number;
  ready: number;
  heldByOthers: number;
  budget: number;
  /** 有任务内容被省略（已勾的标准、较早的 Log、整个较旧的任务） */
  truncated: boolean;
  /** 收紧到底之后估算仍超预算（指针行与第一个任务的最小推送不裁剪，见 FR-P1a） */
  overBudget: boolean;
  /** 「另有 N 个你持有的任务」那一行；没有就是 null */
  moreHeldLine: string | null;
  /** 末尾的指针行，与文本输出的最后一行逐字相同 */
  pointer: string;
  /** 指针与「另有 N 个」里提到的命令，按出现顺序 */
  commands: string[];
};

/** --full（FR-P3）：全景，不受预算约束。 */
export type PrimeFullReport = {
  held: PrimeTask[];
  heldByOthers: { id: string; title: string; assignee: string }[];
  ready: { id: string; title: string }[];
  readyTotal: number;
  /** ready 超过列出的 5 条时，剩下的几条与取用命令 */
  readyMore: { count: number; command: string } | null;
  counts: { open: number; in_progress: number; ready: number; blocked: number; closed: number };
  recentlyClosed: { id: string; title: string; resolution: string }[];
};
