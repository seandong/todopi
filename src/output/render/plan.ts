// src/output/render/plan.ts
// 渲染层只认 dto（ARCH-008）。空操作要说清楚：否则以为自己改了东西的 agent 看不出其实什么都没写。

import type { DepReport, EditReport, MoveReport } from "../dto/plan.ts";
import { PLAIN, type Style } from "../style.ts";
import { action } from "./layout.ts";

export function renderPlanJson(r: DepReport | MoveReport | EditReport): string {
  return JSON.stringify(r, null, 2);
}

// 空操作说清楚「什么都没写」：agent 看得出这次没有改动（与 check 同）
export function renderDep(r: DepReport, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  if (!r.changed) {
    return `${action(s, "Unchanged", r.op === "add"
      ? `${s.cyan(r.id)}  was already blocked by ${s.cyan(r.on)}; nothing was written`
      : `${s.cyan(r.id)}  was not blocked by ${s.cyan(r.on)}; nothing was written`, "noop")}\n`;
  }
  return r.op === "add"
    ? `${action(s, "Blocked", `${s.cyan(r.id)}  by ${s.cyan(r.on)}`)}\n`
    : `${action(s, "Unblocked", `${s.cyan(r.id)}  from ${s.cyan(r.on)}`)}\n`;
}

export function renderMove(r: MoveReport, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  return r.changed
    ? `${action(s, "Moved", s.cyan(r.id))}\n`
    : `${action(s, "Unchanged", `${s.cyan(r.id)}  is already there; nothing was written`, "noop")}\n`;
}

export function renderEdit(r: EditReport, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  return r.fields.length > 0
    ? `${action(s, "Edited", `${s.cyan(r.id)}  ${r.fields.join(", ")}`)}\n`
    : `${action(s, "Unchanged", `${s.cyan(r.id)}  nothing to change; nothing was written`, "noop")}\n`;
}
