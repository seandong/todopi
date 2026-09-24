// src/commands/worker-write.ts
// note / check 共用的写入骨架：取锁 → 读 → 判归属 → 由调用方决定写什么 → 构造并校验
// → 写任务 → 刷新**自己的**心跳。
//
// 与 transition.ts 分开，因为这两条命令不是状态迁移：没有门禁报告、不动 status、
// 不删租约。但「归属」那一步用的是同一个判定（domain/ownership.ts）——那条边界在
// F05 漏过三次，不能在这里第四次各写各的。

import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { withLedgerLock, prepareUpdate, nowStamp } from "../format/write.ts";
import { readLease, touchLease } from "../format/lease.ts";
import { otherHolder } from "../domain/ownership.ts";
import { validateWrite } from "../domain/validate.ts";
import type { TaskFile } from "../domain/types.ts";
import { currentActor } from "./actor.ts";
import { withLockConflictMapped } from "./claim.ts";
import { EXIT, CliError } from "../exit.ts";

/** 调用方的决定：写一次（正文变换 + 一行 Log），或者什么都不写并说明为什么。 */
export type WorkerWrite =
  | {
    /** 新的完整 frontmatter（不是补丁，理由同 updateTask）；不给就原样带回 */
    frontmatter?: Record<string, unknown>;
    body?: (body: string) => string;
    appendLog: string;
  }
  | { noop: string };

export type WorkerWriteResult = { task: TaskFile; actor: string; wrote: boolean; noop?: string };

export function writeAsWorker(
  opts: {
    directory: string; id: string; actor?: string;
  },
  decide: (task: TaskFile, ctx: { now: string; actor: string; all: TaskFile[] }) => WorkerWrite,
): WorkerWriteResult {
  const ledger = discoverLedger(opts.directory);
  const actor = currentActor(ledger.root, opts.actor);

  return withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const existing = readTasks(ledger);
    const task = existing.find((t) => t.idFromFilename === opts.id);
    if (task === undefined) {
      throw new CliError(EXIT.usage, `No task ${opts.id} in this ledger. Run "todopi ls" to see what is there.`);
    }
    if (task.parseError !== undefined) {
      throw new CliError(EXIT.usage,
        `Task ${opts.id} cannot be read: ${task.parseError}. Run "todopi doctor" to see what is wrong with it.`);
    }

    // FR-C6：写入严格匹配。任务文件与共享租约**一起**查，而且在锁内读——锁外读到
    // 的租约到拿到锁时可能已经变了。过期的租约不挡（spec §8）。
    const lease = readLease(ledger, opts.id);
    const held = otherHolder({
      task, actor, lease, now: Date.now(), leaseHours: ledger.config.lease_hours,
    });
    if (held !== null) {
      throw new CliError(EXIT.conflict,
        `Task ${opts.id} is held by ${held.holder} (since ${held.heldSince}). Writes are refused so two `
        + `workers do not interleave on one task. If it was abandoned, take it over with `
        + `\`todopi claim ${opts.id} --steal\`.`);
    }

    const now = nowStamp();
    const decision = decide(task, { now, actor, all: existing });
    if ("noop" in decision) return { task, actor, wrote: false, noop: decision.noop };

    const prepared = prepareUpdate(ledger, existing, opts.id, {
      frontmatter: decision.frontmatter ?? { ...task.frontmatter },
      body: decision.body,
      appendLog: decision.appendLog,
    }, validateWrite, now);
    prepared.commit();

    // FR-C3：持有者的每次写入都刷新心跳。**只刷新自己的**——touchLease 不看租约是
    // 谁的，替别人刷新一份（哪怕已过期的）租约，等于让一次普通写入重新给了对方
    // 一段它并没有在用的独占。没有租约就不造（任务可能在另一台机器上被认领）。
    if (lease !== null && lease.actor === actor) touchLease(ledger, opts.id, now);

    return { task: prepared.candidate, actor, wrote: true };
  }));
}
