// src/commands/prime.ts
// FR-P1：推送「你正在做什么」，指向其余一切（D010）。它跑在会话开始与压缩之后的钩子里，
// 每次注入都要付钱——所以默认只推当前任务，其余只给一行指针；`--full` 才给全景（FR-P3）。
//
// 只读：不取锁、不刷心跳、不记 Log。唯一的写是 FR-P1b 的会话时间，在运行时目录里，尽力而为。

import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { isDisplayable, staleInputFor, visible, visibleLine } from "./view.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { nowStamp } from "../format/write.ts";
import { UNREADABLE, recordPrime, verifyPrint } from "../format/session.ts";
import { indexTasks, isBlocked, isReady, statusOf } from "../domain/derive.ts";
import { parseAcceptance } from "../domain/acceptance.ts";
import { logEntries, validateFile } from "../domain/validate.ts";
import { isMine } from "../domain/actor.ts";
import { sortTasks } from "../domain/order.ts";
import { estimateTokens } from "../domain/tokens.ts";
import type { TaskFile } from "../domain/types.ts";
import type { PrimeFullReport, PrimeReport, PrimeTask } from "../output/dto/prime.ts";
import { moreHeldLine, pointer, renderPrime } from "../output/render/prime.ts";
import { EXIT, CliError } from "../exit.ts";

export type PrimeOptions = {
  directory: string;
  budget?: number;
  session?: string;
  actor?: string;
};

/** FR-P1a：默认 600，由最坏情形（10 条验收 + 3 条长 Log，实测 368）加约 1.6 倍余量推出。 */
export const DEFAULT_BUDGET = 600;

/** --budget 从字符串出发解析：`0x10`、`1.5`、`1e3` 都不是 token 数（`ls --limit` 的同一条教训）。 */
export function parseBudget(raw: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new CliError(EXIT.usage, `Option --budget needs a non-negative whole number of tokens; got ${JSON.stringify(raw)}.`);
  }
  return Number(raw);
}

const str = (t: TaskFile, k: string): string => {
  const v = t.frontmatter[k];
  return typeof v === "string" ? v : "";
};

const shown = (t: TaskFile, k: string): string => visibleLine(str(t, k));

/**
 * 一个持有任务的推送内容。`level` 是 FR-P1a 的项内截断：
 * 0 全量；1 丢掉已勾的标准（未勾的永不丢——它们正是推送的意义）；2 再把 Log 从 2 条减到最新 1 条。
 */
function project(t: TaskFile, level: 0 | 1 | 2): PrimeTask {
  const all = parseAcceptance(t.body);
  const kept = level >= 1 ? all.filter((c) => !c.checked) : all;
  const every = logEntries(t.body);
  const entries = every.slice(level >= 2 ? -1 : -2);
  return {
    id: t.idFromFilename,
    title: shown(t, "title"),
    acceptance: kept.map((c) => ({ n: c.n, text: visible(c.text), checked: c.checked })),
    checkedOmitted: all.length - kept.length,
    acceptanceTotal: all.length,
    seeAlso: all.length === 0 ? `todopi show ${t.idFromFilename}` : null,
    log: entries.map((e) => visible([e.head, ...e.continuation.map((l) => `  ${l}`)].join("\n"))),
    logOmitted: Math.min(every.length, 2) - entries.length,
  };
}

type View = {
  tasks: TaskFile[];
  index: ReturnType<typeof indexTasks>;
  stale: ReturnType<typeof staleInputFor>;
  held: TaskFile[];
  others: TaskFile[];
};

function view(opts: PrimeOptions): View & { ledger: ReturnType<typeof discoverLedger>; actor: string; all: TaskFile[] } {
  const ledger = discoverLedger(opts.directory);
  const read = readTasks(ledger);
  // 图建在磁盘上的全部任务之上（ls 的同一条理由：排除一个任务是有派生后果的）；显示只用读得通的。
  const index = indexTasks(read);
  const tasks = read.filter((t) => isDisplayable(validateFile(t)));
  const stale = staleInputFor(ledger);
  const actor = currentActor(ledger.root, opts.actor);
  const who = { actor, host: hostname() };
  const inProgress = tasks.filter((t) => statusOf(t) === "in_progress");
  // FR-C6：展示用宽松匹配。stale 的也算——租约过期不等于你不在做它了。
  const held = inProgress.filter((t) => isMine(t.frontmatter["assignee"], who))
    .sort((a, b) => (str(a, "updated") < str(b, "updated") ? 1 : str(a, "updated") > str(b, "updated") ? -1 : 0));
  const others = inProgress.filter((t) => !isMine(t.frontmatter["assignee"], who));
  return { ledger, actor, all: read, tasks, index, stale, held, others };
}

/**
 * FR-P1b：记下这次 prime 的时间。**失败不影响输出与退出码**——它跑在会话开始的钩子里，
 * 一个写不进去的运行时目录不该让 agent 拿不到当前任务。失败原因交给调用方打到 stderr。
 */
function record(v: ReturnType<typeof view>, opts: PrimeOptions): string[] {
  try {
    // 快照取磁盘上**全部**读得出的任务（含 doctor 不认的），handoff 才能发现任何一个的 verify 变了。
    const verify: Record<string, string> = {};
    for (const t of v.all) {
      const raw = t.frontmatter["verify"];
      verify[t.idFromFilename] = t.parseError !== undefined ? UNREADABLE : verifyPrint(typeof raw === "string" ? raw : undefined);
    }
    recordPrime(v.ledger, opts.session !== undefined ? { session: opts.session } : { actor: v.actor }, nowStamp(), verify);
    return [];
  } catch (err) {
    return [`Could not record this prime for handoff: ${err instanceof Error ? err.message : String(err)}`];
  }
}

export function runPrime(opts: PrimeOptions): { report: PrimeReport; warnings: string[] } {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const v = view(opts);
  const ready = v.tasks.filter((t) => isReady(v.index, t, v.stale)).length;

  let level: 0 | 1 | 2 = 0;
  let count = v.held.length;
  const build = (): PrimeReport => {
    const more = v.held.length - count;
    const p = pointer(ready, v.others.length, v.held.length > 0);
    const line = moreHeldLine(more);
    const held = v.held.slice(0, count).map((t) => project(t, level));
    const r: PrimeReport = {
      held,
      moreHeld: more,
      ready,
      heldByOthers: v.others.length,
      budget,
      truncated: false,
      overBudget: false,
      moreHeldLine: line,
      pointer: p.line,
      // 文本里提到的每条命令，按出现顺序：各任务的 seeAlso、「另有 N 个」、指针。
      commands: [...held.flatMap((t) => (t.seeAlso === null ? [] : [t.seeAlso])),
        ...(line === null ? [] : ["todopi ls --mine"]), ...p.commands],
    };
    // truncated 按**实际省略的内容**算：收紧一级不等于真省掉了什么——没有已勾标准、只有一条 Log 的
    // 任务收紧到底也还是原样（第二轮评审：只按级别算会误报）。
    r.truncated = more > 0 || r.held.some((t) => t.checkedOmitted > 0 || t.logOmitted > 0);
    return { ...r, overBudget: estimateTokens(renderPrime(r)) > budget };
  };

  // FR-P1a：先在项内截断（所有任务一起收紧），再把装不下的任务从旧的一端退化为一行计数。
  // 第一个任务收紧到底仍超预算时照样输出：它的未勾标准是这个命令存在的理由。没有持有的任务
  // 时无可收紧——只剩指针，它永不裁剪（此时 truncated 为假，overBudget 如实报告）。
  let report = build();
  while (report.overBudget && v.held.length > 0 && level < 2) {
    level = level === 0 ? 1 : 2;
    report = build();
  }
  while (report.overBudget && count > 1) {
    count -= 1;
    report = build();
  }
  return { report, warnings: record(v, opts) };
}

/** FR-P3：全景。给 agent 主动调用——FR-P1 的指针指向的就是它。不受预算约束。 */
export function runPrimeFull(opts: PrimeOptions): { report: PrimeFullReport; warnings: string[] } {
  const v = view(opts);
  const sorted = sortTasks(v.tasks);
  const ready = sorted.filter((t) => isReady(v.index, t, v.stale));
  const byUpdatedDesc = (a: TaskFile, b: TaskFile) => (str(a, "updated") < str(b, "updated") ? 1 : str(a, "updated") > str(b, "updated") ? -1 : 0);
  const closed = v.tasks.filter((t) => statusOf(t) === "closed");
  const report: PrimeFullReport = {
    held: v.held.map((t) => project(t, 0)),
    heldByOthers: sortTasks(v.others).map((t) => ({ id: t.idFromFilename, title: shown(t, "title"), assignee: shown(t, "assignee") })),
    ready: ready.slice(0, 5).map((t) => ({ id: t.idFromFilename, title: shown(t, "title") })),
    readyTotal: ready.length,
    readyMore: ready.length > 5 ? { count: ready.length - 5, command: "todopi ls --ready" } : null,
    counts: {
      open: v.tasks.filter((t) => statusOf(t) === "open").length,
      in_progress: v.tasks.filter((t) => statusOf(t) === "in_progress").length,
      ready: ready.length,
      blocked: v.tasks.filter((t) => statusOf(t) !== "closed" && isBlocked(v.index, t)).length,
      closed: closed.length,
    },
    recentlyClosed: [...closed].sort(byUpdatedDesc).slice(0, 3)
      .map((t) => ({ id: t.idFromFilename, title: shown(t, "title"), resolution: shown(t, "resolution") })),
  };
  return { report, warnings: record(v, opts) };
}
