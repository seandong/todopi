// src/commands/ls.ts
import { hostname } from "node:os";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { readHeartbeats } from "../format/lease.ts";
import { indexTasks, isBlocked, isReady, statusOf, type StaleInput } from "../domain/derive.ts";
import { isMine } from "../domain/actor.ts";
import { sortTasks } from "../domain/order.ts";
import { toTaskDto, type LsReport } from "../output/dto/ls.ts";
import { EXIT, CliError } from "../exit.ts";

export type LsOptions = {
  directory: string;
  all?: boolean;
  closed?: boolean;
  ready?: boolean;
  blocked?: boolean;
  mine?: boolean;
  label?: string;
  limit?: number;
  actor?: string;
};

/** 四个模式选项互斥；--mine 与 --label 不是模式，能和任何模式叠加。 */
const MODES = ["all", "closed", "ready", "blocked"] as const;

export function runLs(opts: LsOptions): LsReport {
  const modes = MODES.filter((m) => opts[m] === true);
  if (modes.length > 1) {
    // 静默取其一是最坏的结果：agent 以为自己问的是 A，拿到的是 B，而它看不见
    throw new CliError(EXIT.usage,
      `Options --${modes.join(" and --")} cannot be combined; each selects a different set of tasks.`);
  }
  if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit >= 0)) {
    throw new CliError(EXIT.usage, "Option --limit needs a non-negative whole number.");
  }

  const ledger = discoverLedger(opts.directory);
  const all = readTasks(ledger);
  // 解析不出来的文件不进列表，但会被单独报告——见 LsReport.unreadable
  const unreadable = all.filter((t) => t.parseError !== undefined).map((t) => t.idFromFilename);
  const tasks = all.filter((t) => t.parseError === undefined);
  const index = indexTasks(tasks);

  const heartbeats = readHeartbeats(ledger);
  const stale: StaleInput = {
    now: Date.now(),
    leaseHours: ledger.config.lease_hours,
    heartbeatAt: (id) => heartbeats.get(id) ?? null,
  };
  const who = { actor: opts.actor, host: hostname() };

  let kept = tasks.filter((t) => {
    if (opts.ready === true) return isReady(index, t, stale);
    if (opts.blocked === true) return isBlocked(index, t);
    if (opts.closed === true) return statusOf(t) === "closed";
    if (opts.all === true) return true;
    return statusOf(t) !== "closed";            // FR-T2：默认隐藏已关闭的
  });
  if (opts.mine === true) kept = kept.filter((t) => isMine(t.frontmatter["assignee"], who));
  if (opts.label !== undefined) {
    const want = opts.label;
    kept = kept.filter((t) => {
      const labels = t.frontmatter["labels"];
      return Array.isArray(labels) && labels.includes(want);
    });
  }

  // 先排序再截断：spec §7.4 的顺序是对**结果集**的，
  // 先截断再排序会得到一个稳定但错误的前 N 个。
  const total = kept.length;
  const sorted = sortTasks(kept);
  const limited = opts.limit === undefined ? sorted : sorted.slice(0, opts.limit);
  return { tasks: limited.map((t) => toTaskDto(index, t, stale, who)), total, unreadable };
}
