// src/format/lease.ts
// spec §8 的租约**读取**。写入（claim/release/heartbeat）在 F05。

import { readdirSync, readFileSync } from "node:fs";
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
