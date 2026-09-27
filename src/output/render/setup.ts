// src/output/render/setup.ts

import type { SetupReport } from "../dto/setup.ts";

/** quiet 只去掉提示（信任、可能重复之类），不去掉结果——写了哪些文件（§8 的 --quiet）。 */
export function renderSetup(r: SetupReport, opts: { quiet?: boolean } = {}): string {
  const lines = r.files.map((f) => `${f.status.padEnd(9)} ${f.path}`);
  if (opts.quiet !== true) for (const n of r.notes) lines.push(n);
  return `${lines.join("\n")}\n`;
}
