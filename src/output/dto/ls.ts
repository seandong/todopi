// src/output/dto/ls.ts
// ls 的对外契约。--json 是 agent 解析的入口（协议文本第 6 条「解析时加 --json」），
// FR-Q3 给了它版本承诺——改字段名要升 CLI 主版本。
//
// 字段名跟格式规格走（blocked_by 用下划线，与 frontmatter 同名），派生态用
// 形容词（ready / blocked / stale），容器进度是一个对象而不是 "1/2" 这样的
// 字符串——字符串会逼着消费者去解析它。
//
// 本文件只搬字段，不算任何东西：派生态由 domain/derive.ts 的 deriveState 算好
// 传进来（ARCH-020 机器执行）。从 domain/ 只做类型导入。

import type { TaskFile } from "../../domain/types.ts";
import type { DerivedState } from "../../domain/derive.ts";

/** commands/ 组装好的投影：一个任务加上它算好的派生态。 */
export type TaskProjection = {
  task: TaskFile;
  derived: DerivedState;
  mine: boolean;
};

export type TaskDto = {
  id: string;
  title: string;
  status: string;
  resolution?: string;
  assignee?: string;
  parent?: string;
  blocked_by: string[];
  rank?: string;
  labels: string[];
  created: string;
  updated: string;
  /** 派生态，spec §7 */
  ready: boolean;
  blocked: boolean;
  stale: boolean;
  mine: boolean;
  /** spec §5.3.3：最近一次 done / closed 带 forced=true 的已关闭任务显示为未验证 */
  unverified: boolean;
  /**
   * 容器的 n/m 进度；叶子为 undefined。
   *
   * 不叫 children：spec §7.1 的 children(t) 是**子任务集合**，而 show --tree
   * 以后要的正是那个集合。现在占了这个名字，将来加子任务列表就只能破坏性改名。
   */
  child_progress?: { closed: number; total: number };
};

export type LsReport = {
  tasks: TaskDto[];
  /** 过滤后、截断前的匹配数，让「显示了 2 条，共 17 条」成为可能 */
  total: number;
  /**
   * 不是合法 v1 任务文件的那些 id。它们不进 tasks——缺 title 就是一行空标题，
   * 缺 status 就没有状态，当成任务列出来只会是一条幽灵记录；但也不能悄悄丢掉，
   * 否则 agent 会以为这个任务不存在，转头又建一个重复的。走 stderr 报告，
   * 这样 --json 的 stdout 始终是一个干净的数组（FR-T2）。
   */
  invalid: string[];
};

export function toTaskDto(p: TaskProjection): TaskDto {
  const fm = p.task.frontmatter;
  const str = (k: string): string | undefined => (typeof fm[k] === "string" ? (fm[k] as string) : undefined);
  const list = (k: string): string[] =>
    Array.isArray(fm[k]) ? (fm[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];

  const dto: TaskDto = {
    id: p.task.idFromFilename,
    title: str("title") ?? "",
    status: str("status") ?? "",
    blocked_by: list("blocked_by"),
    labels: list("labels"),
    created: str("created") ?? "",
    updated: str("updated") ?? "",
    ready: p.derived.ready,
    blocked: p.derived.blocked,
    stale: p.derived.stale,
    mine: p.mine,
    unverified: p.derived.unverified,
  };
  for (const k of ["resolution", "assignee", "parent", "rank"] as const) {
    const v = str(k);
    if (v !== undefined) dto[k] = v;
  }
  if (p.derived.childProgress !== undefined) dto.child_progress = p.derived.childProgress;
  return dto;
}
