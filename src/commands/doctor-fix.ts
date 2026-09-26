// src/commands/doctor-fix.ts
// FR-Q1 的 `doctor --fix`：把能机械修好的偏差规范化，然后照常跑一遍 doctor。
//
// 修什么：frontmatter 的键顺序与引号形态（交给唯一的发射器 emitFrontmatter）、非规范但无歧义的时间戳
// （带时区偏移或小数秒的 RFC 3339 → UTC 秒级 `Z`）、验收标准的 `[X]` → `[x]`、按 §7.4 的顺序给缺 rank 的
// 任务回填 rank、删除过期租约。
//
// **不碰什么**（规格 §6.3 的例外，用户 2026-09-26 定）：`updated` 不刷新——它是跨机器的心跳，修复
// 工具刷新它会让所有过期认领看起来又活了；Log 一个字节都不动，哪怕某一行解析不了（FR-Q1：一个能被
// 修复工具改写的追加式历史不是证据）。读不出来的文件不修，照常由 doctor 报告。
//
// 每个文件写之前核对：新 frontmatter 读回来恰好是预期的数据；正文只在验收标准那几行、只把 `[X]` 换成
// `[x]`——其余每一行（Log 全部在内）逐字节相同。核对不过就不写，记为没修成。

import { isDeepStrictEqual } from "node:util";
import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { withLedgerLock } from "../format/write.ts";
import { writeFileAtomic } from "../fs/atomic.ts";
import { emitFrontmatter, rankBetween } from "../format/emit.ts";
import { parseFrontmatter } from "../format/frontmatter.ts";
import { splitEnvelope } from "../format/envelope.ts";
import { deleteLease, readHeartbeats } from "../format/lease.ts";
import { parseAcceptance } from "../domain/acceptance.ts";
import { sortTasks } from "../domain/order.ts";
import { TIMESTAMP_RE, type TaskFile } from "../domain/types.ts";
import { runDoctor } from "./doctor.ts";
import { withLockConflictMapped } from "./claim.ts";
import { join } from "node:path";
import type { DoctorFixReport } from "../output/dto/doctor.ts";

/** 无歧义的 RFC 3339：带 `Z` 或 `±hh:mm`，可带小数秒。其余形态（没有时区、日期而已……）不猜。 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** 规范成 UTC 秒级 `Z`；小数秒向下截断（不往后进一秒，免得 created 晚于实际时刻）。改不了返回 null。 */
export function canonicalTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || TIMESTAMP_RE.test(v) || !RFC3339.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function runDoctorFix(opts: { directory: string; now?: number }): DoctorFixReport {
  const ledger = discoverLedger(opts.directory);
  const fixed: DoctorFixReport["fixed"] = [];
  const skipped: DoctorFixReport["skipped"] = [];
  const leasesCleared: string[] = [];

  withLockConflictMapped(() => withLedgerLock(ledger, () => {
    const tasks = readTasks(ledger);
    const readable = tasks.filter((t) => t.parseError === undefined);

    // rank 回填：缺 rank 的任务按 §7.4 的现有顺序（created、再按 id）排在有 rank 的那一段之后——
    // 回填之后显示顺序不变。rank 不是字符串的（`rank: 7`）不算缺，那是 doctor 要报给人的错。
    const newRank = new Map<string, string>();
    const ranked = readable.filter((t) => typeof t.frontmatter["rank"] === "string" && t.frontmatter["rank"] !== "");
    let last: string | null = sortTasks(ranked).map((t) => String(t.frontmatter["rank"])).at(-1) ?? null;
    for (const t of sortTasks(readable.filter((x) => !("rank" in x.frontmatter)))) {
      const r = rankBetween(last, null);
      if (r === null) break;                   // 放不下了：剩下的照常由 doctor 报告，不猜
      newRank.set(t.idFromFilename, r);
      last = r;
    }

    for (const t of readable) {
      const r = fixOne(ledger.dir, t, newRank.get(t.idFromFilename));
      if (r === null) continue;
      if ("error" in r) skipped.push({ path: t.path, reason: r.error });
      else fixed.push({ path: t.path, changes: r.changes });
    }

    // 过期租约：心跳超过 lease_hours（与 stale 的判据同一个阈值）。租约是随时可删的运行时状态（§8）。
    const now = opts.now ?? Date.now();
    for (const [id, at] of readHeartbeats(ledger)) {
      if (now - at > ledger.config.lease_hours * 3_600_000) {
        deleteLease(ledger, id);
        leasesCleared.push(id);
      }
    }
  }));

  return { fixed, skipped, leasesCleared: leasesCleared.sort(), after: runDoctor({ directory: opts.directory }) };
}

/** 修一个文件。没什么可修返回 null；核对不过返回 error（不写）。 */
function fixOne(dir: string, t: TaskFile, rank: string | undefined): { changes: string[] } | { error: string } | null {
  const env = splitEnvelope(t.raw);
  if (env === null) return null;
  const changes: string[] = [];

  const want: Record<string, unknown> = { ...t.frontmatter };
  for (const k of ["created", "updated"]) {
    const c = canonicalTimestamp(want[k]);
    if (c !== null) { want[k] = c; changes.push(`${k} timestamp`); }
  }
  if (rank !== undefined) { want["rank"] = rank; changes.push("rank backfilled"); }

  // 验收标准的 `[X]` → `[x]`：只动 parseAcceptance 认出的那几行（Log 与别处的 `[X]` 不碰）。
  const lines = env.body.split("\n");
  const criteria = new Set(parseAcceptance(env.body).map((c) => c.line));
  let boxes = 0;
  const body = lines.map((l, i) => {
    if (!criteria.has(i) || !l.startsWith("- [X]")) return l;
    boxes += 1;
    return `- [x]${l.slice(5)}`;
  }).join("\n");
  if (boxes > 0) changes.push(`${boxes} checkbox${boxes === 1 ? "" : "es"}`);

  const text = `---\n${emitFrontmatter(want)}---\n${body}`;
  if (text === t.raw) return null;
  if (changes.length === 0) changes.push("key order and quoting");

  // 写之前核对。
  const back = splitEnvelope(text);
  const parsed = back === null ? null : parseFrontmatter(back.head);
  if (back === null || parsed === null || !parsed.ok || !isDeepStrictEqual(parsed.data, want)) {
    return { error: "the normalized frontmatter would not read back as the same data" };
  }
  const before = env.body.split("\n"), after = back.body.split("\n");
  if (before.length !== after.length || before.some((l, i) => l !== after[i] && !(criteria.has(i) && after[i] === `- [x]${l.slice(5)}`))) {
    return { error: "the body would change outside the acceptance-criteria checkboxes" };
  }
  writeFileAtomic(join(dir, "tasks", `${t.idFromFilename}.md`), text);
  return { changes };
}
