// src/output/render/ls.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { LsReport, TaskDto } from "../dto/ls.ts";

export function renderJson(r: LsReport): string {
  return JSON.stringify(r, null, 2);
}

/**
 * 每条任务一行，id 对齐。标记用短词而不是符号——读它的是 agent，
 * 而符号需要一张图例才看得懂。
 */
export function renderText(r: LsReport, opts: { quiet?: boolean } = {}): string {
  const lines: string[] = [];
  if (r.tasks.length === 0) {
    if (!opts.quiet) lines.push("No tasks match.");
  } else {
    const width = idWidth(r.tasks);
    for (const t of r.tasks) lines.push(`${t.id.padEnd(width)}  ${marks(t)}${t.title}`);
    if (!opts.quiet && r.tasks.length < r.total) {
      lines.push("");
      lines.push(`Showing ${r.tasks.length} of ${r.total} tasks.`);
    }
  }
  // --quiet 压的是提示，不是问题：坏掉的文件在任何模式下都要说
  if (r.unreadable.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Could not read ${r.unreadable.length} task file(s): ${r.unreadable.join(", ")}`);
    lines.push("Run `todopi doctor` to see what is wrong with them.");
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/** 用循环而不是 Math.max(...ids)：十万量级的展开会 RangeError，而 import 造得出那种账本。 */
function idWidth(tasks: TaskDto[]): number {
  let width = 0;
  for (const t of tasks) if (t.id.length > width) width = t.id.length;
  return width;
}

function marks(t: TaskDto): string {
  const out: string[] = [];
  if (t.children !== undefined) out.push(`[${t.children.closed}/${t.children.total}]`);
  if (t.blocked) out.push("[blocked]");
  if (t.stale) out.push("[stale]");
  if (t.status === "in_progress" && !t.stale) out.push("[in progress]");
  if (t.status === "closed") out.push(`[${t.resolution ?? "closed"}]`);
  return out.length > 0 ? out.join(" ") + " " : "";
}
