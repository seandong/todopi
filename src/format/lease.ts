// src/format/lease.ts
// spec §8 的租约**读取**。写入（claim/release/heartbeat）在 F05。

import {
  readdirSync, readFileSync, writeFileSync, mkdirSync,
  openSync, writeSync, closeSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { ID_RE, TIMESTAMP_RE } from "../domain/types.ts";
import { gitCommonDir } from "../fs/git.ts";
import type { Ledger } from "./discover.ts";

/**
 * spec §8：`<git-common-dir>/todopi/leases/`，无 git 时 `.todopi/.cache/leases/`；
 * 锁是该目录下的 `lock`，无 git 时是 `.todopi/.cache/lock`（不在 leases/ 里）。
 *
 * 用公共目录是为了同一仓库的多个 worktree 共用一套租约——两个 worktree 里的
 * agent 认领同一个任务必须互相看得见。
 *
 * 两条路径由**同一次** gitCommonDir 调用派生。分成两次调用曾经存在过：
 * 第一次判断出在 git 里、第二次若瞬时失败，锁就会落到 .cache/leases/lock，
 * 恰好破坏「锁与租约共用同一次 git-ness 判断」这个前提（Codex 评审指出）。
 */
export function leasePaths(ledger: Ledger): { leaseDir: string; lockPath: string } {
  const common = gitCommonDir(ledger.root);
  if (common === null) {
    // 无 git 时锁**不**在 leases/ 里——规格本身是这么不对称的
    return { leaseDir: join(ledger.dir, ".cache", "leases"), lockPath: join(ledger.dir, ".cache", "lock") };
  }
  const leaseDir = join(common, "todopi", "leases");
  return { leaseDir, lockPath: join(leaseDir, "lock") };
}

export function leaseDirFor(ledger: Ledger): string {
  return leasePaths(ledger).leaseDir;
}

/**
 * 读出本机每个任务租约的 heartbeat_at（毫秒）。没有租约目录返回空 Map。
 *
 * 一切异常都按「没有这条租约」处理，绝不抛错：租约是 spec §8 说的 advisory
 * 且随时可删的运行时状态，而 `ls` 只是在展示。让一个坏掉的缓存文件导致
 * 列不出任务，是把可丢弃的东西当成了权威。
 */
export function readHeartbeats(ledger: Ledger): Map<string, number> {
  const dir = leaseDirFor(ledger);
  const out = new Map<string, number>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;                        // 目录不存在是常态，不是错误
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!ID_RE.test(id)) continue;     // lock、README 之类不会误当成租约
    const at = heartbeatOf(join(dir, name));
    if (at !== null) out.set(id, at);
  }
  return out;
}

function heartbeatOf(path: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  // JSON.parse 认 "null"、"3"、"[]"，都不是租约；下面的取值必须先确认是对象
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const at = (parsed as Record<string, unknown>)["heartbeat_at"];
  if (typeof at !== "string" || !TIMESTAMP_RE.test(at)) return null;
  return Date.parse(at);
}

/** spec §8 的租约文件内容。三个字段都是必需的。 */
export type Lease = { actor: string; claimed_at: string; heartbeat_at: string };

/**
 * spec §8：`claim` 用 `O_EXCL` 原子创建租约。返回 false 表示已经有人持有。
 *
 * `openSync("wx")` 与 `writeSync` 之间文件是空的。这个瞬间在这里是良性的，
 * 两个理由缺一不可：
 *   1. 读取端（`readHeartbeats` / `readLease`）跳过解析不了的 JSON，
 *      并发的 `ls` 最多短暂看成「没有租约」；
 *   2. 写者之间由 `withLock` 排他，不会有第二个写者观察到这个中间态。
 * F03 的锁设计一号正是死在这个空文件瞬间上——那里它致命，因为「损坏即陈旧」
 * 的规则会让另一个进程把它删掉；这里没有任何人会因为租约损坏而删它。
 *
 * 不用 `writeFileAtomic`：它是临时文件 + rename，而 rename 覆盖既有文件恰恰
 * **不是** `O_EXCL`——那会把「已经有人持有」这个信息丢掉，而它正是我们要的
 * 冲突检测。
 */
export function createLease(ledger: Ledger, id: string, lease: Lease): boolean {
  const dir = leaseDirFor(ledger);
  mkdirSync(dir, { recursive: true });          // 新克隆的仓库还没有 .git/todopi/
  let fd: number;
  try {
    fd = openSync(join(dir, `${id}.json`), "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    writeSync(fd, serialize(lease));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** 覆盖既有租约。重新认领与 `--steal` 用它——那两条路径已经确认要接管。 */
export function writeLease(ledger: Ledger, id: string, lease: Lease): void {
  const dir = leaseDirFor(ledger);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), serialize(lease));
}

export function readLease(ledger: Ledger, id: string): Lease | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(leaseDirFor(ledger), `${id}.json`), "utf8"));
  } catch {
    return null;                                 // 不存在或读不懂，都按「没有租约」处理
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  const [actor, claimedAt, heartbeatAt] = [r["actor"], r["claimed_at"], r["heartbeat_at"]];
  if (typeof actor !== "string" || typeof claimedAt !== "string" || typeof heartbeatAt !== "string") return null;
  return { actor, claimed_at: claimedAt, heartbeat_at: heartbeatAt };
}

/**
 * FR-C3：持有者的每次写入都刷新心跳。只动 `heartbeat_at`——`claimed_at` 记的是
 * 认领时刻，不是最近一次写入。
 *
 * 租约不存在时是**空操作，不凭空造一个**：租约可能已被 `doctor --fix` 清掉，
 * 那时造一个等于让一次普通写入重新获得了它并不持有的独占。
 *
 * F06 起的每个写命令（`note` / `check` / `edit` / `done`）都该调用它。
 * 现在不建「每次写入都调用」的通用钩子——那些命令还不存在，给不存在的调用方
 * 设计接口只会设计错。这里是那个扩展点。
 */
export function touchLease(ledger: Ledger, id: string, now: string): void {
  const existing = readLease(ledger, id);
  if (existing === null) return;
  writeLease(ledger, id, { ...existing, heartbeat_at: now });
}

/** 删除租约。不存在不是错误——SIGKILL 之后它可能已经没了，而 release 仍要成功。 */
export function deleteLease(ledger: Ledger, id: string): void {
  try {
    unlinkSync(join(leaseDirFor(ledger), `${id}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** 字段顺序固定，diff 才稳定；结尾带换行，文本工具看着才正常。 */
function serialize(lease: Lease): string {
  return JSON.stringify(
    { actor: lease.actor, claimed_at: lease.claimed_at, heartbeat_at: lease.heartbeat_at },
    null, 2,
  ) + "\n";
}
