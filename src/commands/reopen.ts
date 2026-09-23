// src/commands/reopen.ts
import { runTransition, logLine, type TransitionOptions } from "./transition.ts";
import type { TransitionReport } from "../output/dto/gate.ts";

export type ReopenOptions = Omit<TransitionOptions, "transition" | "resolution">;

export function runReopen(opts: ReopenOptions): TransitionReport {
  return runTransition({ ...opts, transition: "reopen" }, {
    frontmatter: (fm) => {
      const next = { ...fm };
      // **两个键都要删。** FR-D5 与 spec §6.2 不变量 3：只删 resolution 会产出一个
      // 违反格式自身不变量的文件（open 的任务不得有 assignee）。
      // feature_list 的修复提示专门点了这一条，说明它是个容易漏的地方。
      delete next["resolution"];
      delete next["assignee"];
      return { ...next, status: "open" };
    },
    logLine: (ctx) => logLine("reopened", [], ctx),
    // 任务回到 open 就没有持有者了，本机若还留着租约要一并清掉，
    // 否则下一个人会撞上一份指向已经不存在的归属的租约。
    dropLease: true,
  });
}
