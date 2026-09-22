// src/commands/claim.ts
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { withLedgerLock, prepareUpdate, nowStamp } from "../format/write.ts";
import {
  createLease, writeLease, readLease, readHeartbeats, type Lease,
} from "../format/lease.ts";
import { decideClaim, leaseExpired } from "../domain/claim.ts";
import { validateWrite } from "../domain/validate.ts";
import type { StaleInput } from "../domain/derive.ts";
import type { Ledger } from "../format/discover.ts";
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
  const steal = opts.steal === true;

  // **整段「读 → 决策 → 构造并校验 → 写租约 → 写任务文件」落在同一次持锁内。**
  //
  // 顺序里的两处讲究，都是评审换来的：
  //   - 决策必须基于锁内读到的那一份。放在锁外时，两个 --steal 交错的结果是
  //     租约记着 B 而任务文件记着 A——两个文件对「谁持有它」给出不同答案。
  //   - 写租约必须在**校验之后**。放在校验前时，一个校验失败的 claim 已经把
  //     租约落盘了，而 spec §6.1 说被拒绝的迁移什么都不改。
  return withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const existing = readTasks(ledger);
    const task = existing.find((t) => t.idFromFilename === opts.id);
    if (task === undefined) {
      throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
    }

    // 时钟用毫秒。把 now 先截成秒再判断，会让 claim 比 ls --ready 晚最多一秒
    // 才认为一个任务陈旧——实测在 02:00:00.500 这种时刻两者给出相反结论，
    // 于是 ready 队列摆出来的任务 claim 拒绝，恰恰是 spec §6.1 要避免的自相矛盾。
    // 秒级截断只用于**序列化**（spec §5.2 字段 12 的时间戳形状）。
    const nowMs = Date.now();
    const now = nowStamp();

    const heartbeats = readHeartbeats(ledger);
    const stale: StaleInput = {
      now: nowMs,
      leaseHours: ledger.config.lease_hours,
      heartbeatAt: (id) => heartbeats.get(id) ?? null,
    };

    const decision = decideClaim({ task, actor, steal, stale });
    if (decision.kind === "refuse") throw new CliError(decision.code, decision.message);

    const title = String(task.frontmatter["title"] ?? "");
    const held = readLease(ledger, opts.id);

    // spec §8 的租约闸门，**独立于任务文件的状态**。
    //
    // 租约是跨 worktree 共享的（.git/todopi/leases/），而每个 worktree 有自己的
    // .todopi/tasks/。所以本地任务文件说 open，不代表没人持有它：另一个 worktree
    // 里那份文件可能已经是 in_progress 而对应的租约就在共享目录里（Codex 评审
    // 实测复现）。第一版以为「既有租约只有两种来源」——我们要接管的那个人，
    // 或崩溃留下的孤儿——漏掉了这第三种，结果是不带 --steal 就覆盖了别人的活租约。
    //
    // spec §8 本来就写了这条规则：租约存在且未过期时，除非 --steal，否则拒绝。
    if (held !== null && held.actor !== actor && !steal
        && !leaseExpired(held, nowMs, ledger.config.lease_hours)) {
      throw new CliError(EXIT.conflict,
        `Task ${opts.id} has a live lease held by ${held.actor} (possibly in another worktree). ` +
        "Use --steal to take it over.");
    }

    const lease: Lease = {
      actor,
      // 刷新自己已持有的租约时保留原来的认领时刻；接管则是一次新的认领。
      claimed_at: decision.kind === "refresh" && held !== null ? held.claimed_at : now,
      heartbeat_at: now,
    };

    // 刷新不是 spec §6.1 的迁移：不改 status/assignee，也不写 Log。
    if (decision.kind === "refresh") {
      // 但租约不在时必须**建**一个，不能空操作了事。claim 是请求认领的入口：
      // 一个「已经是我的但本机没有租约」的任务（新克隆、或运行时文件被清过），
      // 若只报成功而什么都不做，别人仍能立刻把它认领走，而我以为自己拿着它。
      writeLease(ledger, opts.id, lease);
      return { id: opts.id, title, status: "in_progress", assignee: actor, stolen: false, refreshed: true };
    }

    const replaced = decision.kind === "reclaim" ? decision.replaced : undefined;
    // 先构造并校验，此时还没有任何副作用（阻塞项 3）
    const prepared = prepareUpdate(ledger, existing, opts.id, {
      frontmatter: { ...task.frontmatter, status: "in_progress", assignee: actor },
      appendLog: replaced === undefined
        ? `${now} ${actor} claimed`
        : `${now} ${actor} claimed steal=true: ${replaced}`,
    }, validateWrite, now);

    // 闸门全过了才动磁盘。**先租约、后任务文件。**
    //
    // 崩在两次写入之间留下的残局分两种，不能一概而论（Codex 第二轮评审指出
    // 我原来的注释把它们混成了一句「任务仍 open」）：
    //   - **初次认领中断**：租约已建，任务仍 `open`。同一个 actor 重跑 claim
    //     直接成功；换个 actor 会拿到「租约被 X 持有，用 --steal」的提示。
    //   - **接管中断**：租约已记新人，任务仍记旧人。下一次 claim 按 §8 的租约
    //     闸门处理——新人重跑是刷新，旧人重跑会被自己的旧 assignee 挡住并被
    //     提示 --steal。
    // 两种都能靠重跑或 `--steal` 脱困，不必等 `doctor --fix`（F13）。
    //
    // 反过来的顺序留下的是 committed 的记录跑到本机事实前面，
    // 而 committed 的东西是要被别人当真的。
    if (!createLease(ledger, opts.id, lease)) writeLease(ledger, opts.id, lease);
    prepared.commit();

    return {
      id: opts.id, title, status: "in_progress", assignee: actor,
      ...(replaced === undefined ? {} : { replaced }),
      stolen: replaced !== undefined,
      refreshed: false,
    };
  }));
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

export type { Ledger };
