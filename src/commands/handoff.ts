// src/commands/handoff.ts
// FR-H1：会话结束时，让人看到自己的 agent 做了什么，并给自己持有的任务留一笔交接。
//
// 报告用**宽松**匹配（FR-C6：人在终端里看得到自己 agent 的任务）；写入用**严格**匹配——只往
// assignee 恰好是当前 actor 的进行中任务追加 `handoff` 并刷新心跳。**不释放认领。**

import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { isDisplayable, visibleLine } from "./view.ts";
import { writeAsWorker } from "./worker-write.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { UNREADABLE, readPrimeRecord, verifyPrint } from "../format/session.ts";
import { statusOf } from "../domain/derive.ts";
import { parseAcceptance } from "../domain/acceptance.ts";
import { logEntries, parseLogLine, validateFile } from "../domain/validate.ts";
import { isMine } from "../domain/actor.ts";
import { sortTasks } from "../domain/order.ts";
import type { TaskFile } from "../domain/types.ts";
import type { HandoffReport } from "../output/dto/handoff.ts";
import { CliError } from "../exit.ts";

export type HandoffOptions = {
  directory: string;
  session?: string;
  actor?: string;
  /** 只报告，不写（给钩子用） */
  check?: boolean;
  /** 「最近一小时」的参照时刻，毫秒；测试用 */
  now?: number;
};

const HOUR = 60 * 60 * 1000;

const str = (t: TaskFile, k: string): string | undefined => {
  const v = t.frontmatter[k];
  return typeof v === "string" ? v : undefined;
};
const ref = (t: TaskFile) => ({ id: t.idFromFilename, title: visibleLine(str(t, "title") ?? "") });

/** 每条能解析的 Log 的时间与 actor、verb。 */
function parsedLog(t: TaskFile) {
  return logEntries(t.body).map((e) => parseLogLine(e.head)).flatMap((p) => (p.ok ? [p] : []));
}

/** handoff Log 的摘要：由 CLI 生成（spec §5.3.3：text = summary）。 */
function summaryOf(t: TaskFile): string {
  const ac = parseAcceptance(t.body);
  return ac.length === 0 ? "no checkbox criteria" : `${ac.filter((c) => c.checked).length}/${ac.length} criteria checked`;
}

export function runHandoff(opts: HandoffOptions): HandoffReport {
  const ledger = discoverLedger(opts.directory);
  const actor = currentActor(ledger.root, opts.actor);
  const who = { actor, host: hostname() };
  const now = opts.now ?? Date.now();
  const all = readTasks(ledger);
  const tasks = sortTasks(all.filter((t) => isDisplayable(validateFile(t))));
  const record = readPrimeRecord(ledger, opts.session !== undefined ? { session: opts.session } : { actor });

  // 1. 我的进行中任务里，最近一小时没有 Log 的。
  const quiet = tasks
    .filter((t) => statusOf(t) === "in_progress" && isMine(t.frontmatter["assignee"], who))
    .flatMap((t) => {
      const last = parsedLog(t).map((p) => p.timestamp).sort().at(-1) ?? null;
      return last !== null && Date.parse(last) > now - HOUR ? []
        : [{ ...ref(t), assignee: visibleLine(str(t, "assignee") ?? ""), lastLogAt: last }];
    });

  // 2、3 都要一个基准：上次 prime 时的快照。从没 prime 过、或上次 prime 是没有快照的旧格式，**两节都
  //    不猜**（F12 评审：旧格式下曾退回比 created 时间，合并进来的旧任务就漏了）。
  const snap = record?.verify ?? null;

  // 2. 自上次 prime 以来我新建的：快照里没有这个 id（新建的与被合并进来的都算出现），且 created
  //    那条 Log 的 actor 算我的（宽松匹配）。
  const created = snap === null ? null : tasks.filter((t) => {
    if (t.idFromFilename in snap) return false;
    const origin = parsedLog(t).find((p) => p.verb === "created");
    return origin !== undefined && isMine(origin.actor, who);
  }).map(ref);

  // 3. verify 新出现、变了、被去掉、或读不出来的——所有人的任务（FR-D4：威胁正是别人改了 verify）。
  //    判据是「与 prime 时不同」（快照能看见手改与合并）；另把 prime 之后 Log 里的
  //    `edited fields=…verify…` 并进来：经 CLI 改了又改回的，现值相同也报（F12 评审的 A→B→A）。
  //    手改了又改回的看不见——快照只有两端。
  const since = record?.primedAt ?? "";
  const editedVerify = (t: TaskFile) => parsedLog(t).some((p) => p.verb === "edited" && p.timestamp > since
    && (p.args["fields"] ?? "").split(",").includes("verify"));
  type VerifyRow = NonNullable<HandoffReport["verifyChanged"]>[number];
  const verifyRow = (t: TaskFile, before: string | undefined): VerifyRow | null => {
    if (t.parseError !== undefined) {
      // 读不出来：不知道 verify 是什么，就不说它「被删了」（F12 评审：YAML 坏掉曾被报成 removed）。
      return before === UNREADABLE ? null : { ...ref(t), verify: null, state: "unreadable" };
    }
    const raw = str(t, "verify");
    const verify = raw === undefined ? null : visibleLine(raw);
    if (before === undefined || before === UNREADABLE) return raw === undefined ? null : { ...ref(t), verify, state: before === undefined ? "new" : "changed" };
    if (before !== verifyPrint(raw)) return { ...ref(t), verify, state: raw === undefined ? "removed" : "changed" };
    return editedVerify(t) ? { ...ref(t), verify, state: "edited" } : null;
  };
  const verifyChanged = snap === null ? null
    : all.map((t) => verifyRow(t, snap[t.idFromFilename])).filter((row): row is VerifyRow => row !== null);

  const report: HandoffReport = {
    actor: visibleLine(actor), primedAt: record?.primedAt ?? null,
    quiet, created, verifyChanged, logged: [], skipped: [], failed: [], check: opts.check === true,
    baselineNote: record === null ? "No baseline: no `todopi prime` recorded for this session yet."
      : snap === null ? "No baseline: the last `todopi prime` predates verify snapshots; the next one records one."
        : null,
  };
  if (opts.check === true) return report;

  // 写：严格匹配，只写 assignee 恰好是我的进行中任务。一个写不成不影响其余。
  for (const t of tasks.filter((x) => statusOf(x) === "in_progress" && x.frontmatter["assignee"] === actor)) {
    try {
      const r = logHandoff(opts.directory, actor, t.idFromFilename);
      if (r.logged) report.logged.push({ ...ref(t), summary: r.summary });
      else report.skipped.push({ ...ref(t), reason: r.reason });
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      report.failed.push({ ...ref(t), message: visibleLine(err.message), code: err.code });
    }
  }
  return report;
}

/**
 * 给一个任务追加 handoff 并刷新心跳。**锁内重新核验**：调用方的筛选在锁外，从那时到拿到锁之间任务可能
 * 已被释放、关闭或转手；写入骨架只挡「别人持有」，不挡「已经不是我的」（F12 评审实测：handoff 写进了
 * 一个已释放的 open 任务）。单独导出，好直接测这条路径。
 */
export function logHandoff(directory: string, actor: string, id: string):
  { logged: true; summary: string } | { logged: false; reason: string } {
  let summary = "";
  const r = writeAsWorker({ directory, id, actor }, (fresh, { now: ts }) => {
    if (statusOf(fresh) !== "in_progress" || fresh.frontmatter["assignee"] !== actor) {
      return { noop: "no longer in progress under this actor" };
    }
    summary = summaryOf(fresh);
    return { appendLog: `${ts} ${actor} handoff: ${summary}` };
  });
  return r.noop !== undefined ? { logged: false, reason: r.noop } : { logged: true, summary };
}
