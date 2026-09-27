// src/domain/edit-buffer.ts
// `add --edit` / `edit --edit` 在编辑器里给人看的那一页，以及把它读回来（FR-T4，F24）。纯函数。
//
// 形状：第一行 `# <标题>`，第二行是一行说明（在所有小节之前，读回时自然不算），其后是 Description、Acceptance Criteria、Plan 三个小节的原文——
// 就是任务文件正文里那几节，所以读回用的是同一套小节判定（markdown/ 的 CommonMark 判定），不另写一套。
// frontmatter、Log 不进编辑器：前者有各自的选项与校验，后者是追加式的记录，不能在编辑器里改。

import { sectionLines } from "./acceptance.ts";

export const EDIT_HINT = "<!-- todopi: edit the title (line 1), description, acceptance criteria and plan. "
  + "Checked criteria cannot change. Save and quit to apply; an empty title aborts. -->";

export type EditBuffer = { title: string; description: string; acceptance: string; plan: string };

export function buildBuffer(b: EditBuffer): string {
  const part = (h: string, text: string) => [h, "", ...(text === "" ? [] : [text, ""])];
  return [`# ${b.title}`, EDIT_HINT, "", ...part("## Description", b.description), ...part("## Acceptance Criteria", b.acceptance),
    ...part("## Plan", b.plan)].join("\n");
}

function trimBlankEdges(lines: string[]): string {
  let a = 0;
  let z = lines.length;
  while (a < z && lines[a]!.trim() === "") a += 1;
  while (z > a && lines[z - 1]!.trim() === "") z -= 1;
  return lines.slice(a, z).join("\n");
}

/** 读回编辑器里的那一页。标题行缺失或为空返回 null（当作放弃）。 */
export function parseBuffer(text: string): EditBuffer | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return null;
  const m = /^# (.*)$/.exec(lines[first]!);
  if (m === null || m[1]!.trim() === "") return null;
  // 说明行在第一个小节之前，本来就不属于任何小节，不用专门去掉
  const rest = lines.slice(first + 1).join("\n");
  const section = (h: string) => trimBlankEdges(sectionLines(rest, h, true).map((l) => l.text));
  return { title: m[1]!.trim(), description: section("## Description"), acceptance: section("## Acceptance Criteria"), plan: section("## Plan") };
}
