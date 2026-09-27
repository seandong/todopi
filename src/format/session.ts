// src/format/session.ts
// FR-P1b：每个会话上次 `prime` 的时间，供 FR-H1 的 handoff 用。
//
// 放在租约目录下的 `sessions/`（spec §8：机器本地的运行时状态都在那儿，随时可删，不属于格式）。
// 不直接放在租约目录里：那里的 `<id>.json` 是租约，readHeartbeats 按文件名认。
//
// 键是 `session:<会话 id>`，拿不到会话 id 时回退为 `actor:<actor>`。会话 id 由各家 agent 给出，是
// 任意字符串，所以文件名用它的哈希；原键写在文件内容里，排查时看得出是谁。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { leaseDirFor } from "./lease.ts";
import { isNewerVersion, type Ledger } from "./discover.ts";
import { TIMESTAMP_RE } from "../domain/types.ts";

export type PrimeKey = { session: string } | { actor: string };

const keyText = (k: PrimeKey) => ("session" in k ? `session:${k.session}` : `actor:${k.actor}`);

function pathFor(ledger: Ledger, key: PrimeKey): string {
  const name = createHash("sha256").update(keyText(key)).digest("hex").slice(0, 32);
  return join(leaseDirFor(ledger), "sessions", `${name}.json`);
}

/**
 * verify 的指纹：没有 verify 记成 "-"，任务文件读不出来记成 "?"（不知道就不假装知道），有就是它的
 * 哈希前 16 位（快照只用来比「变没变」）。
 */
export const UNREADABLE = "?";
export function verifyPrint(verify: string | undefined): string {
  return verify === undefined ? "-" : createHash("sha256").update(verify).digest("hex").slice(0, 16);
}

export type PrimeRecord = {
  primedAt: string;
  /** prime 那一刻账本里每个任务的 verify 指纹（FR-H1 / FR-D4）。旧格式的记录没有它 */
  verify: Record<string, string> | null;
};

/**
 * 记下这次 prime 的时间，与此刻每个任务的 verify 指纹。可能失败（目录不可写之类），由调用方决定
 * 怎么处理——prime 只报一句、不中断。
 *
 * 为什么要快照而不是事后翻 Log：`edit --verify` 会留一条 `edited fields=verify`，可手改文件、被合并的
 * PR 都不经过 CLI——而那两种正是 FR-D4 担心的「verify 在授信之后悄悄变了」。
 */
export function recordPrime(ledger: Ledger, key: PrimeKey, now: string, verify: Record<string, string> = {}): void {
  // 版本更高的账本只读：会话状态也不写（无 git 时它在 .todopi/.cache/ 里）。prime 照常输出，只是不留记录
  if (isNewerVersion(ledger)) return;
  const path = pathFor(ledger, key);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify({ key: keyText(key), primed_at: now, verify })}\n`);
}

/** 上次 prime 的记录；从没有过、或文件坏了，都返回 null（运行时状态，坏了就当没有）。 */
export function readPrimeRecord(ledger: Ledger, key: PrimeKey): PrimeRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pathFor(ledger, key), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    // 时间戳按格式校验：它会原样进报告（F12 评审：带 ESC 的 primed_at 直接打到了终端上）。
    if (rec["key"] !== keyText(key) || typeof rec["primed_at"] !== "string" || !TIMESTAMP_RE.test(rec["primed_at"])) return null;
    const v = rec["verify"];
    let verify: Record<string, string> | null = null;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const entries = Object.entries(v);
      if (entries.every(([, x]) => typeof x === "string")) {
        verify = {};
        for (const [id, x] of entries) if (typeof x === "string") verify[id] = x;
      }
    }
    return { primedAt: rec["primed_at"], verify };
  } catch {
    return null;
  }
}

/** 上次 prime 的时间。 */
export function readLastPrime(ledger: Ledger, key: PrimeKey): string | null {
  return readPrimeRecord(ledger, key)?.primedAt ?? null;
}

/**
 * 「这个会话刚压缩过」的标记（D038）。给没有「压缩后」钩子、却有「每轮之前」钩子的 agent 用（Gemini CLI）：压缩前的
 * 钩子只打标记，下一轮之前的钩子取走标记、重新注入 prime。与 prime 记录同一个目录、同一个键，文件名后缀区分。
 */
function compactedPath(ledger: Ledger, key: PrimeKey): string {
  return pathFor(ledger, key).replace(/\.json$/, ".compacted");
}

export function markCompacted(ledger: Ledger, key: PrimeKey): void {
  // 版本更高的账本只读：会话状态也不写（无 git 时它在 .todopi/.cache/ 里）。prime 照常输出，只是不留记录
  if (isNewerVersion(ledger)) return;
  const path = compactedPath(ledger, key);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileAtomic(path, `${keyText(key)}\n`);
}

/** 取走标记：有就删掉并返回 true。 */
export function takeCompacted(ledger: Ledger, key: PrimeKey): boolean {
  // 取走也是写（删文件）：版本更高时不动它，当作没有（Codex 评审）
  if (isNewerVersion(ledger)) return false;
  const path = compactedPath(ledger, key);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
