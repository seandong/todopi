// src/output/render/import-beads.ts
// 本文件 MUST NOT import src/domain/（ARCH-008）。

import type { ImportBeadsReport } from "../dto/import-beads.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, diagnostic, next } from "./layout.ts";

/** 警告可能上百条：文本里只列前 20 条，全部在 --json 里。 */
const SHOWN_WARNINGS = 20;

/** quiet 去掉 Next 提示，结果与警告保留。 */
export function renderImportBeads(r: ImportBeadsReport, opts: { quiet?: boolean; style?: Style } = {}): string {
  const sty = opts.style ?? PLAIN;
  const n = r.created.length;
  const closed = r.created.filter((t) => t.status === "closed").length;
  const lines = [action(sty, "Imported", `${n} Beads issue${n === 1 ? "" : "s"} from ${r.source} (${n - closed} open, ${closed} closed)`)];
  const s = r.skipped;
  const skipped = [
    s.already_imported > 0 ? `${s.already_imported} already imported` : "",
    s.tombstone > 0 ? `${s.tombstone} deleted (tombstone)` : "",
    s.ephemeral > 0 ? `${s.ephemeral} ephemeral` : "",
  ].filter(Boolean);
  if (skipped.length > 0) lines.push(action(sty, "Skipped", skipped.join(", "), "noop"));
  const d = r.dropped;
  const dropped = [
    d.other_edge_types > 0 ? `${d.other_edge_types} dependencies of types todopi does not have (related, supersedes, ...)` : "",
    d.dangling_edges > 0 ? `${d.dangling_edges} dependencies on issues that were not imported` : "",
    d.extra_parents > 0 ? `${d.extra_parents} extra parents` : "",
    d.cycle_edges > 0 ? `${d.cycle_edges} dependencies that formed a loop with other references` : "",
    d.from_edges > 0 ? `${d.from_edges} discovered-from links that formed a loop` : "",
    d.comments > 0 ? `${d.comments} comments` : "",
  ].filter(Boolean);
  if (dropped.length > 0) lines.push(diagnostic(sty, "note", `not carried over: ${dropped.join("; ")}`));
  for (const w of r.warnings.slice(0, SHOWN_WARNINGS)) lines.push(diagnostic(sty, "warning", w));
  if (r.warnings.length > SHOWN_WARNINGS) lines.push(diagnostic(sty, "note", `${r.warnings.length - SHOWN_WARNINGS} more warnings (see --json)`));
  if (n > 0 && opts.quiet !== true) lines.push("", ...next(sty, [["todopi ls --ready", "see what can be picked up"]]));
  return lines.join("\n") + "\n";
}
