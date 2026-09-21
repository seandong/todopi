// src/output/render/add.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { AddReport } from "../dto/add.ts";

export function renderJson(r: AddReport): string {
  return JSON.stringify(r, null, 2);
}

/** quiet 只去掉提示，不去掉结果——id 是用户跑这条命令要得到的东西。 */
export function renderText(r: AddReport, opts: { quiet?: boolean } = {}): string {
  const lines = [`${r.id}  ${r.title}`];
  if (!opts.quiet) {
    lines.push(`  ${r.path}`);
    lines.push("");
    lines.push(`Next: todopi claim ${r.id}`);
  }
  return lines.join("\n") + "\n";
}
