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
 * ls 能不能把这个文件当成一份正常任务来显示。
 *
 * 用的是 validateFile 已有的 rule 分类，不另起一个校验器——两个校验器一定会漂移。
 *
 * **名单反着列**：只写出 ls 可以容忍的那几条，其余一律排除并报告。
 * 正着列（「这几条要排除」）的话，将来新增的规则会默认从缝里漏过去，
 * 而漏过去的方向正是「把一个有问题的文件当成正常任务显示」——第一版就是
 * 这么让 `assignee: 123` 变成一条 ready 任务的（Codex 第二轮评审）。
 *
 * 容忍的三条都是「字段值本身合法、只是组合非法」：
 *   invariant-2  resolution 与 closed 不配套
 *   invariant-3  assignee 与 in_progress 不配套
 *   invariant-6  updated 早于 created
 * 这类任务照常渲染，按 spec §7 派生出的结果也是对的（§7.5 的 ready 只看状态
 * 与图，不看不变量），报告它们是 doctor 的职责。
 *
 * 其余都说明**字段值本身不对**——坏信封、id 对不上、字段取值非法、actor 语法
 * 非法、冲突标记。这样的文件没法渲染也没法派生：缺 title 就是一行空标题，
 * blocked_by 里的非法项会被读取侧丢掉而无人知晓。必须挡下并单独报告。
 */
const TOLERATED: ReadonlySet<string> = new Set(["invariant-2", "invariant-3", "invariant-6"]);

function isDisplayable(findings: ReturnType<typeof validateFile>): boolean {
  return findings.every((f) => TOLERATED.has(f.rule));
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
    if (isDisplayable(validateFile(t))) return true;
    invalid.push(t.idFromFilename);
    return false;
  });
  // **图建在磁盘上全部的任务之上，不是建在「我们打算显示的」之上。**
  // 一个字段坏掉的任务仍然是它父任务的子任务、仍然挡着依赖它的任务。
  // 只用可显示的任务建图，会让「唯一的子任务被挡下」的父任务从容器退化成
  // 叶子，进而错误地进入 ready 队列——排除一个任务是有派生后果的
  // （Codex 第三轮评审指出，随后被用例复现）。
  // 连解析失败的也进图：它们没有 parent / blocked_by，只留下一个 byId 条目，
  // 状态为空即「未关闭」，与悬空引用取同样保守的解读。
  //
  // 已知限制：**完全解析失败的任务恢复不出 parent**，所以它原来的父任务会
  // 少掉一个子任务，可能因此从容器变回叶子。字段级损坏没有这个问题
  // （frontmatter 读得出来，图关系完整）。使用者的发现路径是 stderr 列出 id、
  // doctor 给出原因；但「为什么这个父任务忽然可以 claim 了」不会自动说清楚。
  const index = indexTasks(read);

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
