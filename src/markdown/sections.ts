// src/markdown/sections.ts
// Markdown 正文的结构：哪一行是标题、一节从哪到哪。纯函数，不认识 todopi 的格式。
//
// **单独一层，读取端（domain/）与写入端（format/）都依赖它。** 分层规定 domain/ 只引用
// domain/、format/ 只引用 domain/types.ts，于是「找小节」曾在两边各写了一份——写入端 trim、
// 读取端不 trim，一个缩进的 `   ## Log` 就让事件写进了读者看不见的地方（F09，D029）。
// 同一个判断只能有一份。

/**
 * 每一行是否在一个**闭合的、顶格开始的**代码围栏里（围栏行本身也算）。
 *
 * 两处刻意偏离 CommonMark，都朝「不会藏起内容」的方向：
 *
 * - **只认顶格开始的围栏。** CommonMark 允许最多 3 个空格的缩进；但 Log 的续行缩进两格，
 *   forced done 写进来的 verify 输出里完全可能有一行 "  ```"——把它当围栏，后面的 Log
 *   条目就全被吞掉了。
 * - **没闭合的开头不算围栏。** CommonMark 让它一直延伸到文末；那样一行孤零零的 ``` 就能把
 *   后面的 Acceptance Criteria 整段藏起来，`done` 的验收门禁于是看不见未勾的标准——少认几个
 *   标题对门禁**不是**安全的方向。
 */
export function fenceMask(lines: string[]): boolean[] {
  const mask = lines.map(() => false);
  let i = 0;
  while (i < lines.length) {
    const open = /^(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (open === null || (open[1]![0] === "`" && open[2]!.includes("`"))) { i += 1; continue; }
    const ch = open[1]![0]!;
    const len = open[1]!.length;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]!);
      if (m !== null && m[1]![0] === ch && m[1]!.length >= len) { close = j; break; }
    }
    if (close < 0) { i += 1; continue; }          // 没闭合：不算围栏
    for (let k = i; k <= close; k++) mask[k] = true;
    i = close + 1;
  }
  return mask;
}

/** 是不是一个真的 H2 标题：`## ` 开头，且不在围栏里。 */
export function isH2(lines: string[], mask: boolean[], i: number): boolean {
  return lines[i]!.startsWith("## ") && !mask[i];
}

/** 精确等于 `heading` 的第一个真标题的行号；没有返回 -1。 */
export function headingIndex(lines: string[], mask: boolean[], heading: string): number {
  for (let i = 0; i < lines.length; i++) if (lines[i] === heading && !mask[i]) return i;
  return -1;
}

/** 从 `start`（标题行）之后开始，到下一个真 H2 之前为止——返回那个结束位置（不含）。 */
export function sectionEnd(lines: string[], mask: boolean[], start: number): number {
  let end = start + 1;
  while (end < lines.length && !isH2(lines, mask, end)) end += 1;
  return end;
}
