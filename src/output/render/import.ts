// src/output/render/import.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { ImportReport } from "../dto/import.ts";

export function renderImport(r: ImportReport): string {
  const n = r.created.length;
  const lines = [`Imported ${n} task${n === 1 ? "" : "s"} from ${r.source}`
    + (r.existing > 0 ? ` (${r.existing} already imported, left as they are).` : ".")];
  for (const t of r.created) {
    lines.push(`  ${t.id}  ${t.title}${t.status === "closed" ? "  [done, unverified: checked in the plan]" : ""}`);
  }
  for (const w of r.warnings) lines.push(`warning: line ${w.line}: ${w.message}`);
  if (n > 0) lines.push("", "Next: todopi ls --ready");
  return lines.join("\n") + "\n";
}
