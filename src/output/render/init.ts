// src/output/render/init.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { InitReport } from "../dto/init.ts";
import { PLAIN, type Style } from "../style.ts";

export function renderJson(r: InitReport): string {
  return JSON.stringify(r, null, 2);
}

// AGENTS.md 的四种结局：标记与文件行同一套（+ 新建、~ 改了、= 没动）
const AGENTS_LINE: Record<InitReport["agents"], { mark: string; note: string }> = {
  created: { mark: "+", note: "todopi protocol added" },
  appended: { mark: "~", note: "todopi protocol section appended" },
  replaced: { mark: "~", note: "todopi protocol section updated" },
  unchanged: { mark: "=", note: "todopi protocol section already current" },
};

// 接下来最该做的一步是接入 agent：不接，agent 的会话开始时就收不到 prime（tp-rk6o8q，用户反馈）
const NEXT: readonly [command: string, what: string][] = [
  ["todopi setup claude", "connect your coding agent (or codex, opencode, pi, cursor, gemini)"],
  ['todopi add "..."', "create your first task"],
];

/**
  * quiet 只去掉**提示**，不去掉结果。两者的分界：结果是用户跑这条命令要得到的东西
  * （账本在哪、动了哪些文件），提示是我们额外给的引导（下一步做什么）。
  * PRD 全局参数表：`--quiet` 抑制进度与提示性输出，只保留结果本身与错误。
  *
  * 同一份排版，style 只决定上不上色（tp-rk6o8q）。上色时家目录缩成 ~；纯文本照旧给绝对路径（读它的常是 agent）。
  */
export function renderText(r: InitReport, opts: { quiet?: boolean; style?: Style; home?: string } = {}): string {
  const s = opts.style ?? PLAIN;
  const root = s !== PLAIN && opts.home !== undefined && opts.home !== "" && (r.root === opts.home || r.root.startsWith(`${opts.home}/`))
    ? `~${r.root.slice(opts.home.length)}`
    : r.root;
  const mark = { "+": s.green("+"), "~": s.yellow("~"), "=": s.dim("=") };
  const rows: [mark: string, path: string, note: string][] = [];
  // FR-A1 的要求同样适用于 init：打印写入的每个文件，用户要知道它动了什么。
  for (const f of r.created) rows.push([mark["+"], f, ""]);
  for (const f of r.kept) rows.push([mark["="], f, "already present, left untouched"]);
  const a = AGENTS_LINE[r.agents];
  rows.push([mark[a.mark as keyof typeof mark], "AGENTS.md", a.note]);
  const width = Math.max(...rows.map(([, p]) => p.length));

  const lines = [`${s.ok}${s.bold("Initialized todopi")} in ${s.cyan(root)}`];
  for (const [m, p, note] of rows) lines.push(note === "" ? `  ${m} ${p}` : `  ${m} ${p.padEnd(width)}  ${s.dim(note)}`);
  if (!opts.quiet) {
    const w = Math.max(...NEXT.map(([c]) => c.length));
    lines.push("", s.bold("Next:"));
    for (const [c, what] of NEXT) lines.push(`  ${s.cyan(c)}${" ".repeat(w - c.length)}  ${s.dim(what)}`);
  }
  return lines.join("\n") + "\n";
}
