// src/commands/dep.ts
// FR-G1：`dep add <id> --on <id>` / `dep rm` 维护 blocked_by；有环则拒绝并打印环。

import { writeAsWorker } from "./worker-write.ts";
import { statusOf } from "../domain/derive.ts";
import type { DepReport } from "../output/dto/plan.ts";
import { EXIT, CliError } from "../exit.ts";

export type DepOptions = { directory: string; op: "add" | "rm"; id: string; on: string; actor?: string };

/**
 * 成环的判定**不在这里**：写入门禁 validateWrite 对「这次写入新引入的」图问题做差集，环带着
 * 路径报出来——与 doctor 用的是同一个查环器。这里再写一个，两者迟早给出不同结论。
 */
export function runDep(opts: DepOptions): DepReport {
  if (opts.id === opts.on) {
    throw new CliError(EXIT.usage, `A task cannot be blocked by itself (${opts.id}).`);
  }
  // 归属照查（FR-C6）：dep 改写的是**被阻塞那个任务**的文件并往它的 Log 里追加——若它正被
  // 别人持有，就是两个工作者在同一个任务上交错写入。第一版以为它和 add --blocked-by 同类而不查，
  // 那个类比是错的：add 写的是一个新任务，dep 写的是别人正在做的任务（F10 评审）。
  const r = writeAsWorker(opts, (task, { now, actor, all }) => {
    if (statusOf(task) === "closed") {
      throw new CliError(EXIT.gate,
        `Task ${opts.id} is closed; its dependencies are the record of what it waited on. `
        + `Reopen it first with \`todopi reopen ${opts.id}\` if they need to change.`);
    }
    if (opts.op === "add" && !all.some((t) => t.idFromFilename === opts.on)) {
      throw new CliError(EXIT.usage, `No task ${opts.on} in this ledger, so ${opts.id} cannot depend on it.`);
    }
    const current = Array.isArray(task.frontmatter["blocked_by"])
      ? (task.frontmatter["blocked_by"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const has = current.includes(opts.on);
    // 幂等：边已经在 / 本就不在，什么都不写（同 check 的理由）。
    if (opts.op === "add" ? has : !has) return { noop: opts.op === "add" ? "already blocked by it" : "not blocked by it" };

    // 它是集合：排序去重，diff 才稳定。删到空就整个省略字段。
    const next = [...new Set(opts.op === "add" ? [...current, opts.on] : current.filter((x) => x !== opts.on))].sort();
    const fm: Record<string, unknown> = { ...task.frontmatter };
    if (next.length === 0) delete fm["blocked_by"];
    else fm["blocked_by"] = next;
    return { frontmatter: fm, appendLog: `${now} ${actor} edited fields=blocked_by` };
  });
  return { id: opts.id, op: opts.op, on: opts.on, changed: r.wrote };
}
