// src/domain/claim.ts
// spec §6.1 的 claim 决策。纯函数：不 import node:fs，六种情形都能用普通用例覆盖。

import { isStale, statusOf, type StaleInput } from "./derive.ts";
import type { TaskFile } from "./types.ts";

export type ClaimInput = {
  task: TaskFile;
  /** 当前解析出的身份（FR-C4），由 commands/actor.ts 取得 */
  actor: string;
  /** --steal */
  steal: boolean;
  /** 陈旧判定要的外部事实。**必须与 ls --ready 用同一份**——见下 */
  stale: StaleInput;
};

export type ClaimDecision =
  /** open → in_progress */
  | { kind: "claim" }
  /** in_progress → in_progress，替换了别人的 assignee */
  | { kind: "reclaim"; replaced: string; stolen: true }
  /** 已经是我的，只刷心跳与 updated，不记 steal */
  | { kind: "refresh" }
  /** 被拒绝的迁移。code 按 FR-Q2：2 门禁 / 3 冲突。**不得写 Log**（spec §6.1 末句） */
  | { kind: "refuse"; code: 2 | 3; message: string };

/**
 * spec §6.1 的三行迁移加上门禁，判成一个决定。
 *
 * **陈旧判定调用 derive.ts 的 isStale，不另写一套。** spec §6.1 自己给了理由：
 * 「§7.5 把陈旧的 in_progress 放进 ready 队列——一个把任务摆出来、claim 又
 * 拒绝它的组合会自相矛盾」。两处各判一次，迟早会在边界上分叉（比如恰好等于
 * lease_hours 时算不算过期），而分叉的表现正是 ready 队列给出的任务认领不了。
 */
export function decideClaim(input: ClaimInput): ClaimDecision {
  const { task, actor, steal } = input;
  const status = statusOf(task);

  if (status === "closed") {
    // §6.1 没有 closed → in_progress 这一行。reopen 才是那条路。
    return { kind: "refuse", code: 2, message: `Task ${task.idFromFilename} is closed. Reopen it first.` };
  }

  if (status === "open") return { kind: "claim" };

  if (status !== "in_progress") {
    return {
      kind: "refuse", code: 2,
      message: `Task ${task.idFromFilename} has status ${JSON.stringify(status)}, which is not one of ` +
        `open / in_progress / closed. Run "todopi doctor" to see what is wrong with it.`,
    };
  }

  const assignee = task.frontmatter["assignee"];
  if (typeof assignee !== "string" || assignee === "") {
    // 不变量 3 被破坏。硬认领会写出一条 steal=true 而被替换者为空的 Log 行，
    // 那是在用一条假记录掩盖一个真问题。
    return {
      kind: "refuse", code: 2,
      message: `Task ${task.idFromFilename} is in_progress but has no assignee. ` +
        `Run "todopi doctor" to see what is wrong with it.`,
    };
  }

  if (assignee === actor) return { kind: "refresh" };

  if (steal || isStale(task, input.stale)) {
    return { kind: "reclaim", replaced: assignee, stolen: true };
  }

  return {
    kind: "refuse", code: 3,
    message: `Task ${task.idFromFilename} is held by ${assignee} and the lease has not expired. ` +
      `Use --steal to take it over.`,
  };
}
