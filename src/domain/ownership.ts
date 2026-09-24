// src/domain/ownership.ts
// 「这个任务此刻是不是别人的」。所有写命令共用这一个判定。
//
// 抽出来是因为写者在变多：done / close / reopen 之后，note 与 check 是第四、第五个。
// 这条边界在 F05 立了三次、漏了三次（DECISIONS D019）——每多一份实现，就多一个
// 漏掉「共享租约」或「过期租约」的地方。

import { leaseExpired } from "./claim.ts";
import { statusOf } from "./derive.ts";
import type { TaskFile } from "./types.ts";

/** 本机看到的租约。null 表示没有——不等于没人持有（租约跨 worktree 共享，文件不共享）。 */
export type LeaseView = { actor: string; claimed_at: string; heartbeat_at: string } | null;

export type OwnershipInput = {
  task: TaskFile;
  /** 当前解析出的身份（FR-C4） */
  actor: string;
  lease: LeaseView;
  /** 判断租约是否过期的两个外部事实（spec §8），注入以保持纯函数 */
  now: number;
  leaseHours: number;
};

export type Holder = { holder: string; heldSince: string };

/**
 * 别人持有它吗。两处都要查：
 *
 * - **任务文件的 assignee**——但只在任务未关闭时。§6.2 不变量 3 允许 closed 保留
 *   assignee（记录是谁关的），拿它当持有者会让任何人都动不了别人关过的任务。
 * - **共享租约**，且只在它还活着时。租约跨 worktree 共享（`.git/todopi/leases/`）
 *   而每个 worktree 有自己的 `.todopi/tasks/`，本树文件说「是我的」完全可能是过期
 *   视图；而一份崩溃留下的孤儿租约若永远拦人，任务就再也动不了（spec §8）。
 */
export function otherHolder(input: OwnershipInput): Holder | null {
  const { task, actor } = input;
  const assignee = task.frontmatter["assignee"];
  if (statusOf(task) !== "closed" && typeof assignee === "string" && assignee !== "" && assignee !== actor) {
    const updated = task.frontmatter["updated"];
    return { holder: assignee, heldSince: typeof updated === "string" ? updated : "" };
  }
  return liveLeaseHolder(input);
}

/**
 * 共享租约**还活着**且属于别人。判据与 `claim` 的 `leaseExpired` 是同一个函数——
 * F05 学到的：「复用同一个纯函数不等于输入一致」，所以连 `now` 都是注入的同一份。
 */
export function liveLeaseHolder(input: OwnershipInput): Holder | null {
  const { lease, actor, now, leaseHours } = input;
  if (lease === null || lease.actor === actor) return null;
  if (leaseExpired(lease, now, leaseHours)) return null;
  return { holder: lease.actor, heldSince: lease.heartbeat_at };
}
