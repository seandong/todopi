// src/commands/move.ts
// FR-T5：`move <id> --top | --before <id> | --after <id>` 是改 rank 的唯一途径，只重写一个文件。

import { writeAsWorker } from "./worker-write.ts";
import { rankBetween } from "../format/emit.ts";
import { compareTasks, sortTasks } from "../domain/order.ts";
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

  // 归属照查（FR-C6），理由同 dep：move 改写的是被挪那个任务的文件与 Log。已关闭任务也可以挪
  // ——它没有活着的持有者（文件里的 assignee 是历史记录），重排显示顺序不改写任何证据。
  const r = writeAsWorker(opts, (task, { now, actor, all }) => {
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
      // 已经在那儿了就什么都不写——先于「锚点没有 rank」的判断：已就位不需要任何 rank（第九轮评审）。
      if (opts.before !== undefined ? full[pos + 1]?.idFromFilename === anchorId : full[pos - 1]?.idFromFilename === anchorId) {
        return { noop: "already there" };
      }
      if (rankOf(anchor) === null) {
        // 混合种群（FR-T5）：有 rank 的整段排在无 rank 的之前，给 opts.id 一个 rank 只能把它放进有 rank
        // 的那一段。所以唯一有解的是「紧贴**第一个**无 rank 任务之前」——排到有 rank 那段的末尾即可
        // （F10 第八轮评审：这一种曾被一并拒绝）。其余的位置都在无 rank 的那段里，无解。
        const firstUnranked = i === 0 || rankOf(others[i - 1]!) !== null;
        if (opts.before === undefined || !firstUnranked) {
          throw new CliError(EXIT.usage,
            `${anchorId} has no rank, so there is no position ${opts.before === undefined ? "after" : "before"} it `
            + "to move into. Run `todopi doctor --fix` to give every task a rank first.");
        }
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
    // §7.4 的顺序是 (rank, id)：两个邻居之间放不下新字符串时，和其中一个共用 rank、靠 id 分先后也可能
    // 正好落在中间——仍只改一个文件（第九轮评审）。候选逐个按真实的比较函数检验，不自己推 id 的大小。
    const fits = (r: string) => {
      const moved = { ...task, frontmatter: { ...task.frontmatter, rank: r } };
      return (lo === null || compareTasks(lo, moved) < 0) && (hi === null || compareTasks(moved, hi) < 0);
    };
    const rank = [rankBetween(loRank, hiRank), loRank, hiRank].find((r): r is string => r !== null && fits(r)) ?? null;
    if (rank === null) {
      // 真的无解。spec 允许重编号，但那要改多个文件并各记一条 moved，而 FR-T5 要只重写一个。
      // 拒绝，点名，让人先把其中一个挪开。
      const names = [lo, hi].filter((t): t is TaskFile => t !== null).map((t) => t.idFromFilename).join(" and ");
      throw new CliError(EXIT.usage, loRank !== null && loRank === hiRank
        ? `${names} share the rank "${loRank}", so nothing fits between them. Move one of them somewhere else first.`
        : `There is no rank of at most 32 characters (spec §5.2) that fits next to ${names}. `
          + "Move one of them somewhere else first, or renumber ranks with `todopi doctor --fix`.");
    }
    return {
      frontmatter: { ...task.frontmatter, rank },
      appendLog: `${now} ${actor} moved`,
    };
  });
  return { id: opts.id, rank: String(r.task.frontmatter["rank"] ?? ""), changed: r.wrote };
}
