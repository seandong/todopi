// src/output/render/ls.ts
// 渲染层只认 dto，不认领域对象（ARCH-008）。

import type { LsReport, TaskDto } from "../dto/ls.ts";

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
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
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

function marks(t: TaskDto): string {
  const out: string[] = [];
  if (t.child_progress !== undefined) out.push(`[${t.child_progress.closed}/${t.child_progress.total}]`);
  if (t.blocked) out.push("[blocked]");
  if (t.stale) out.push("[stale]");
  if (t.unverified) out.push("[unverified]");
  if (t.status === "in_progress" && !t.stale) out.push("[in progress]");
  if (t.status === "closed" && !t.unverified) out.push(`[${t.resolution ?? "closed"}]`);
  return out.length > 0 ? out.join(" ") + " " : "";
}
