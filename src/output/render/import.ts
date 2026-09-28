// src/output/render/import.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { ImportReport } from "../dto/import.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, diagnostic, next, OBJECT_INDENT, task } from "./layout.ts";

/** quiet 去掉 Next 提示，结果与警告保留。Cargo 式（tp-rk6o8q）：Imported 动作行，建出的任务对齐在动词之后。 */
export function renderImport(r: ImportReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const n = r.created.length;
  const lines = [action(s, "Imported", `${n} task${n === 1 ? "" : "s"} from ${r.source}`
    + (r.existing > 0 ? ` (${r.existing} already imported, left as they are)` : ""))];
  for (const t of r.created) {
    lines.push(`${OBJECT_INDENT}${task(s, t.id, t.title)}${t.status === "closed" ? "  [done, unverified: checked in the plan]" : ""}`);
  }
  for (const w of r.warnings) lines.push(diagnostic(s, "warning", `line ${w.line}: ${w.message}`));
  if (n > 0 && opts.quiet !== true) lines.push("", ...next(s, [["todopi ls --ready", "see what can be picked up"]]));
  return lines.join("\n") + "\n";
}
