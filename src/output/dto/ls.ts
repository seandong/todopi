// src/output/dto/ls.ts
// ls 的对外契约。--json 是 agent 解析的入口（协议文本第 6 条「解析时加 --json」），
// FR-Q3 给了它版本承诺——改字段名要升 CLI 主版本。
//
// 字段名跟格式规格走（blocked_by 用下划线，与 frontmatter 同名），派生态用
// 形容词（ready / blocked / stale），容器进度是一个对象而不是 "1/2" 这样的
// 字符串——字符串会逼着消费者去解析它。

import type { TaskFile } from "../../domain/types.ts";
import {
  childProgress, isBlocked, isContainer, isReady, isStale, statusOf,
  type StaleInput, type TaskIndex,
} from "../../domain/derive.ts";
import { isMine } from "../../domain/actor.ts";

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
  /** 容器才有；叶子为 undefined */
  children?: { closed: number; total: number };
};

export type LsReport = {
  tasks: TaskDto[];
  /** 过滤后、截断前的匹配数，让「显示了 2 条，共 17 条」成为可能 */
  total: number;
  /**
   * 解析不出来的任务文件的 id。它们不进 tasks——没有标题也没有状态，
   * 当成任务列出来只会是一条幽灵记录；但也不能悄悄丢掉，否则 agent
   * 会以为这个任务不存在，转头又建一个重复的。
   */
  unreadable: string[];
};

export function toTaskDto(
  index: TaskIndex, t: TaskFile, stale: StaleInput, who: { actor?: string; host: string },
): TaskDto {
  const fm = t.frontmatter;
  const str = (k: string): string | undefined => (typeof fm[k] === "string" ? (fm[k] as string) : undefined);
  const list = (k: string): string[] =>
    Array.isArray(fm[k]) ? (fm[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];

  const dto: TaskDto = {
    id: t.idFromFilename,
    title: str("title") ?? "",
    status: statusOf(t),
    blocked_by: list("blocked_by"),
    labels: list("labels"),
    created: str("created") ?? "",
    updated: str("updated") ?? "",
    ready: isReady(index, t, stale),
    blocked: isBlocked(index, t),
    stale: isStale(t, stale),
    mine: isMine(fm["assignee"], who),
  };
  for (const k of ["resolution", "assignee", "parent", "rank"] as const) {
    const v = str(k);
    if (v !== undefined) dto[k] = v;
  }
  if (isContainer(index, t)) dto.children = childProgress(index, t);
  return dto;
}
