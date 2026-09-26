// src/output/render/prime.ts
// prime 的 Markdown。它被注入进模型的上下文：纯文本、没有颜色、结尾恰好一个换行。
//
// 所有任务内容在 commands/prime.ts 投影时已经转义过控制字符（DTO 里就是展示值），这里原样拼接；
// **渲染不生成内容**——文本里出现的每条命令都来自 DTO（第三轮评审：`todopi show <id>` 与 --full 的
// `todopi ls --ready` 曾在这里现拼，JSON 里没有）。于是 --json 与文本是同一份内容。
//
// **每一行只能是这几种之一**（D010：协议不进 prime）：任务标题、验收标准的标签行或标准、Log 的
// 标签行或条目、「另有 N 个」、空行、最后的指针行。用例按这个白名单逐行检查。

import type { PrimeFullReport, PrimeReport, PrimeTask } from "../dto/prime.ts";

function taskLines(t: PrimeTask): string[] {
  const out = [`## ${t.id}: ${t.title}`];
  if (t.acceptanceTotal === 0) {
    out.push(`Acceptance criteria: none as checkboxes (see \`${t.seeAlso}\`)`);
  } else {
    const done = t.acceptance.filter((c) => c.checked).length + t.checkedOmitted;
    const omitted = t.checkedOmitted > 0 ? `; ${t.checkedOmitted} checked not shown` : "";
    out.push(`Acceptance criteria (${done} of ${t.acceptanceTotal} checked${omitted}):`);
    for (const c of t.acceptance) out.push(`- [${c.checked ? "x" : " "}] ${c.n}. ${c.text}`);
  }
  if (t.log.length > 0) {
    out.push("Recent log:");
    out.push(...t.log);
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
  blocks.push(["# Held by others", "", ...(r.heldByOthers.length === 0 ? ["None."] : r.heldByOthers.map((t) => `- ${t.id} ${t.title} (${t.assignee})`))].join("\n"));
  const more = r.readyMore === null ? "" : `\n\n${r.readyMore.count} more: \`${r.readyMore.command}\``;
  blocks.push(["# Ready", "", ...(r.ready.length === 0 ? ["None."] : r.ready.map((t) => `- ${t.id} ${t.title}`))].join("\n") + more);
  const c = r.counts;
  blocks.push(`# Counts\n\n${c.open} open · ${c.in_progress} in progress · ${c.ready} ready · ${c.blocked} blocked · ${c.closed} closed`);
  blocks.push(["# Recently closed", "", ...(r.recentlyClosed.length === 0 ? ["None."] : r.recentlyClosed.map((t) => `- ${t.id} ${t.title} (${t.resolution})`))].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}
