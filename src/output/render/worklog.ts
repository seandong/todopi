// src/output/render/worklog.ts
// 渲染层只认 dto（ARCH-008）。

import type { CheckReport, NoteReport } from "../dto/worklog.ts";
import { PLAIN, type Style } from "../style.ts";
import { action, task } from "./layout.ts";

export function renderWorklogJson(r: NoteReport | CheckReport): string {
  return JSON.stringify(r, null, 2);
}

export function renderNote(r: NoteReport, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  return `${action(s, "Noted", task(s, r.id, r.title))}\n`;
}

/** 空操作要说清楚：否则一个以为自己勾上了东西的 agent 看不出其实什么都没写。 */
export function renderCheck(r: CheckReport, opts: { style?: Style } = {}): string {
  const s = opts.style ?? PLAIN;
  const state = r.checked ? "checked" : "unchecked";
  return r.changed
    ? `${action(s, r.checked ? "Checked" : "Unchecked", `${s.cyan(r.id)}  #${r.n} ${r.text}`, r.checked ? "ok" : "change")}\n`
    : `${action(s, "Unchanged", `${s.cyan(r.id)}  #${r.n} was already ${state}; nothing was written`, "noop")}\n`;
}
