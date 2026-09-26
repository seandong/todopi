// src/output/render/prime.ts
// prime 的 Markdown。它被注入进模型的上下文：纯文本、没有颜色、结尾恰好一个换行。
//
// **每一行只能是这几种之一**（D010：协议不进 prime）：任务标题、验收标准的标签行或标准、Log 的
// 标签行或条目、「另有 N 个」、空行、最后的指针行。用例按这个白名单逐行检查。

import type { PrimeFullReport, PrimeReport, PrimeTask } from "../dto/prime.ts";

/**
 * 任务内容里的控制字符（ESC 之类）换成可见的转义：这段文字要进模型的上下文，也会打到终端上，
 * 一条标准不该能改颜色或挪光标（F11 第一轮评审：`--ac $'\033[31mRED'` 原样进了输出）。
 * 换行不在其列——多行 Log 的续行靠它；Tab 保留。
 */
export function visible(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function taskLines(t: PrimeTask): string[] {
  const out = [`## ${t.id}: ${visible(t.title)}`];
  if (t.acceptanceTotal === 0) {
    out.push(`Acceptance criteria: none as checkboxes (see \`todopi show ${t.id}\`)`);
  } else {
    const done = t.acceptance.filter((c) => c.checked).length + t.checkedOmitted;
    const omitted = t.checkedOmitted > 0 ? `; ${t.checkedOmitted} checked not shown` : "";
    out.push(`Acceptance criteria (${done} of ${t.acceptanceTotal} checked${omitted}):`);
    for (const c of t.acceptance) out.push(`- [${c.checked ? "x" : " "}] ${c.n}. ${visible(c.text)}`);
  }
  if (t.log.length > 0) {
    out.push("Recent log:");
    out.push(...t.log.map(visible));
  }
  return out;
}

/** 指针行与它提到的命令。命令与 prime 共用一份，--json 里的 `commands` 就是它们。 */
export function pointer(ready: number, heldByOthers: number, held: boolean): { line: string; commands: string[] } {
  const others = heldByOthers > 0 ? ` · ${heldByOthers} held by others` : "";
  return held
    ? { line: `${ready} ready (\`todopi ls --ready\`)${others} · everything else: \`todopi prime --full\``,
      commands: ["todopi ls --ready", "todopi prime --full"] }
    : { line: `No task in progress · ${ready} ready: \`todopi ls --ready\`${others}`, commands: ["todopi ls --ready"] };
}

export function moreHeldLine(n: number): string | null {
  return n > 0 ? `+ ${n} more task${n === 1 ? "" : "s"} you hold: \`todopi ls --mine\`` : null;
}

export function renderPrime(r: PrimeReport): string {
  const blocks = r.held.map((t) => taskLines(t).join("\n"));
  if (r.moreHeldLine !== null) blocks.push(r.moreHeldLine);
  // 指针行永不裁剪（FR-P1a），永远是最后一行。
  blocks.push(r.pointer);
  return `${blocks.join("\n\n")}\n`;
}

export function renderPrimeFull(r: PrimeFullReport): string {
  const blocks: string[] = [];
  blocks.push(r.held.length === 0 ? "# In progress (yours)\n\nNone." : ["# In progress (yours)", ...r.held.map((t) => taskLines(t).join("\n"))].join("\n\n"));
  blocks.push(["# Held by others", "", ...(r.heldByOthers.length === 0 ? ["None."] : r.heldByOthers.map((t) => `- ${t.id} ${visible(t.title)} (${t.assignee})`))].join("\n"));
  const more = r.readyTotal > r.ready.length ? `\n\n${r.readyTotal - r.ready.length} more: \`todopi ls --ready\`` : "";
  blocks.push(["# Ready", "", ...(r.ready.length === 0 ? ["None."] : r.ready.map((t) => `- ${t.id} ${visible(t.title)}`))].join("\n") + more);
  const c = r.counts;
  blocks.push(`# Counts\n\n${c.open} open · ${c.in_progress} in progress · ${c.ready} ready · ${c.blocked} blocked · ${c.closed} closed`);
  blocks.push(["# Recently closed", "", ...(r.recentlyClosed.length === 0 ? ["None."] : r.recentlyClosed.map((t) => `- ${t.id} ${visible(t.title)} (${t.resolution})`))].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}
