// src/domain/gates.ts
// spec §6.1 的门禁判定。纯函数：不 import node:fs，用例直接构造任务集合即可。

import { parseAcceptance, unchecked, type Criterion } from "./acceptance.ts";
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
    // 已关闭的任务没有持有者，也不必再问验收标准与子任务——
    // spec §6.1 的 reopen 那一行只写了「移除 resolution 与 assignee」。
    // §6.2 不变量 3 也允许 closed 保留 assignee（记录是谁关的），
    // 拿它当归属冲突会让任何人都重开不了别人关过的任务。
    return out;
  }
  if (status === "closed") {
    return [{ gate: "state", code: 2, status, transition }];
  }

  // 归属：这是唯一一道关于**权限**的门，其余都是关于**是否就绪**的。
  // spec §6.1 末段把它单独列出来，所以它的退出码是 3（冲突）而不是 2（门禁）。
  const holder = ownershipConflict(task, actor, lease);
  if (holder !== null) out.push(holder);

  const missing = unchecked(parseAcceptance(task.body));
  if (missing.length > 0) out.push({ gate: "acceptance", code: 2, unchecked: missing });

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
function ownershipConflict(task: TaskFile, actor: string, lease: LeaseView): Refusal | null {
  const assignee = task.frontmatter["assignee"];
  if (typeof assignee === "string" && assignee !== "" && assignee !== actor) {
    return { gate: "ownership", code: 3, holder: assignee, heldSince: updatedOf(task) };
  }
  if (lease !== null && lease.actor !== actor) {
    return { gate: "ownership", code: 3, holder: lease.actor, heldSince: lease.heartbeat_at };
  }
  return null;
}

function updatedOf(task: TaskFile): string {
  const v = task.frontmatter["updated"];
  return typeof v === "string" ? v : "";
}

/** 退出码取最严重的一条：3（权限）比 2（就绪）重。没有拒绝就是 0。 */
export function worstCode(refusals: Refusal[]): number {
  return refusals.reduce((worst, r) => Math.max(worst, r.code), 0);
}
