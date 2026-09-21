// src/commands/ls.ts
import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { readHeartbeats } from "../format/lease.ts";
import { indexTasks, deriveState, isBlocked, isReady, statusOf, type StaleInput } from "../domain/derive.ts";
import { validateFile } from "../domain/validate.ts";
import { isMine } from "../domain/actor.ts";
import { sortTasks } from "../domain/order.ts";
import { toTaskDto, type LsReport } from "../output/dto/ls.ts";
import { EXIT, CliError } from "../exit.ts";

export type LsOptions = {
  directory: string;
  open?: boolean;
  all?: boolean;
  closed?: boolean;
  ready?: boolean;
  blocked?: boolean;
  mine?: boolean;
  label?: string;
  limit?: number;
  actor?: string;
};

/** 五个模式选项互斥；--mine 与 --label 不是模式，能和任何模式叠加。 */
const MODES = ["open", "all", "closed", "ready", "blocked"] as const;

/**
 * 把 --limit 的**原始字符串**解析成非负整数。
 *
 * 不能用 Number.parseInt：它会把 "1.5" 和 "1foo" 读成 1、把 "0x10" 读成 0。
 * 实测过——`ls --limit 0x10` 会静默地一条都不列，而 agent 完全看不出发生了什么。
 * 这个函数必须从字符串出发做测试：之前的用例直接往 runLs 塞 number，
 * 绕开了真正有缺陷的那一层，于是全绿而边界是坏的。
 */
export function parseLimit(raw: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new CliError(EXIT.usage, `Option --limit needs a non-negative whole number; got ${JSON.stringify(raw)}.`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    throw new CliError(EXIT.usage, `Option --limit is too large: ${JSON.stringify(raw)}.`);
  }
  return n;
}

/**
 * 这个任务文件是不是一份合法的 v1 任务文件。
 *
 * 用的是 validateFile 已有的 rule 分类，不另起一个校验器——两个校验器一定会漂移。
 * 分界线：`envelope` / `invariant-1` / `field` 说的是「某个字段本身不合法」，
 * 这样的文件没法渲染也没法派生（缺 title 就是一行空标题，缺 status 就没有状态），
 * 必须单独报告；`invariant-2/3/7/8` 说的是「字段都合法但组合非法」（比如 open
 * 却带 assignee），那种任务照样能渲染，按 spec §7 派生出来的结果也是对的，
 * 报告它们是 doctor 的职责，不是 ls 的。
 */
function isWellFormed(findings: ReturnType<typeof validateFile>): boolean {
  return !findings.some((f) => f.rule === "envelope" || f.rule === "invariant-1" || f.rule === "field");
}

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
  const read = readTasks(ledger);
  const invalid: string[] = [];
  const tasks = read.filter((t) => {
    if (isWellFormed(validateFile(t))) return true;
    invalid.push(t.idFromFilename);
    return false;
  });
  const index = indexTasks(tasks);

  const heartbeats = readHeartbeats(ledger);
  const stale: StaleInput = {
    now: Date.now(),
    leaseHours: ledger.config.lease_hours,
    heartbeatAt: (id) => heartbeats.get(id) ?? null,
  };
  // FR-C4：查询身份也走完整解析链，不只是 --as
  const who = { actor: currentActor(ledger.root, opts.actor), host: hostname() };

  let kept = tasks.filter((t) => {
    if (opts.ready === true) return isReady(index, t, stale);
    if (opts.blocked === true) return isBlocked(index, t);
    if (opts.closed === true) return statusOf(t) === "closed";
    if (opts.all === true) return true;
    return statusOf(t) !== "closed";            // FR-T2：--open 是默认
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
  return {
    tasks: limited.map((t) => toTaskDto({
      task: t, derived: deriveState(index, t, stale), mine: isMine(t.frontmatter["assignee"], who),
    })),
    total,
    invalid,
  };
}
