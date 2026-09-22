// src/commands/release.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { updateTask } from "../format/write.ts";
import { deleteLease } from "../format/lease.ts";
import { statusOf } from "../domain/derive.ts";
import { validateWrite } from "../domain/validate.ts";
import { currentActor } from "./actor.ts";
import { nowStamp, withLockConflictMapped } from "./claim.ts";
import { EXIT, CliError } from "../exit.ts";
import type { ReleaseReport } from "../output/dto/claim.ts";

export type ReleaseOptions = {
  directory: string;
  id: string;
  actor?: string;
};

export function runRelease(opts: ReleaseOptions): ReleaseReport {
  const ledger = discoverLedger(opts.directory);
  const actor = currentActor(ledger.root, opts.actor);

  const task = readTasks(ledger).find((t) => t.idFromFilename === opts.id);
  if (task === undefined) {
    throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
  }

  const status = statusOf(task);
  if (status !== "in_progress") {
    // spec §6.1 只有 in_progress → open 这一行。别的起点都不是迁移。
    throw new CliError(EXIT.gate,
      `Task ${opts.id} is ${status || "in an unknown state"}, not in_progress; there is nothing to release.`);
  }

  const assignee = task.frontmatter["assignee"];
  if (typeof assignee === "string" && assignee !== "" && assignee !== actor) {
    // spec §6.1 末段：任务的 assignee 是另一个 actor 时，写入必须被拒绝，
    // 这样两个工作者不会在同一个任务上交错写入。release 是迁移，理由相同。
    // 想强行接管的人用 `claim --steal`——那条路会留痕（steal=true）。
    throw new CliError(EXIT.conflict,
      `Task ${opts.id} is held by ${assignee}, not by you (${actor}). ` +
      "Use `todopi claim --steal` to take it over instead.");
  }

  const title = String(task.frontmatter["title"] ?? "");
  const now = nowStamp();

  // **先改任务文件、后删租约**——与 claim 的顺序相反，理由也相反：
  // 这里崩在中间留下的是「任务已 open 但租约还在」，而挂在 open 任务上的租约
  // 没人读（isStale 只对 in_progress 查心跳），doctor --fix 会清掉。
  // 反过来先删租约，留下的是「任务仍 in_progress 但没人持有」——那会被当成
  // 陈旧任务等到租期过完才可认领，白白卡住一个本该立刻可用的任务。
  //
  // 两条路径的共同判据是一样的：宁可留下一个可丢弃的运行时文件，
  // 也不要让 committed 的记录说一件不成立的事。
  withLockConflictMapped(() => updateTask(ledger, opts.id, (t) => {
    const next = { ...t.frontmatter };
    delete next["assignee"];                    // 不变量 3：open 时 assignee 必须缺席
    return { frontmatter: { ...next, status: "open" }, appendLog: `${now} ${actor} released` };
  }, validateWrite));

  deleteLease(ledger, opts.id);

  return { id: opts.id, title, status: "open" };
}
