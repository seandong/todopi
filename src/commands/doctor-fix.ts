// src/commands/doctor-fix.ts
// FR-Q1 的 `doctor --fix`：把能机械修好的偏差规范化，然后照常跑一遍 doctor。
//
// 修什么：frontmatter 的键顺序与引号形态（交给唯一的发射器 emitFrontmatter）、`created` 的非规范但无歧义
// 的时间戳（带时区偏移或小数秒的 RFC 3339 → UTC 秒级 `Z`；`updated` 不动，见下）、验收标准的 `[X]` →
// `[x]`、按 §7.4 的顺序给缺 rank 的任务回填 rank、删除过期租约。
//
// **不碰什么**（规格 §6.3 的例外，用户 2026-09-26 定）：`updated` 不刷新——它是跨机器的心跳，修复
// 工具刷新它会让所有过期认领看起来又活了；Log 一个字节都不动，哪怕某一行解析不了（FR-Q1：一个能被
// 修复工具改写的追加式历史不是证据）。读不出来的文件不修，照常由 doctor 报告。
//
// 每个文件写之前核对：新 frontmatter 读回来恰好是预期的数据；正文只在验收标准那几行、只把 `[X]` 换成
// `[x]`——其余每一行（Log 全部在内）逐字节相同。核对不过就不写，记为没修成。

import { discoverLedger } from "../format/discover.ts";
import { readTasks } from "../format/read.ts";
import { rewriteNormalized, withLedgerLock } from "../format/write.ts";
import { rankBetween } from "../format/emit.ts";
import { splitEnvelope } from "../format/envelope.ts";
import { deleteLease, readHeartbeats } from "../format/lease.ts";
import { parseAcceptance } from "../domain/acceptance.ts";
import { sortTasks } from "../domain/order.ts";
import { TIMESTAMP_RE, type TaskFile } from "../domain/types.ts";
import { runDoctor } from "./doctor.ts";
import { withLockConflictMapped } from "./claim.ts";
import type { DoctorFixReport } from "../output/dto/doctor.ts";
import type { Ledger } from "../format/discover.ts";

/** 无歧义的 RFC 3339：带 `Z` 或 `±hh:mm`，可带小数秒。其余形态（没有时区、日期而已……）不猜。 */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * 规范成 UTC 秒级 `Z`；小数秒向下截断（不往后进一秒，免得 created 晚于实际时刻）。改不了返回 null。
 *
 * 形状对还不够：`Date.parse("2026-02-30T…")` 会进位成 3 月 2 日——那不是「同一个时刻换个写法」，是猜
 * （F13 评审）。所以日期与时区偏移都要是真实存在的：各字段在范围内，且按 UTC 重建回来日期不变。
 */
export function canonicalTimestamp(v: unknown): string | null {
  if (typeof v !== "string" || TIMESTAMP_RE.test(v)) return null;
  const m = RFC3339.exec(v);
  if (m === null) return null;
  const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((k) => Number(m[k]));
  const oh = m[7] === undefined ? 0 : Number(m[7]), om = m[8] === undefined ? 0 : Number(m[8]);
  const probe = new Date(Date.UTC(y!, mo! - 1, d!));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo! - 1 || probe.getUTCDate() !== d
    || h! > 23 || mi! > 59 || sec! > 59 || oh > 23 || om > 59) return null;
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

    // rank 回填：缺 rank 的任务按 §7.4 的现有顺序（created、再按 id）排到有 rank 的那一段之后——前提是
    // **现在排在无 rank 段里的每一个任务都能回填**。§7.4 把读不出来的、rank 不是字符串的（`rank: 7`）也
    // 排在无 rank 段；只回填其余的，它们就跳到这些任务前面，显示顺序变了（F13 评审）。有这样的任务时
    // 整体不回填，报告原因——rank 不对的那个要人来看。
    const newRank = new Map<string, string>();
    const hasRank = (t: TaskFile) => typeof t.frontmatter["rank"] === "string" && t.frontmatter["rank"] !== "";
    const unranked = tasks.filter((t) => !hasRank(t));
    const blockers = unranked.filter((t) => t.parseError !== undefined || "rank" in t.frontmatter);
    if (unranked.length > 0 && blockers.length > 0) {
      skipped.push({ path: "(rank backfill)", reason: `not done: ${blockers.map((t) => t.path).join(", ")} `
        + "sort among the tasks without a rank but cannot be given one; fix them first" });
    } else {
      let last: string | null = sortTasks(readable.filter(hasRank)).map((t) => String(t.frontmatter["rank"])).at(-1) ?? null;
      for (const t of sortTasks(unranked)) {
        const r = rankBetween(last, null);
        if (r === null) break;                 // 放不下了：剩下的照常由 doctor 报告，不猜
        newRank.set(t.idFromFilename, r);
        last = r;
      }
    }

    for (const t of readable) {
      const r = fixOne(ledger, t, newRank.get(t.idFromFilename));
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
function fixOne(ledger: Ledger, t: TaskFile, rank: string | undefined): { changes: string[] } | { error: string } | null {
  const env = splitEnvelope(t.raw);
  if (env === null) return null;
  const changes: string[] = [];

  const want: Record<string, unknown> = { ...t.frontmatter };
  // 只规范 created。updated 连写法都不动（§6.3 的例外：修复 MUST NOT 改 updated——换个写法也是改；
  // F13 评审）。非规范的 updated 照常由 doctor 报告，让人决定。
  const c = canonicalTimestamp(want["created"]);
  if (c !== null) { want["created"] = c; changes.push("created timestamp"); }
  if (rank !== undefined) { want["rank"] = rank; changes.push("rank backfilled"); }

  // 验收标准的 `[X]` → `[x]`：只动 parseAcceptance 认出的那几行（Log 与别处的 `[X]` 不碰）。
  const lines = env.body.split("\n");
  const criteria = new Set(parseAcceptance(env.body).map((x) => x.line));
  const touched = new Set<number>();
  const body = lines.map((l, i) => {
    if (!criteria.has(i) || !l.startsWith("- [X]")) return l;
    touched.add(i);
    return `- [x]${l.slice(5)}`;
  }).join("\n");
  if (touched.size > 0) changes.push(`${touched.size} checkbox${touched.size === 1 ? "" : "es"}`);

  const r = rewriteNormalized(ledger, t, want, body, touched);
  if ("error" in r) return { error: r.error };
  return r.written ? { changes: changes.length === 0 ? ["key order and quoting"] : changes } : null;
}
