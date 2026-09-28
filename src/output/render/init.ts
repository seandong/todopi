// src/output/render/init.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { InitReport } from "../dto/init.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, next, shownPath, type Tone } from "./layout.ts";

export function renderJson(r: InitReport): string {
  return JSON.stringify(r, null, 2);
}

// AGENTS.md 的四种结局
const AGENTS_LINE: Record<InitReport["agents"], [verb: string, object: string, tone: Tone]> = {
  created: ["Added", "todopi protocol to AGENTS.md", "ok"],
  appended: ["Added", "todopi protocol section to AGENTS.md", "ok"],
  replaced: ["Updated", "todopi protocol section in AGENTS.md", "change"],
  unchanged: ["Unchanged", "AGENTS.md (todopi protocol already current)", "noop"],
};

// 接下来最该做的一步是接入 agent：不接，agent 的会话开始时就收不到 prime（tp-rk6o8q，用户反馈）。顺序有意义，所以编号
const NEXT: readonly [command: string, what: string][] = [
  ["todopi setup claude", "connect your coding agent (or codex, opencode, pi, cursor, gemini)"],
  ['todopi add "..."', "create your first task"],
];

/**
  * quiet 只去掉**提示**，不去掉结果。两者的分界：结果是用户跑这条命令要得到的东西
  * （账本在哪、动了哪些文件），提示是我们额外给的引导（下一步做什么）。
  * PRD 全局参数表：`--quiet` 抑制进度与提示性输出，只保留结果本身与错误。
  *
  * Cargo 式动作行（docs/plans/2026-09-28-cargo-style-output.md）；style 只决定上不上色。
  */
export function renderText(r: InitReport, opts: { quiet?: boolean; style?: Style; home?: string } = {}): string {
  const s = opts.style ?? PLAIN;
  // FR-A1 的要求同样适用于 init：打印写入的每个文件，用户要知道它动了什么。
  const lines = [
    ...r.created.map((f) => action(s, "Created", f)),
    ...r.kept.map((f) => action(s, "Unchanged", `${f} (already present)`, "noop")),
    action(s, ...AGENTS_LINE[r.agents]),
    action(s, "Ready", `todopi ledger in ${shownPath(s, r.root, opts.home)}`),
  ];
  if (!opts.quiet) lines.push("", ...next(s, NEXT, true));
  return lines.join("\n") + "\n";
}
