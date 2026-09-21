// src/output/render/init.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { InitReport } from "../dto/init.ts";

export function renderJson(r: InitReport): string {
  return JSON.stringify(r, null, 2);
}

const AGENTS_NOTE: Record<InitReport["agents"], string> = {
  created: "created, with the todopi protocol",
  appended: "todopi protocol section appended",
  replaced: "todopi protocol section updated",
  unchanged: "todopi protocol section already current",
};

/**
  * quiet 只去掉**提示**，不去掉结果。两者的分界：结果是用户跑这条命令要得到的东西
  * （账本在哪、动了哪些文件），提示是我们额外给的引导（下一步做什么）。
  * PRD 全局参数表：`--quiet` 抑制进度与提示性输出，只保留结果本身与错误。
  */
export function renderText(r: InitReport, opts: { quiet?: boolean } = {}): string {
  const lines = [`Ledger: ${r.root}/.todopi/`];
  // FR-A1 的要求同样适用于 init：打印写入的每个文件，用户要知道它动了什么。
  for (const f of r.created) lines.push(`  + ${f}`);
  for (const f of r.kept) lines.push(`  = ${f} (already present, left untouched)`);
  lines.push(`  AGENTS.md: ${AGENTS_NOTE[r.agents]}`);
  if (!opts.quiet) {
    lines.push("");
    lines.push('Next: todopi add "your first task"');
  }
  return lines.join("\n") + "\n";
}
