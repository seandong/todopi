// 交接提示由显式 Log 事件得出；这是 CLI 的展示信息，不改变格式 v1 的派生状态。

import type { TaskFile } from "./types.ts";
import { statusOf } from "./derive.ts";
import { logEntries, parseLogLine } from "./validate.ts";

/** 当前这一轮的操作者报告；没有报告或任务未进行时不猜测。 */
export function verificationPending(task: TaskFile): string | null {
  if (statusOf(task) !== "in_progress") return null;
  let next: string | null = null;
  for (const entry of logEntries(task.body)) {
    const event = parseLogLine(entry.head);
    if (!event.ok) continue;
    if (event.verb === "verify_pending") {
      const text = [event.text, ...entry.continuation].filter((x): x is string => x !== undefined).join("\n");
      if (text.trim() !== "") next = text;
    } else if (event.verb === "verify_cleared" || event.verb === "done" || event.verb === "closed" || event.verb === "reopened") {
      next = null;
    }
  }
  return next;
}
