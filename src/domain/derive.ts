// src/domain/derive.ts
// spec §7 的派生态。纯函数：不 import node:fs，用例直接构造任务集合即可
// （src/ARCHITECTURE.md）。这是 D006 决策 3 的兑现处——最容易出错的逻辑
// 落在跑得最快的那一层。

import { TIMESTAMP_RE, type TaskFile } from "./types.ts";
import { logLines, parseLogLine } from "./validate.ts";

export type TaskIndex = {
  byId: Map<string, TaskFile>;
  /** id → 以它为 parent 的任务（spec §7.1 的 children） */
  childrenOf: Map<string, TaskFile[]>;
  /** id → blocked_by 含它的任务（spec §7.1 的 blocks） */
  blocksOf: Map<string, TaskFile[]>;
};

/**
 * stale 需要的外部事实，全部注入。
 *
 * spec §7.3 的 stale 依赖「现在几点」与「这台机器上有没有这个任务的租约」，
 * 两者都在 domain 之外。注入之后，isStale 的每个分支都能用普通用例覆盖——
 * 不需要 sleep，不需要造租约文件，也不会有时序 flake。
 */
export type StaleInput = {
  /** 当前时刻，毫秒 */
  now: number;
  /** config.yml 的 lease_hours */
  leaseHours: number;
  /** 本机该任务租约的心跳时刻；没有租约返回 null */
  heartbeatAt: (id: string) => number | null;
};

export function indexTasks(tasks: TaskFile[]): TaskIndex {
  const byId = new Map<string, TaskFile>();
  const childrenOf = new Map<string, TaskFile[]>();
  const blocksOf = new Map<string, TaskFile[]>();
  for (const t of tasks) byId.set(t.idFromFilename, t);
  for (const t of tasks) {
    const parent = t.frontmatter["parent"];
    if (typeof parent === "string") push(childrenOf, parent, t);
    for (const b of idList(t.frontmatter["blocked_by"])) push(blocksOf, b, t);
  }
  return { byId, childrenOf, blocksOf };
}

function push(m: Map<string, TaskFile[]>, key: string, t: TaskFile): void {
  const list = m.get(key);
  if (list === undefined) m.set(key, [t]);
  else list.push(t);
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function statusOf(t: TaskFile): string {
  const s = t.frontmatter["status"];
  return typeof s === "string" ? s : "";
}

/** spec §7.1：有一个以上子任务的任务是容器。 */
export function isContainer(index: TaskIndex, t: TaskFile): boolean {
  return (index.childrenOf.get(t.idFromFilename)?.length ?? 0) > 0;
}

/** 容器的 n/m 进度。只数**直接**子任务——孙子属于子任务自己的进度。 */
export function childProgress(index: TaskIndex, t: TaskFile): { closed: number; total: number } {
  const children = index.childrenOf.get(t.idFromFilename) ?? [];
  return {
    closed: children.filter((c) => statusOf(c) === "closed").length,
    total: children.length,
  };
}

/**
 * spec §7.2：`blocked(t)` 为真当且仅当 t 未关闭，且 t.blocked_by 里有任务未关闭。
 *
 * 阻塞者不存在时按「未关闭」处理：一个指向不存在任务的依赖，最保守的解读是
 * 它还没被满足。悬空引用本身由 doctor 的不变量 4 报告，不是 ls 的职责。
 */
export function isBlocked(index: TaskIndex, t: TaskFile): boolean {
  if (statusOf(t) === "closed") return false;
  return idList(t.frontmatter["blocked_by"]).some((id) => {
    const blocker = index.byId.get(id);
    return blocker === undefined || statusOf(blocker) !== "closed";
  });
}

/**
 * spec §7.3：只有 in_progress 的任务谈得上 stale。
 * 本机有租约看心跳，没有则看 updated（另一台机器或新克隆的情形）。
 *
 * 比较用严格大于：spec 写的是 `now − ... > lease_hours`，恰好等于不算超过。
 */
export function isStale(t: TaskFile, input: StaleInput): boolean {
  if (statusOf(t) !== "in_progress") return false;
  const limit = input.leaseHours * 3_600_000;

  const heartbeat = input.heartbeatAt(t.idFromFilename);
  if (heartbeat !== null) return input.now - heartbeat > limit;

  const updated = t.frontmatter["updated"];
  if (typeof updated !== "string" || !TIMESTAMP_RE.test(updated)) return false;
  return input.now - Date.parse(updated) > limit;
}

/** spec §7.5 的三个条件。 */
export function isReady(index: TaskIndex, t: TaskFile, input: StaleInput): boolean {
  if (isContainer(index, t)) return false;
  if (isBlocked(index, t)) return false;
  const status = statusOf(t);
  if (status === "open") return true;
  return status === "in_progress" && isStale(t, input);
}

/**
 * spec §5.3.3 末句 / FR-D3：**已关闭**且最近一次 `done` 或 `closed` 事件带
 * `forced=true` 的任务，显示为「未验证」。
 *
 * 难点全在「最近一次」上：取「有没有出现过 forced」会把「先强制完成、
 * 重开、再正常完成」判错。所以要顺着 Log 走到最后一个 done/closed 事件再看。
 *
 * 前置条件是任务已关闭——spec 的措辞是「A **closed** task whose most recent ...」。
 * 强制完成后又被重开的任务不该继续挂着这个标记。
 *
 * Log 的动词是 `closed`（命令才叫 `close`，spec §5.3.3 的表里两列写得很清楚）。
 * 坏掉的行按 spec「Unknown verbs MUST be preserved and ignored」处理：跳过。
 */
export function isUnverified(t: TaskFile): boolean {
  if (statusOf(t) !== "closed") return false;
  let forced = false;
  for (const line of logLines(t.body)) {
    const parsed = parseLogLine(line);
    if (!parsed.ok) continue;
    if (parsed.verb !== "done" && parsed.verb !== "closed") continue;
    forced = parsed.args["forced"] === "true";   // 覆盖前一次：只有最后一次算数
  }
  return forced;
}

/**
 * 一个任务的全部派生态，一次算完。
 *
 * 抽出这个函数是 Codex 评审 F04 第 7 项的结果：原先 dto 层逐个调用上面的谓词，
 * 等于在「只搬字段」的那一层里算派生态（ARCHITECTURE.md 明令禁止，现由
 * ARCH-020 机器执行）。派生态属于 domain，dto 只负责把算好的结果搬到对外形状上。
 */
export type DerivedState = {
  ready: boolean;
  blocked: boolean;
  stale: boolean;
  unverified: boolean;
  /** 容器才有；叶子为 undefined */
  childProgress?: { closed: number; total: number };
};

export function deriveState(index: TaskIndex, t: TaskFile, input: StaleInput): DerivedState {
  const out: DerivedState = {
    ready: isReady(index, t, input),
    blocked: isBlocked(index, t),
    stale: isStale(t, input),
    unverified: isUnverified(t),
  };
  if (isContainer(index, t)) out.childProgress = childProgress(index, t);
  return out;
}
