// src/commands/release.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { withLedgerLock, prepareUpdate, nowStamp } from "../format/write.ts";
import { deleteLease } from "../format/lease.ts";
import { statusOf } from "../domain/derive.ts";
import { validateWrite } from "../domain/validate.ts";
import { currentActor } from "./actor.ts";
import { withLockConflictMapped } from "./claim.ts";
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

  // **整段落在同一次持锁内，删租约也在里面。**
  //
  // 第一版在锁外确认归属、在锁外删租约，Codex 用执行屏障复现了两条竞态：
  //   - A 在锁外确认「这是我的」之后暂停，B `claim --steal` 成功，A 恢复后照样
  //     退出 0，把 B 刚拿到的任务释放掉；
  //   - A 写完任务文件、解锁、在删租约前暂停，B 普通 claim 成功建了新租约，
  //     A 恢复后把 B 刚建的租约删了。
  // 共享锁本身没失效，是 release 没把完整操作放进去。
  return withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const existing = readTasks(ledger);
    const task = existing.find((t) => t.idFromFilename === opts.id);
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
      // spec §6.1 末段：任务的 assignee 是另一个 actor 时写入必须被拒绝，
      // 这样两个工作者不会在同一个任务上交错写入。想接管的人用 `claim --steal`
      // ——那条路会留痕（steal=true）。
      throw new CliError(EXIT.conflict,
        `Task ${opts.id} is held by ${assignee}, not by you (${actor}). ` +
        "Use `todopi claim --steal` to take it over instead.");
    }

    const title = String(task.frontmatter["title"] ?? "");
    const now = nowStamp();

    const next = { ...task.frontmatter };
    delete next["assignee"];                    // 不变量 3：open 时 assignee 必须缺席
    // 先构造并校验，此时没有任何副作用（spec §6.1：被拒绝的迁移什么都不改）
    const prepared = prepareUpdate(ledger, existing, opts.id, {
      frontmatter: { ...next, status: "open" },
      appendLog: `${now} ${actor} released`,
    }, validateWrite, now);

    // **先改任务文件、后删租约**——与 claim 的顺序相反，理由也相反：这里崩在
    // 中间留下的是「任务已 open 但租约还在」，下一次 claim 会按 §8 的规则处理它
    // （过期则接管，未过期则提示 --steal）。反过来先删租约，留下的是「任务仍
    // in_progress 但没人持有」，那会被当成陈旧任务等到租期过完才可认领。
    prepared.commit();
    deleteLease(ledger, opts.id);

    return { id: opts.id, title, status: "open" };
  }));
}
