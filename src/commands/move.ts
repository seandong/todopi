// src/commands/move.ts
// FR-T5：`move <id> --top | --before <id> | --after <id>` 是改 rank 的唯一途径，只重写一个文件。

import { writeAsWorker } from "./worker-write.ts";
import { rankBetween } from "../format/emit.ts";
import { sortTasks } from "../domain/order.ts";
import type { TaskFile } from "../domain/types.ts";
import type { MoveReport } from "../output/dto/plan.ts";
import { EXIT, CliError } from "../exit.ts";

export type MoveOptions = {
  directory: string; id: string; actor?: string;
  top?: boolean; before?: string; after?: string;
};

const rankOf = (t: TaskFile): string | null => {
  const r = t.frontmatter["rank"];
  return typeof r === "string" && r !== "" ? r : null;
};

export function runMove(opts: MoveOptions): MoveReport {
  const modes = [opts.top === true, opts.before !== undefined, opts.after !== undefined].filter(Boolean).length;
  if (modes !== 1) throw new CliError(EXIT.usage, "Say exactly one of --top, --before <id>, --after <id>.");
  const anchorId = opts.before ?? opts.after;
  if (anchorId === opts.id) throw new CliError(EXIT.usage, `A task cannot be moved relative to itself (${opts.id}).`);

  // 归属不查：PRD FR-C6 的严格匹配名单里没有 move，它是规划操作。已关闭任务也可以挪：
  // 重排显示顺序不改写任何证据。
  const r = writeAsWorker({ ...opts, ownership: false }, (task, { now, actor, all }) => {
    // 邻居在 §7.4 的**真实顺序**上算，不在 rank 字符串上算：rank 相同按 id 破，
    // `--after Y` 必须落在 Y 与它真正的下一个之间。
    const others = sortTasks(all.filter((t) => t.parseError === undefined && t.idFromFilename !== opts.id));
    const full = sortTasks(all.filter((t) => t.parseError === undefined));
    const pos = full.findIndex((t) => t.idFromFilename === opts.id);

    let lo: TaskFile | null;
    let hi: TaskFile | null;
    let already: boolean;
    if (opts.top === true) {
      lo = null;
      hi = others[0] ?? null;
      already = pos === 0;
    } else {
      const i = others.findIndex((t) => t.idFromFilename === anchorId);
      if (i < 0) throw new CliError(EXIT.usage, `No task ${anchorId} in this ledger to move ${opts.id} next to.`);
      const anchor = others[i]!;
      if (rankOf(anchor) === null) {
        // 混合种群下无解（FR-T5）：有 rank 的整段排在无 rank 的之前，给 opts.id 一个 rank
        // 只会让它跳到所有无 rank 任务的前面，而不是 anchor 旁边。
        throw new CliError(EXIT.usage,
          `${anchorId} has no rank, so there is no position next to it to move into. `
          + "Run `todopi doctor --fix` to give every task a rank first.");
      }
      if (opts.before !== undefined) {
        lo = others[i - 1] ?? null;
        hi = anchor;
        already = full[pos + 1]?.idFromFilename === anchorId;
      } else {
        lo = anchor;
        hi = others[i + 1] ?? null;
        already = full[pos - 1]?.idFromFilename === anchorId;
      }
    }
    // 已经在那儿了：什么都不写（同 check 的理由）。
    if (already) return { noop: "already there" };

    // 下界之外的那一侧若没有 rank，就当成没有边界：新 rank 仍在有 rank 的那一段里。
    const loRank = lo === null ? null : rankOf(lo);
    const hiRank = hi === null ? null : rankOf(hi);
    if (loRank !== null && hiRank !== null && loRank >= hiRank) {
      // 两个邻居的 rank 相同：没有字符串能插进去。spec 允许重编号，但那要改多个文件并各记
      // 一条 moved，而 FR-T5 要只重写一个。拒绝，点名这两个，让人先把其中一个挪开。
      throw new CliError(EXIT.usage,
        `${lo!.idFromFilename} and ${hi!.idFromFilename} share the rank "${loRank}", so nothing fits between them. `
        + `Move one of them somewhere else first.`);
    }
    return {
      frontmatter: { ...task.frontmatter, rank: rankBetween(loRank, hiRank) },
      appendLog: `${now} ${actor} moved`,
    };
  });
  return { id: opts.id, rank: String(r.task.frontmatter["rank"] ?? ""), changed: r.wrote };
}
