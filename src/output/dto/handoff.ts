// src/output/dto/handoff.ts
// handoff 的对外契约（FR-H1）。任务内容是展示值（控制字符已转义，同 prime）。

export type HandoffTaskRef = { id: string; title: string };

/**
 * verify 一节每一项的状态：new（prime 之后才出现且带 verify）、changed、removed、
 * edited（现值与 prime 时相同，但期间经 CLI 改过）、unreadable（任务文件读不出来，不知道）。
 */
export type HandoffVerifyState = "new" | "changed" | "removed" | "edited" | "unreadable";

export type HandoffReport = {
  actor: string;
  /** 上次 prime 的时间；从没 prime 过为 null */
  primedAt: string | null;
  /** 我的（宽松匹配）进行中任务里，最近一小时没有 Log 的 */
  quiet: (HandoffTaskRef & { assignee: string; lastLogAt: string | null })[];
  /** 自上次 prime 以来我新建的任务；没有可比的基准时为 null */
  created: HandoffTaskRef[] | null;
  /** 自上次 prime 以来 verify 新出现或变了的任务（所有人的）；没有快照时为 null */
  verifyChanged: (HandoffTaskRef & { verify: string | null; state: HandoffVerifyState })[] | null;
  /** 追加了 handoff Log 的任务（--check 时为空） */
  logged: (HandoffTaskRef & { summary: string })[];
  /** 锁内核验时已经不再是我的进行中任务，跳过的 */
  skipped: (HandoffTaskRef & { reason: string })[];
  /** 该写却没写成的（别人抢先改了归属之类） */
  failed: (HandoffTaskRef & { message: string; code: number })[];
  check: boolean;
  /** created / verifyChanged 为 null 时的原因；都有基准时为 null */
  baselineNote: string | null;
};
