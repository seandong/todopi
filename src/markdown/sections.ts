// src/markdown/sections.ts
// Markdown 正文的结构：哪一行是标题、一节从哪到哪。纯函数，不认识 todopi 的格式。
//
// **单独一层，读取端（domain/）与写入端（format/）都依赖它。** 分层规定 domain/ 只引用
// domain/、format/ 只引用 domain/types.ts，于是「找小节」曾在两边各写了一份——写入端 trim、
// 读取端不 trim，一个缩进的 `   ## Log` 就让事件写进了读者看不见的地方（F09，D029）。
// 同一个判断只能有一份。

export type FenceScan = {
  /** 这一行在某个代码围栏里（顶层的或列表项里的，围栏行本身也算）——它不可能是标题 */
  inFence: boolean[];
  /** 这一行在一个**顶层**围栏里——它是代码示例，不是标准、不是 Log 条目 */
  topLevel: boolean[];
  /** 第一个没闭合的顶层开头的行号；没有为 -1。它被当作普通文字（见下），写入端据此拒绝改写小节 */
  unclosedAt: number;
};

const leading = (l: string): number => l.length - l.trimStart().length;
const OPEN = /^(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])( {1,4}|$)/;

function isOpener(text: string): { ch: string; len: number } | null {
  const m = OPEN.exec(text);
  if (m === null || (m[1]![0] === "`" && m[2]!.includes("`"))) return null;
  return { ch: m[1]![0]!, len: m[1]!.length };
}

function isCloser(text: string, ch: string, len: number): boolean {
  const m = /^(`{3,}|~{3,})\s*$/.exec(text);
  return m !== null && m[1]![0] === ch && m[1]!.length >= len;
}

/**
 * 找出代码围栏。按 CommonMark 的块结构，但只建模本格式真正用到的那一种容器——列表项
 * （验收标准与 Log 条目都是列表项）。
 *
 * - **顶层**：开头与关闭都允许 0–3 个空格缩进。第一版只认顶格开头，于是一个缩进两格的开头被
 *   忽略、它的关闭行却被当成新开头，与后面一对围栏配错，把真正的 Acceptance Criteria 整段藏了
 *   起来——done 不带 --force 就通过了（F10 第二轮评审实测）。
 * - **列表项里**：相对于项内容列缩进 0–3 格的 ``` 开一个项内围栏，它**随列表项结束而关闭**
 *   （下一个比内容列缩进少的非空行）。Log 续行里 forced done 写进来的 "  ```" 因此吞不掉后面的
 *   条目或标题——当初只认顶格开头，本想防的就是这个。
 * - **没闭合的顶层开头当普通文字。** CommonMark 让它延伸到文末；那样一行孤零零的 ``` 就能把后面
 *   的验收标准藏起来。读取端因此总能看见后面的内容；它的位置记在 `unclosedAt`，改写小节的写入端
 *   据此拒绝，而不是猜着删东西。
 */
export function scanFences(lines: string[]): FenceScan {
  const inFence = lines.map(() => false);
  const topLevel = lines.map(() => false);
  let unclosedAt = -1;
  let itemCol: number | null = null;          // 当前列表项的内容列；null 表示在顶层

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const blank = line.trim() === "";
    const ind = leading(line);

    if (itemCol !== null && !blank && ind < itemCol) itemCol = null;   // 列表项结束
    if (itemCol === null && !blank) {
      const li = LIST_ITEM.exec(line);
      if (li !== null) {
        const spaces = li[2]!.length;
        itemCol = li[1]!.length + (spaces === 0 || spaces > 4 ? 1 : spaces);
        i += 1;
        continue;
      }
    }

    const base = itemCol ?? 0;
    const rel = ind - base;
    const open = rel >= 0 && rel <= 3 ? isOpener(line.slice(ind)) : null;
    if (open === null) { i += 1; continue; }

    if (itemCol === null) {
      // 顶层围栏：找它的关闭；找不到就不算围栏。
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (leading(lines[j]!) <= 3 && isCloser(lines[j]!.trimStart(), open.ch, open.len)) { close = j; break; }
      }
      if (close < 0) {
        if (unclosedAt < 0) unclosedAt = i;
        i += 1;
        continue;
      }
      for (let k = i; k <= close; k++) { inFence[k] = true; topLevel[k] = true; }
      i = close + 1;
    } else {
      // 列表项里的围栏：到关闭行，或到列表项结束（不含结束的那一行）为止。
      const col = itemCol;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j]!;
        if (lj.trim() !== "" && leading(lj) < col) break;              // 列表项结束，围栏随之关闭
        end = j;
        const r = leading(lj) - col;
        if (r >= 0 && r <= 3 && isCloser(lj.trimStart(), open.ch, open.len)) break;
      }
      for (let k = i; k <= end; k++) inFence[k] = true;
      i = end + 1;
    }
  }
  return { inFence, topLevel, unclosedAt };
}

/** 只要标题判定用的那一份掩码。 */
export function fenceMask(lines: string[]): boolean[] {
  return scanFences(lines).inFence;
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
