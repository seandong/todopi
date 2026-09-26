// src/commands/handoff.ts
// FR-H1：会话结束时，让人看到自己的 agent 做了什么，并给自己持有的任务留一笔交接。
//
// 报告用**宽松**匹配（FR-C6：人在终端里看得到自己 agent 的任务）；写入用**严格**匹配——只往
// assignee 恰好是当前 actor 的进行中任务追加 `handoff` 并刷新心跳。**不释放认领。**

import { hostname } from "node:os";
import { currentActor } from "./actor.ts";
import { isDisplayable, visible } from "./view.ts";
import { writeAsWorker } from "./worker-write.ts";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { readPrimeRecord, verifyPrint } from "../format/session.ts";
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
const ref = (t: TaskFile) => ({ id: t.idFromFilename, title: visible(str(t, "title") ?? "") });

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
        : [{ ...ref(t), assignee: visible(str(t, "assignee") ?? ""), lastLogAt: last }];
    });

  // 2. 自上次 prime 以来我新建的。有快照时以「快照里没有这个 id」为准（被合并进来的也算出现）；
  //    旧格式的记录没有快照，退回比 created 时间。从没 prime 过：没有基准，不猜。
  const snap = record?.verify ?? null;
  const appeared = (t: TaskFile) => (snap !== null ? !(t.idFromFilename in snap)
    : (str(t, "created") ?? "") > (record?.primedAt ?? "￿"));
  const created = record === null ? null : tasks.filter((t) => {
    if (!appeared(t)) return false;
    const origin = parsedLog(t).find((p) => p.verb === "created");
    return origin !== undefined && isMine(origin.actor, who);
  }).map(ref);

  // 3. verify 新出现或变了的——所有人的任务（FR-D4：威胁正是别人改了 verify）。只有快照能回答，
  //    包括手改文件与合并进来的 PR；Log 里的 `edited fields=verify` 回答不了这两种。
  const verifyChanged = snap === null ? null : all.flatMap((t) => {
    const raw = str(t, "verify");
    const before = snap[t.idFromFilename];
    const changed = before === undefined ? raw !== undefined : before !== verifyPrint(raw);
    return changed ? [{ ...ref(t), verify: raw === undefined ? null : visible(raw) }] : [];
  });

  const report: HandoffReport = {
    actor: visible(actor), primedAt: record?.primedAt ?? null,
    quiet, created, verifyChanged, logged: [], failed: [], check: opts.check === true,
    baselineNote: record === null ? "No baseline: no `todopi prime` recorded for this session yet."
      : snap === null ? "No baseline: the last `todopi prime` predates verify snapshots; the next one records one."
        : null,
  };
  if (opts.check === true) return report;

  // 写：严格匹配，只写 assignee 恰好是我的进行中任务。一个写不成不影响其余。
  for (const t of tasks.filter((x) => statusOf(x) === "in_progress" && x.frontmatter["assignee"] === actor)) {
    try {
      let summary = "";
      writeAsWorker({ directory: opts.directory, id: t.idFromFilename, actor }, (fresh, { now: ts }) => {
        // 摘要按锁内读到的最新内容算。
        summary = summaryOf(fresh);
        return { appendLog: `${ts} ${actor} handoff: ${summary}` };
      });
      report.logged.push({ ...ref(t), summary });
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      report.failed.push({ ...ref(t), message: err.message, code: err.code });
    }
  }
  return report;
}
