// src/output/render/ls.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { LsReport, TaskDto } from "../dto/ls.ts";
import { PLAIN, type Style } from "../style.ts";
import { paintStatus } from "./layout.ts";

/**
 * FR-T2 明文：「`--json` 输出数组」。所以 stdout 就是一个 TaskDto 数组，
 * 不套信封——`jq '.[].id'` 直接可用。
 *
 * total 与 invalid 不进 stdout：前者在文本模式下以 "Showing N of M" 呈现，
 * 后者走 stderr（见 renderDiagnostics）。让诊断信息离开 stdout 是标准做法，
 * 也是让 stdout 保持可解析的唯一办法。
 */
export function renderJson(r: LsReport): string {
  return JSON.stringify(r.tasks, null, 2);
}

/**
 * Cargo 式的表（tp-rk6o8q）：每条任务一行（id、状态、标题）；终端里的人还看到表头与小结。状态是单词不是符号——读它的常是 agent，
 * 符号要一张图例才看得懂，而且 ● ○ 这类在东亚宽度里是模糊宽度，列会错位。标题后面仍带 [n/m] 子任务进度与 [unverified]。
 * --quiet：只有任务行，表头、小结、「没有匹配」都是提示。
 */
export function renderText(r: LsReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const lines: string[] = [];
  // 没人在看时（管道、agent）stdout 只有数据行：「没有匹配」「只显示了几条」走 stderr（renderNotes），`ls | wc -l` 才数得对（评审 P2）
  if (r.tasks.length === 0) {
    if (!opts.quiet && s.interactive) lines.push(emptyNote(r));
  } else {
    const width = idWidth(r.tasks);
    const states = r.tasks.map(state);
    let stateWidth = "STATUS".length;
    for (const st of states) if (st.word.length > stateWidth) stateWidth = st.word.length;
    const row = (id: string, st: string, title: string, idShown = id, stShown = st) =>
      `${idShown}${" ".repeat(width - id.length)}  ${stShown}${" ".repeat(stateWidth - st.length)}  ${title}`;
    // 表头与小结只给终端里的人：被管道接走时 `ls | head -1`、`ls | wc -l` 拿到的只有数据行（gh 的做法）
    const human = s.interactive && !opts.quiet;
    if (human) lines.push(s.dim(row("ID".padEnd(width), "STATUS", "TITLE").trimEnd()));
    r.tasks.forEach((t, i) => lines.push(row(t.id, states[i]!.word, `${t.title}${marks(t)}`, s.cyan(t.id), states[i]!.paint(s)(states[i]!.word))));
    if (human) lines.push("", s.dim(summary(r, states)));
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

// 判据是 total 而不是 tasks.length：--limit 0 截出空列表时，说「没有匹配」是错的——匹配有两条，只是一条都没显示
function emptyNote(r: LsReport): string {
  return r.total === 0 ? "No tasks match." : `Showing 0 of ${r.total} tasks.`;
}

/**
 * 没人在看时写到 stderr 的提示：没有匹配、或者截断了（只显示了几条）。有人在看时这些在 stdout 里（renderText）。
 * --quiet 照旧去掉。空字符串表示没什么要说的。
 */
export function renderNotes(r: LsReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  if (opts.quiet || s.interactive) return "";
  if (r.tasks.length === 0) return `${emptyNote(r)}\n`;
  return r.tasks.length < r.total ? `Showing ${r.tasks.length} of ${r.total} tasks.\n` : "";
}

/** 派生态（spec §7）写成一个词：用户关心的是能不能做（ready / blocked），不是原始的 status 字段 */
function state(t: TaskDto): { word: string; paint: (s: Style) => (x: string) => string } {
  const word = t.status === "closed" ? t.resolution ?? "closed"
    : t.status === "in_progress" ? (t.stale ? "stale" : "in progress")
    : t.blocked ? "blocked" : t.ready ? "ready" : "open";
  return { word, paint: (s) => (x: string) => paintStatus(s, x, t.unverified) };
}

/** 小结：显示了几条（截断时说共几条），再按状态计数 */
function summary(r: LsReport, states: { word: string }[]): string {
  const counts = new Map<string, number>();
  for (const st of states) counts.set(st.word, (counts.get(st.word) ?? 0) + 1);
  const head = r.tasks.length < r.total ? `Showing ${r.tasks.length} of ${r.total} tasks` : `${r.total} task${r.total === 1 ? "" : "s"}`;
  return [head, ...[...counts].map(([w, n]) => `${n} ${w}`)].join(" · ");
}

/**
 * 给 stderr 的诊断。不受 --quiet 影响：--quiet 压的是提示，不是问题。
 * 空字符串表示没什么要说的。
 */
export function renderDiagnostics(r: LsReport): string {
  if (r.invalid.length === 0) return "";
  return [
    `${r.invalid.length} task file(s) are not valid v1 task files and were left out: ${r.invalid.join(", ")}`,
    "Run `todopi doctor` to see what is wrong with them.",
  ].join("\n") + "\n";
}

/** 用循环而不是 Math.max(...ids)：十万量级的展开会 RangeError，而 import 造得出那种账本。 */
function idWidth(tasks: TaskDto[]): number {
  let width = 0;
  for (const t of tasks) if (t.id.length > width) width = t.id.length;
  return width;
}

/** 状态已经在自己的一列里；标题后面只留状态列说不下的：子任务进度与「未验证」 */
function marks(t: TaskDto): string {
  const out: string[] = [];
  if (t.child_progress !== undefined) out.push(`[${t.child_progress.closed}/${t.child_progress.total}]`);
  if (t.unverified) out.push("[unverified]");
  return out.length > 0 ? `  ${out.join(" ")}` : "";
}
