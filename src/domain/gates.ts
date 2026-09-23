// src/domain/gates.ts
// spec §6.1 的门禁判定。纯函数：不 import node:fs，用例直接构造任务集合即可。

import { parseAcceptance, unchecked, type Criterion } from "./acceptance.ts";
import { leaseExpired } from "./claim.ts";
import { statusOf, type TaskIndex } from "./derive.ts";
import type { TaskFile } from "./types.ts";

/** 门禁作用的三种迁移（spec §6.1 的表格）。 */
export type Transition = "done" | "close" | "reopen";

/** 本机看到的租约。null 表示没有——不等于没人持有（见 ownership 那一条）。 */
export type LeaseView = { actor: string; claimed_at: string; heartbeat_at: string } | null;

export type GateInput = {
  task: TaskFile;
  index: TaskIndex;
  /** 当前解析出的身份（FR-C4） */
  actor: string;
  transition: Transition;
  lease: LeaseView;
  /**
   * 判断租约是否过期要的两个外部事实（spec §8）。
   *
   * 第一版只比对租约的 actor，不问它过没过期，于是**一份 2020 年的孤儿租约
   * 会永远挡住这个任务**——而 §8 说陈旧的租约不该继续拦人（Codex 第二轮评审
   * 实测复现）。注入而不是在这里取，是为了保持纯函数。
   */
  now: number;
  leaseHours: number;
};

/**
 * 一条被拒绝的理由。**带的是事实，不是句子。**
 *
 * 措辞在 `output/render/gate.ts`——ARCH-020 那条线：报告 DTO 搬字段，渲染器造
 * 句子。把句子拼在这里的话，`--json` 的消费者就只能拿到一段人类可读的文本，
 * 而 FR-D2a 要求 agent 能据此行动。
 */
export type Refusal =
  | { gate: "ownership"; code: 3; holder: string; heldSince: string }
  | { gate: "acceptance"; code: 2; unchecked: Criterion[] }
  | { gate: "children"; code: 2; open: Array<{ id: string; title: string; status: string }> }
  | { gate: "state"; code: 2; status: string; transition: Transition };

/**
 * 逐道门禁判定，**返回全部未通过的**，不是第一条就停。
 *
 * FR-D2a 说这份报告是 agent 唯一能看到的东西，而协议要求它去修活。
 * 只报第一道门的话，agent 得修一条、重跑、再看到下一条——本该一次修完。
 */
export function evaluateGates(input: GateInput): Refusal[] {
  const { task, index, actor, transition, lease } = input;
  const status = statusOf(task);
  const out: Refusal[] = [];

  // 状态门禁先判：迁移的起点不对时，其余门禁问的都是无关的问题。
  if (transition === "reopen") {
    if (status !== "closed") {
      return [{ gate: "state", code: 2, status, transition }];
    }
    // **已关闭文件里留着的 assignee 不算持有者**——§6.2 不变量 3 允许 closed
    // 保留它（记录是谁关的），拿它当归属冲突会让任何人都重开不了别人关过的任务。
    //
    // **但共享租约要查。** 另一个 worktree 里可能已经有人重开并认领了它，
    // 而本树的文件还是关闭态。不查的话，拿着旧视图的人 reopen 会退出 0
    // 并删掉对方的活租约（Codex 评审用真实双 worktree 复现）。
    // 这正是 D019 那条边界的第四个入口——我又一次只想到了「已关闭没有持有者」，
    // 没想到租约是独立于任务文件的事实。
    const heldElsewhere = liveLeaseHolder(input);
    if (heldElsewhere !== null) out.push(heldElsewhere);
    return out;
  }
  if (status === "closed") {
    return [{ gate: "state", code: 2, status, transition }];
  }

  // 归属：这是唯一一道关于**权限**的门，其余都是关于**是否就绪**的。
  // spec §6.1 末段把它单独列出来，所以它的退出码是 3（冲突）而不是 2（门禁）。
  const holder = ownershipConflict(input);
  if (holder !== null) out.push(holder);

  // **验收标准只挡 done。** spec §6.1 表格里 done 那一行写了「require Acceptance
  // Criteria satisfied」，close 那一行没写——而 close 正是「不做了」的出口，
  // 标准没勾完本来就是它的常态。拿它挡 close 的话，取消一个半截的任务只能靠
  // --force，于是每一个被放弃的任务都背上 unverified 标记，那个标记本来是留给
  // 「跳过了验证的完成」的（Codex 评审指出，§6.1 的 Gates 段落已一并澄清）。
  if (transition === "done") {
    const missing = unchecked(parseAcceptance(task.body));
    if (missing.length > 0) out.push({ gate: "acceptance", code: 2, unchecked: missing });
  }

  // 只看**直接**子任务：spec §6.1 写的是 require every child closed，
  // 孙子是子任务自己的门禁。
  const open = (index.childrenOf.get(task.idFromFilename) ?? [])
    .filter((c) => statusOf(c) !== "closed")
    .map((c) => ({
      id: c.idFromFilename,
      title: typeof c.frontmatter["title"] === "string" ? c.frontmatter["title"] : "",
      status: statusOf(c),
    }));
  if (open.length > 0) out.push({ gate: "children", code: 2, open });

  return out;
}

/**
 * 归属冲突：任务的 assignee 是别人，**或者**共享租约属于别人。
 *
 * 两者都要查。租约跨 worktree 共享（`.git/todopi/leases/`）而每个 worktree 有
 * 自己的 `.todopi/tasks/`，所以本树文件说「是我的」完全可能是过期视图——
 * 另一个 worktree 里别人已经接管了它。这条边界在 F05 立了三次、漏了三次
 * （DECISIONS D019），这里一次用到全部迁移上。
 */
function ownershipConflict(input: GateInput): Refusal | null {
  const { task, actor } = input;
  const assignee = task.frontmatter["assignee"];
  if (typeof assignee === "string" && assignee !== "" && assignee !== actor) {
    return { gate: "ownership", code: 3, holder: assignee, heldSince: updatedOf(task) };
  }
  return liveLeaseHolder(input);
}

/**
 * 共享租约**还活着**且属于别人时的冲突。过期的租约不算——spec §8 的 stale
 * 语义就是为此存在的：一份崩溃留下的孤儿租约若永远拦人，任务就再也动不了，
 * 而使用者除了 `doctor --fix`（F13）别无出路。
 *
 * 判据与 `claim` 的 `leaseExpired` 是同一个函数，不另写一套——F05 学到的：
 * 「复用同一个纯函数不等于输入一致」，所以这里连 `now` 都是注入的同一份。
 */
function liveLeaseHolder(input: GateInput): Refusal | null {
  const { lease, actor, now, leaseHours } = input;
  if (lease === null || lease.actor === actor) return null;
  if (leaseExpired(lease, now, leaseHours)) return null;
  return { gate: "ownership", code: 3, holder: lease.actor, heldSince: lease.heartbeat_at };
}

function updatedOf(task: TaskFile): string {
  const v = task.frontmatter["updated"];
  return typeof v === "string" ? v : "";
}

/** 退出码取最严重的一条：3（权限）比 2（就绪）重。没有拒绝就是 0。 */
export function worstCode(refusals: Refusal[]): number {
  return refusals.reduce((worst, r) => Math.max(worst, r.code), 0);
}
