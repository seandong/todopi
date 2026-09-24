// src/markdown/sections.ts
// Markdown 正文的结构：哪一行是标题、哪些行是代码。不认识 todopi 的格式。
//
// **判定交给 CommonMark 的参考实现，不手写近似**（DECISIONS D031）。F10 连续三轮评审都在手写的近似
// 规则里找出让 done 放行未勾标准的正文：代码块里的标题、缩进开头配错、行首 Tab。HTML 块、块引用、嵌套
// 列表……近似的洞补不完。
//
// **单独一层，读取端（domain/）与写入端（format/）都依赖它**：「找小节」曾在两边各写一份，写入端 trim、
// 读取端不 trim，事件被写进读者看不见的地方（F09，D029）。同一个判断只能有一份。ARCH-025 钉住这一层只
// 依赖 commonmark。

import { Parser } from "commonmark";
import type { Node } from "commonmark";

export type BodyStructure = {
  /** CommonMark 文档**顶层**的 ATX 二级标题所在的行号（从 0 开始）。只有它们能是小节标题 */
  h2: Set<number>;
  /** 这一行属于一个**顶层**代码块或 HTML 块——它是示例或原样文字，不是标准、不是 Log 条目 */
  code: boolean[];
  /** 第一个没闭合的顶层围栏开头的行号；没有为 -1（见下） */
  unclosedAt: number;
};

const OPENER = /^ {0,3}(`{3,}|~{3,})/;
const CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * 一个顶层代码块若是围栏式的、且最后一行不是它的关闭围栏，它就是没闭合、一直延伸到了文末。
 *
 * 围栏的字符与长度从块的**首行源码**读，不读 commonmark 节点上的 `_isFenced` / `_fenceChar`——那些是
 * 下划线开头的内部字段，不在它的公开类型里，版本一变就可能没了。缩进代码块的首行至少缩进四格，匹配不上
 * OPENER，自然被排除。
 */
function isUnclosedFence(n: Node, lines: string[]): boolean {
  const [[start], [end]] = n.sourcepos;
  const open = OPENER.exec(lines[start - 1] ?? "");
  if (open === null) return false;                           // 缩进代码块
  if (end === start) return true;
  const close = CLOSER.exec(lines[end - 1] ?? "");
  return !(close !== null && close[1]![0] === open[1]![0] && close[1]!.length >= open[1]!.length);
}

function analyse(lines: string[]): BodyStructure {
  const work = [...lines];
  let unclosedAt = -1;
  // 每轮至多中和一个没闭合的开头，所以轮数有上限。
  for (let round = 0; round <= lines.length; round++) {
    const doc = new Parser().parse(work.join("\n"));
    const h2 = new Set<number>();
    const code = lines.map(() => false);
    let neutralised = false;
    for (let n = doc.firstChild; n !== null; n = n.next) {
      const [[start], [end]] = n.sourcepos;
      if (n.type === "heading" && n.level === 2) h2.add(start - 1);
      if (n.type !== "code_block" && n.type !== "html_block") continue;
      // **一处刻意偏离 CommonMark。** 没闭合的围栏，CommonMark 让它延伸到文末；那样一行孤零零的 ```
      // 就能把后面的 Acceptance Criteria 整段变成代码，done 的门禁于是看不见未勾的标准。这里把那个开头
      // 当普通文字重新解析，并记下位置：读取端因此总能看见后面的内容，改写小节的写入端据此拒绝。
      if (n.type === "code_block" && isUnclosedFence(n, work)) {
        if (unclosedAt < 0) unclosedAt = start - 1;
        work[start - 1] = "";
        neutralised = true;
        break;
      }
      for (let k = start - 1; k <= end - 1 && k < code.length; k++) code[k] = true;
    }
    if (!neutralised) return { h2, code, unclosedAt };
  }
  return { h2: new Set(), code: lines.map(() => false), unclosedAt };
}

/**
 * 每个命令会对同一份正文问好几次（验收标准、Log、描述……）；ls 会对每个任务问一次。解析不贵，但没有
 * 必要重复——按正文原文缓存，有上限。
 */
const cache = new Map<string, BodyStructure>();
const CACHE_LIMIT = 512;

export function structure(lines: string[]): BodyStructure {
  const key = lines.join("\n");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const st = analyse(lines);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, st);
  return st;
}

/** 是不是一个小节标题：顶层 ATX 二级标题。源码行是否恰好等于某个名字，由调用方比。 */
export function isH2(st: BodyStructure, i: number): boolean {
  return st.h2.has(i);
}

/** 源码行恰好等于 `heading` 的第一个小节标题的行号；没有返回 -1。 */
export function headingIndex(lines: string[], st: BodyStructure, heading: string): number {
  for (let i = 0; i < lines.length; i++) if (lines[i] === heading && st.h2.has(i)) return i;
  return -1;
}

/** 从 `start`（标题行）之后开始，到下一个小节标题之前为止——返回那个结束位置（不含）。 */
export function sectionEnd(lines: string[], st: BodyStructure, start: number): number {
  let end = start + 1;
  while (end < lines.length && !st.h2.has(end)) end += 1;
  return end;
}
