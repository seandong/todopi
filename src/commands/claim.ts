// src/commands/claim.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { updateTask } from "../format/write.ts";
import {
  createLease, writeLease, touchLease, readHeartbeats, type Lease,
} from "../format/lease.ts";
import { decideClaim } from "../domain/claim.ts";
import { validateWrite } from "../domain/validate.ts";
import type { StaleInput } from "../domain/derive.ts";
import { currentActor } from "./actor.ts";
import { EXIT, CliError } from "../exit.ts";
import { LockBusyError } from "../fs/lock.ts";
import type { ClaimReport } from "../output/dto/claim.ts";

export type ClaimOptions = {
  directory: string;
  id: string;
  steal?: boolean;
  actor?: string;
};

export function runClaim(opts: ClaimOptions): ClaimReport {
  const ledger = discoverLedger(opts.directory);
  const actor = currentActor(ledger.root, opts.actor);

  // 存在性先在锁外查一次，只为把「打错 id」这种最常见的错误快速挡掉。
  // 真正的判断在锁内重做——这一次读到的东西不作数。
  if (!readTasks(ledger).some((t) => t.idFromFilename === opts.id)) {
    throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
  }

  let report: ClaimReport | null = null;

  // **整段「读 → 决策 → 写租约 → 写任务文件」落在同一次持锁内。**
  //
  // 第一版把决策与租约写入放在锁外，只有任务文件的改写在锁内。多进程用例当场
  // 抓到了后果：两个 --steal 交错时，先写租约的那个后写任务文件，收场是租约记
  // 着 B 而任务文件记着 A——两个文件对「谁持有它」给出不同答案，而这正是租约
  // 机制唯一要回答的问题。决策依据必须是锁内读到的那一份。
  withLockConflictMapped(() => updateTask(ledger, opts.id, (task, now) => {
    const heartbeats = readHeartbeats(ledger);
    const stale: StaleInput = {
      now: Date.parse(now),
      leaseHours: ledger.config.lease_hours,
      heartbeatAt: (id) => heartbeats.get(id) ?? null,
    };
    const decision = decideClaim({ task, actor, steal: opts.steal === true, stale });
    if (decision.kind === "refuse") throw new CliError(decision.code, decision.message);

    const title = String(task.frontmatter["title"] ?? "");

    // 刷新不是 spec §6.1 的迁移：不改 status/assignee，也不写 Log。
    // 但心跳要刷——那正是 FR-C3 说的「持有者的每次写入」。
    if (decision.kind === "refresh") {
      touchLease(ledger, opts.id, now);
      report = { id: opts.id, title, status: "in_progress", assignee: actor, stolen: false, refreshed: true };
      return null;
    }

    // **先租约、后任务文件。** 两者没有跨文件原子性，崩在中间总要留下点什么：
    // 这个顺序留下的是「有租约但任务仍 open」，而挂在 open 任务上的租约没人读
    // （isStale 只对 in_progress 查心跳），doctor --fix 会清掉它，重跑 claim 即可。
    // 反过来的顺序留下的是「任务已 in_progress 但没租约」——提交进仓库的记录
    // 跑到了本机事实前面，而 committed 的东西是要被别人当真的。
    const lease: Lease = { actor, claimed_at: now, heartbeat_at: now };
    // 先按 spec §8 用 O_EXCL 创建。失败说明已经有一份租约在：我们持着锁，
    // 而 decideClaim 已经基于committed 的事实批准了这次认领，所以那份租约
    // 要么属于我们决定接管的人，要么是上一次崩在两次写入之间留下的孤儿。
    // 两种都该被覆盖——否则那个孤儿会让「重跑 claim 即可恢复」这句话不成立。
    if (!createLease(ledger, opts.id, lease)) writeLease(ledger, opts.id, lease);

    const replaced = decision.kind === "reclaim" ? decision.replaced : undefined;
    report = {
      id: opts.id, title, status: "in_progress", assignee: actor,
      ...(replaced === undefined ? {} : { replaced }),
      stolen: replaced !== undefined,
      refreshed: false,
    };
    return {
      frontmatter: { ...task.frontmatter, status: "in_progress", assignee: actor },
      appendLog: replaced === undefined
        ? `${now} ${actor} claimed`
        : `${now} ${actor} claimed steal=true: ${replaced}`,
    };
  }, validateWrite));

  if (report === null) throw new Error("claim finished without producing a report");
  return report;
}

/** RFC 3339 UTC 秒级，与 spec §5.2 字段 12 的形状一致。 */
export function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 把 fs/ 的中性 LockBusyError 映射为 FR-Q2 的退出码 3。 */
export function withLockConflictMapped<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LockBusyError) throw new CliError(EXIT.conflict, err.message);
    throw err;
  }
}
