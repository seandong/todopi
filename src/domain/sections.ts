// src/domain/sections.ts
// 改写正文里某个已识别小节的内容。纯函数。

import { headingIndex, isH2, sectionEnd, structure } from "../markdown/sections.ts";
import { parseAcceptance } from "./acceptance.ts";

/** spec §5.3 的四个已识别小节，写入者 SHOULD 按这个顺序。 */
export const SECTION_ORDER = ["## Description", "## Acceptance Criteria", "## Plan", "## Log"] as const;

/**
 * 把一个已识别小节（Acceptance Criteria 或 Plan）的内容换成 `text`；`text` 为空就连标题一起去掉。其余一个字节都不动。
 * 没有这一节时，新建在按 §5.3 顺序排在它后面、且存在的第一个已识别小节之前；都没有就放在末尾。Description 另有规则
 * （放在第一个 H2 之前），见 replaceDescription。
 */
export function replaceSection(body: string, heading: "## Acceptance Criteria" | "## Plan", text: string): string {
  const lines = body.split("\n");
  const st = structure(lines);
  const block = text === "" ? [] : [heading, "", ...text.split("\n"), ""];
  const start = headingIndex(lines, st, heading);
  if (start >= 0) {
    lines.splice(start, sectionEnd(lines, st, start) - start, ...block);
    return lines.join("\n");
  }
  if (block.length === 0) return body;
  const later = SECTION_ORDER.slice(SECTION_ORDER.indexOf(heading) + 1);
  const next = later.map((h) => headingIndex(lines, st, h)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
  if (next !== undefined) {
    lines.splice(next, 0, ...block);
    return lines.join("\n");
  }
  const sep = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${sep}${block.join("\n")}\n`;
}

/** 对验收标准的一次编辑：编号是编辑**之前**的编号（spec §5.3.2 的 1..n），一次里的改动一起生效。 */
export type CriteriaEdit = { add?: string[]; set?: Map<number, string>; remove?: Set<number> };

/**
 * 按编号改验收标准：`set` 改文字、`remove` 删、`add` 追加到最后一条之后（没有标准时新建小节）。**只能动没勾的**——
 * 已勾选的是记录，悄悄改掉它的文字等于改写「当时核对的是什么」（FR-T4、F24）。已勾选的编号也不能变（Log 里的 `check ac=<n>`
 * 指着它），所以已勾选项之前的不能删。编号越界、动了勾选的，抛错说明原因。
 * 只改标准那几行本身：嵌套项与非复选框行（spec §5.3.2 要求原样保留）一个字节都不动。
 */
export function editCriteria(body: string, edit: CriteriaEdit): string {
  const criteria = parseAcceptance(body);
  const touch = new Set([...(edit.set?.keys() ?? []), ...(edit.remove ?? [])]);
  for (const n of touch) {
    const c = criteria[n - 1];
    if (c === undefined) throw new Error(`there is no criterion ${n} (the task has ${criteria.length})`);
    if (c.checked) throw new Error(`criterion ${n} is checked; uncheck it with \`todopi check <id> ${n} --undo\` before changing it`);
  }
  // 删掉一条会让它后面的编号都减一：后面有已勾选的，就等于改了 Log 里 `check ac=<n>` 指的那一条
  for (const n of edit.remove ?? []) {
    const m = criteria.findIndex((c, i) => i > n - 1 && c.checked);
    if (m >= 0) throw new Error(`removing criterion ${n} would renumber checked criterion ${m + 1}; checked criteria keep their numbers`);
  }
  for (const t of [...(edit.add ?? []), ...(edit.set?.values() ?? [])]) {
    if (t.trim() === "" || /[\r\n]/.test(t)) throw new Error(`a criterion must be a single, non-empty line: ${JSON.stringify(t)}`);
  }
  let lines = body.split("\n");
  for (const [n, text] of edit.set ?? []) lines[criteria[n - 1]!.line] = `- [ ] ${text.trim()}`;
  // 从后往前删，前面的行号不受影响
  for (const n of [...(edit.remove ?? [])].sort((a, b) => b - a)) lines.splice(criteria[n - 1]!.line, 1);
  let out = lines.join("\n");
  const add = (edit.add ?? []).map((t) => `- [ ] ${t.trim()}`);
  if (add.length === 0) return out;
  const remaining = parseAcceptance(out);
  if (remaining.length > 0) {
    lines = out.split("\n");
    // 插在最后一条标准**整个列表项**之后：它下面紧跟的缩进行（嵌套项、续行）属于它，不能被新标准隔开
    let at = remaining.at(-1)!.line + 1;
    while (at < lines.length && lines[at]!.trim() !== "" && /^[ \t]/.test(lines[at]!)) at += 1;
    lines.splice(at, 0, ...add);
    return lines.join("\n");
  }
  lines = out.split("\n");
  const st = structure(lines);
  const start = headingIndex(lines, st, "## Acceptance Criteria");
  if (start < 0) return replaceSection(out, "## Acceptance Criteria", add.join("\n"));
  // 小节在、但一条标准都没有（只有说明文字）：加在小节末尾（去掉尾部空行之前）
  let end = sectionEnd(lines, st, start);
  while (end > start + 1 && lines[end - 1]!.trim() === "") end -= 1;
  lines.splice(end, 0, ...(lines[end - 1]!.trim() === "" ? [] : [""]), ...add);
  out = lines.join("\n");
  return out;
}


/**
 * 把 `## Description` 的内容换成 `text`；`text` 为空就连标题一起去掉。
 *
 * **其余一个字节都不动**：spec §5.3 要求写入者原样保留未识别的内容，F09 刚在「新建 Log 小节
 * 时削掉末尾空白」上栽过。没有这一节时，新建在**第一个 H2 之前**——spec 建议 Description 排
 * 第一；首个标题之前的段落（preamble）留在原处，不被挤走。
 */
export function replaceDescription(body: string, text: string): string {
  const lines = body.split("\n");
  // 代码围栏里的 `## Description` 不是标题（F10 评审：Plan 围栏里一行这样的文字，曾让围栏
  // 连同内容一起被删掉）。判据与读取端同一份。
  const st = structure(lines);
  const block = text === "" ? [] : ["## Description", "", ...text.split("\n"), ""];
  const start = headingIndex(lines, st, "## Description");
  if (start >= 0) {
    lines.splice(start, sectionEnd(lines, st, start) - start, ...block);
    return lines.join("\n");
  }
  if (block.length === 0) return body;
  const firstHeading = lines.findIndex((_, i) => isH2(st, i));
  if (firstHeading >= 0) {
    lines.splice(firstHeading, 0, ...block);
    return lines.join("\n");
  }
  const sep = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${sep}${block.join("\n")}\n`;
}
