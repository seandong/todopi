// src/output/render/plan.ts
// 渲染层只认 dto（ARCH-008）。空操作要说清楚：否则以为自己改了东西的 agent 看不出其实什么都没写。

import type { DepReport, EditReport, MoveReport } from "../dto/plan.ts";

export function renderPlanJson(r: DepReport | MoveReport | EditReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderDep(r: DepReport): string {
  if (!r.changed) {
    return r.op === "add"
      ? `${r.id} was already blocked by ${r.on}; nothing was written.\n`
      : `${r.id} was not blocked by ${r.on}; nothing was written.\n`;
  }
  return r.op === "add" ? `${r.id} is now blocked by ${r.on}.\n` : `${r.id} is no longer blocked by ${r.on}.\n`;
}

export function renderMove(r: MoveReport): string {
  return r.changed ? `Moved ${r.id}.\n` : `${r.id} is already there; nothing was written.\n`;
}

export function renderEdit(r: EditReport): string {
  return r.fields.length > 0
    ? `Edited ${r.id}: ${r.fields.join(", ")}\n`
    : `Nothing changed on ${r.id}; nothing was written.\n`;
}
