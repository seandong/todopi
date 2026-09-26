// src/format/session.ts
// FR-P1b：每个会话上次 `prime` 的时间，供 FR-H1 的 handoff 用。
//
// 放在租约目录下的 `sessions/`（spec §8：机器本地的运行时状态都在那儿，随时可删，不属于格式）。
// 不直接放在租约目录里：那里的 `<id>.json` 是租约，readHeartbeats 按文件名认。
//
// 键是 `session:<会话 id>`，拿不到会话 id 时回退为 `actor:<actor>`。会话 id 由各家 agent 给出，是
// 任意字符串，所以文件名用它的哈希；原键写在文件内容里，排查时看得出是谁。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { leaseDirFor } from "./lease.ts";
import type { Ledger } from "./discover.ts";

export type PrimeKey = { session: string } | { actor: string };

const keyText = (k: PrimeKey) => ("session" in k ? `session:${k.session}` : `actor:${k.actor}`);

function pathFor(ledger: Ledger, key: PrimeKey): string {
  const name = createHash("sha256").update(keyText(key)).digest("hex").slice(0, 32);
  return join(leaseDirFor(ledger), "sessions", `${name}.json`);
}

/** 记下这次 prime 的时间。可能失败（目录不可写之类），由调用方决定怎么处理——prime 只报一句、不中断。 */
export function recordPrime(ledger: Ledger, key: PrimeKey, now: string): void {
  const path = pathFor(ledger, key);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify({ key: keyText(key), primed_at: now })}\n`);
}

/** 上次 prime 的时间；从没有过、或文件坏了，都返回 null（运行时状态，坏了就当没有）。 */
export function readLastPrime(ledger: Ledger, key: PrimeKey): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pathFor(ledger, key), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    return rec["key"] === keyText(key) && typeof rec["primed_at"] === "string" ? rec["primed_at"] : null;
  } catch {
    return null;
  }
}
