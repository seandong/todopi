// src/output/render/worklog.ts
// 渲染层只认 dto（ARCH-008）。

import type { CheckReport, NoteReport } from "../dto/worklog.ts";

export function renderWorklogJson(r: NoteReport | CheckReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderNote(r: NoteReport): string {
  return `Noted on ${r.id}  ${r.title}\n`;
}

/** 空操作要说清楚：否则一个以为自己勾上了东西的 agent 看不出其实什么都没写。 */
export function renderCheck(r: CheckReport): string {
  const verb = r.checked ? "Checked" : "Unchecked";
  const state = r.checked ? "checked" : "unchecked";
  return r.changed
    ? `${verb} #${r.n} on ${r.id}: ${r.text}\n`
    : `#${r.n} on ${r.id} was already ${state}; nothing was written.\n`;
}
