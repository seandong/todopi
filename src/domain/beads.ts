// src/domain/beads.ts
// FR-I2：Beads Classic 的 issues.jsonl → 要建的任务。纯函数（ARCHITECTURE.md）：解析好的 JSON 对象进来，计划出去。
//
// 字段以 Beads v0.47.1 的 internal/types/types.go 为准（Classic = Dolt 成为默认存储之前，JSONL + SQLite 的时代）。
// 映射与取舍见 D041：
//   - tombstone（已删除）与 ephemeral（会话里的临时条目，Beads 本意是不导出）不导入，只计数。
//   - 只有 closed 映射成 closed；其余状态（in_progress、hooked、blocked、deferred……）建成 open，原状态与 assignee 写进
//     Log——迁移不替别人认领任务（todopi 的认领带租约与心跳）。
//   - resolution：close_reason 以重复类措辞开头 → duplicate；以放弃类措辞开头 → wontfix；其余 → done。只看开头：
//     「Fixed stale cache」是修好了，不是放弃。原文照样进 Log。
//   - priority 0（最高）…4 → rank 顺序；同 priority 按 created_at、再按 id。
//   - issue_type → label；Beads 自己的 labels 规范化后保留。
//   - `blocks` → blocked_by；`parent-child` → parent（多个父级取第一个）；`discovered-from` → created 的 from=。
//     其余依赖类型（related、supersedes……）todopi 没有对应物，计数。指向没导入的条目的边丢掉并计数。
//   - 建的顺序是 parent 与 blocked_by 的拓扑序（引用必须先存在，spec §6.2 不变量 4）；成环的边丢掉并警告。

import { LABEL_RE } from "./types.ts";
import { truncateTitle } from "./import-plan.ts";

/** Beads Issue 里我们用到的字段（其余忽略）。 */
export type BeadsIssue = {
  id: string;
  title: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  labels?: string[];
  created_at?: string;
  close_reason?: string;
  ephemeral?: boolean;
  dependencies?: { issue_id?: string; depends_on_id?: string; type?: string }[];
  comments?: unknown[];
};

export type BeadsPlanned = {
  beadsId: string;
  title: string;
  /** 已经转义好、可以原样放进 Description 小节的文字 */
  description?: string;
  status: "open" | "closed";
  resolution?: "done" | "wontfix" | "duplicate";
  labels: string[];
  /** 都是 Beads id，由调用方换成新 id */
  parent?: string;
  blockedBy: string[];
  from?: string;
  /** created 的时间（spec 的 UTC 秒级 Z） */
  created?: string;
  /** priority 顺序里的位置：rank 按它分配 */
  order: number;
  /** imported 那一行 Log 的文字 */
  note: string;
};

export type BeadsPlan = {
  /** 建的顺序（拓扑序） */
  tasks: BeadsPlanned[];
  skipped: { tombstone: number; ephemeral: number; existing: number };
  dropped: { danglingEdges: number; otherEdgeTypes: number; cycleEdges: number; fromEdges: number; extraParents: number; comments: number };
  warnings: string[];
};

const MAX_TITLE = 200;

/** 放弃与重复：close_reason 的**开头**（D041）。 */
// 每个词都带词边界：「duplicated logic removed」「Invalidated the cache」是做完了的事，不是重复或放弃
const DUPLICATE = /^\s*(duplicate|dup|dupe)\b/i;
const ABANDONED = /^\s*(won'?t\s*fix|wontfix|will not (fix|do)|not planned|abandon(ed)?|cancel(l?ed)?|invalid|spurious|wrong repo|not a bug|obsolete|stale|superseded|no longer (needed|relevant|applicable))\b/i;

export function resolutionFor(reason: string | undefined): "done" | "wontfix" | "duplicate" {
  if (reason === undefined) return "done";
  if (DUPLICATE.test(reason)) return "duplicate";
  if (ABANDONED.test(reason)) return "wontfix";
  return "done";
}

/** label：小写、非法字符换成 `-`、截到 32；规范化后仍不合法就返回 null。 */
export function normalizeLabel(raw: string): string | null {
  const l = raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 32);
  return LABEL_RE.test(l) ? l : null;
}

/** RFC 3339（可带小数秒、时区偏移）→ spec 的 UTC 秒级 `Z`；读不懂返回 undefined（由调用方用导入时刻）。 */
export function utcSeconds(ts: string | undefined): string | undefined {
  if (ts === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(ts);
  if (m === null) return undefined;
  // 形状对还不够：Date.parse 会把 2 月 30 日进位成 3 月 2 日——那是猜，不是换个写法（F13 评审的同一条教训）
  const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((k) => Number(m[k]));
  const probe = new Date(Date.UTC(y!, mo! - 1, d!));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo! - 1 || probe.getUTCDate() !== d
    || h! > 23 || mi! > 59 || sec! > 59 || Number(m[9] ?? 0) > 23 || Number(m[10] ?? 0) > 59) return undefined;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return undefined;
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function titleOf(raw: string): { title: string; overflow?: string } {
  const one = raw.replace(/\s+/g, " ").trim();
  if (one.length <= MAX_TITLE) return { title: one, overflow: one === raw ? undefined : raw };
  return { title: truncateTitle(one), overflow: raw };
}

/**
 * 「这段文字原样放进 Description 会不会改变正文的读法」：Beads 的描述里常有顶格的 `## Current State`，放进去就成了一个
 * 新小节、把描述截断；没闭合的代码围栏会吞掉后面的 Log。判据由调用方注入（与写入端同一份 CommonMark 判定），
 * 不安全就整段缩进成代码块，原文一个字不改（只多了缩进）。
 */
export type SafeText = (text: string) => boolean;

/**
 * 缩进代码块：每个非空行缩进四格。不用围栏：像冲突标记的行（`=======`，setext 标题的下划线就是这样）在围栏里照样顶格，
 * 照样触发不变量 7（F20 评审）；缩进之后没有任何一行从行首开始，顶格的 `##`、没闭合的围栏、冲突标记一并失效。
 */
function indented(text: string): string {
  return text.split("\n").map((l) => (l === "" ? "" : `    ${l}`)).join("\n");
}

function descriptionOf(i: BeadsIssue, overflowTitle: string | undefined, safe: SafeText): string | undefined {
  const parts: string[] = [];
  if (overflowTitle !== undefined) parts.push(`Full title in Beads:\n\n${overflowTitle}`);
  if (i.description) parts.push(i.description);
  for (const [label, text] of [["Design", i.design], ["Acceptance criteria", i.acceptance_criteria], ["Notes", i.notes]] as const) {
    if (text) parts.push(`${label} (from Beads):\n\n${text}`);
  }
  if (parts.length === 0) return undefined;
  // 只去掉首尾的空行，不动第一行的缩进（F20 评审二轮：`.trim()` 会吃掉它）
  const text = parts.join("\n\n").replace(/\r\n?/g, "\n").replace(/^(\s*\n)+/, "").trimEnd();
  return safe(text) ? text : indented(text);
}

export function planBeadsImport(issues: BeadsIssue[], alreadyImported: Set<string>, safe: SafeText): BeadsPlan {
  const skipped = { tombstone: 0, ephemeral: 0, existing: 0 };
  const dropped = { danglingEdges: 0, otherEdgeTypes: 0, cycleEdges: 0, fromEdges: 0, extraParents: 0, comments: 0 };
  const warnings: string[] = [];

  const kept: BeadsIssue[] = [];
  for (const i of issues) {
    if (i.status === "tombstone") { skipped.tombstone += 1; continue; }
    if (i.ephemeral === true) { skipped.ephemeral += 1; continue; }
    if (alreadyImported.has(i.id)) { skipped.existing += 1; continue; }
    kept.push(i);
  }
  // 引用可以指向这次新建的，也可以指向以前导入过的（调用方把旧 Beads id 映射到已有任务）
  const known = new Set([...kept.map((i) => i.id), ...alreadyImported]);

  // priority 顺序：0 最高；同 priority 按 created_at，再按 id
  const byPriority = [...kept].sort((a, b) =>
    (a.priority ?? 2) - (b.priority ?? 2)
    || (a.created_at ?? "").localeCompare(b.created_at ?? "")
    || a.id.localeCompare(b.id));
  const orderOf = new Map(byPriority.map((i, n) => [i.id, n]));

  const planned = new Map<string, BeadsPlanned>();
  for (const i of byPriority) {
    let parent: string | undefined;
    const blockedBy: string[] = [];
    let from: string | undefined;
    for (const d of i.dependencies ?? []) {
      const target = d.depends_on_id;
      if (typeof target !== "string" || (d.issue_id !== undefined && d.issue_id !== i.id)) continue;
      if (d.type !== "blocks" && d.type !== "parent-child" && d.type !== "discovered-from") { dropped.otherEdgeTypes += 1; continue; }
      if (!known.has(target)) { dropped.danglingEdges += 1; continue; }
      if (d.type === "blocks") { if (!blockedBy.includes(target) && target !== i.id) blockedBy.push(target); }
      else if (d.type === "parent-child") {
        if (parent === undefined) parent = target;
        else if (parent !== target) { dropped.extraParents += 1; warnings.push(`${i.id} has more than one parent in Beads; kept ${parent}, dropped ${target}`); }
      } else if (from === undefined) from = target;
    }
    dropped.comments += Array.isArray(i.comments) ? i.comments.length : 0;

    const raw = typeof i.title === "string" ? i.title : "";
    // 空标题（或全是空白）写不成 todopi 任务（spec §5.2）：用占位标题，原文照样进描述
    const { title, overflow } = raw.trim() === "" ? { title: `Untitled Beads issue ${i.id}`, overflow: undefined } : titleOf(raw);
    const labels: string[] = [];
    for (const raw of [...(i.issue_type ? [i.issue_type] : []), ...(i.labels ?? [])]) {
      const l = typeof raw === "string" ? normalizeLabel(raw) : null;
      if (l === null) warnings.push(`${i.id}: label ${JSON.stringify(raw)} cannot be written as a todopi label; dropped`);
      else if (!labels.includes(l)) labels.push(l);
    }
    const closed = i.status === "closed";
    const was = [`Beads ${i.id}`, `status ${i.status ?? "open"}`, `priority P${i.priority ?? 2}`];
    if (i.assignee) was.push(`assignee ${i.assignee}`);
    if (closed && i.close_reason) was.push(`close reason: ${i.close_reason.replace(/\s+/g, " ").trim()}`);
    planned.set(i.id, {
      beadsId: i.id, title, description: descriptionOf(i, overflow, safe),
      status: closed ? "closed" : "open",
      resolution: closed ? resolutionFor(i.close_reason) : undefined,
      labels, parent, blockedBy, from, created: utcSeconds(i.created_at),
      order: orderOf.get(i.id)!, note: was.join("; "),
    });
  }

  // 建的顺序分三步（F20 评审二轮：三种边混在一个 DFS 里，撞上回边时丢的可能是真正的 blocked_by 而不是软的 from）：
  // ① 只按 parent 与 blocked_by 做 DFS，回边（这两种引用合起来成环）丢掉——没有一个建的顺序能让两头都先存在；
  // ② from 按 priority 顺序逐条判断：目标能经已有的边走回源，加上就成环，丢掉；否则保留；
  // ③ 在合起来已无环的图上排拓扑序。
  // 显式栈，不递归：一条上万个任务的 blocks 链会爆调用栈（F20 复审三轮）
  const edgesOf = (t: BeadsPlanned): [string, "parent" | "blocks"][] =>
    [...(t.parent !== undefined ? [[t.parent, "parent"] as [string, "parent"]] : []), ...t.blockedBy.map((b) => [b, "blocks"] as [string, "blocks"])];
  const hardVisit = new Map<string, 1 | 2>();
  for (const root of byPriority) {
    if (hardVisit.has(root.id)) continue;
    const stack: { id: string; edges: [string, "parent" | "blocks"][]; at: number }[] = [];
    const enter = (id: string): void => {
      hardVisit.set(id, 1);
      stack.push({ id, edges: edgesOf(planned.get(id)!), at: 0 });
    };
    enter(root.id);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.at === top.edges.length) { hardVisit.set(top.id, 2); stack.pop(); continue; }
      const [target, kind] = top.edges[top.at++]!;
      if (!planned.has(target) || hardVisit.get(target) === 2) continue;
      if (hardVisit.get(target) === 1) {
        const t = planned.get(top.id)!;
        if (kind === "parent") t.parent = undefined;
        else t.blockedBy = t.blockedBy.filter((x) => x !== target);
        dropped.cycleEdges += 1;
        warnings.push(`${top.id}: its ${kind} reference to ${target} cannot be kept: together with the other parent and blocks `
          + "references it forms a loop, so no creation order has both tasks exist first; dropped");
        continue;
      }
      enter(target);
    }
  }

  const next = (t: BeadsPlanned): string[] => [...(t.parent !== undefined ? [t.parent] : []), ...t.blockedBy, ...(t.from !== undefined ? [t.from] : [])];
  /** 从 start 沿「要先建的」边走，能不能走到 goal */
  const reaches = (start: string, goal: string): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === goal) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = planned.get(id);
      if (t !== undefined) stack.push(...next(t));
    }
    return false;
  };
  // 先把所有 from 拿下来，再逐条放回：判断时只算已经决定保留的 from，否则一条注定要丢的 from 会把本可保留的连带丢掉
  // （F20 复审三轮）
  const wanted = new Map<string, string>();
  for (const i of byPriority) {
    const t = planned.get(i.id)!;
    if (t.from !== undefined) wanted.set(t.beadsId, t.from);
    t.from = undefined;
  }
  for (const i of byPriority) {
    const target = wanted.get(i.id);
    if (target === undefined) continue;
    const t = planned.get(i.id)!;
    if (planned.has(target) && reaches(target, t.beadsId)) {
      dropped.fromEdges += 1;
      warnings.push(`${t.beadsId}: its discovered-from reference to ${target} cannot be kept: ${target} must itself be `
        + `created after ${t.beadsId} (through parent, blocks or other kept discovered-from references), so no creation order has it exist first; dropped`);
    } else t.from = target;
  }

  // 合起来已无环：后序放置（显式栈）
  const out: BeadsPlanned[] = [];
  const placed = new Set<string>();
  for (const root of byPriority) {
    if (placed.has(root.id)) continue;
    const stack: { id: string; targets: string[]; at: number }[] = [{ id: root.id, targets: next(planned.get(root.id)!), at: 0 }];
    placed.add(root.id);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.at === top.targets.length) { out.push(planned.get(top.id)!); stack.pop(); continue; }
      const target = top.targets[top.at++]!;
      if (!planned.has(target) || placed.has(target)) continue;
      placed.add(target);
      stack.push({ id: target, targets: next(planned.get(target)!), at: 0 });
    }
  }
  return { tasks: out, skipped, dropped, warnings };
}
